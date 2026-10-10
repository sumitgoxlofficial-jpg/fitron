import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import { daysBetween } from "@/lib/domain/dates";
import { memberScope, summarize } from "./members";
import { listReceivables } from "./billing";
import { listTemplates, sendTemplate, setAutoSend } from "./whatsapp";
import { UserError } from "./errors";
import { getAccessRules } from "./attendance";
import { putSetting } from "./settings";
import { todayIso } from "./time";
import type { ReminderInput } from "@/lib/validation/settings";

/** The expiry template behind each pill on Settings › Reminders. */
const EXPIRY_TEMPLATE: Record<number, string> = { 15: "exp15", 7: "exp7", 3: "exp3", 1: "exp1", 0: "expired" };

/**
 * Which reminder days and birthday wishes are on, read from the templates' Auto-send switches and
 * rules (the one source the rule engine uses): days before expiry of the expiry templates that are
 * on, 0 for the on-the-day message.
 */
export async function reminderSchedule(orgId: string) {
  const templates = await listTemplates(orgId);
  const expiryDays = templates
    .filter((t) => t.autoSend && (t.ruleWhen === "before_expiry" || (t.ruleWhen === "after_expiry" && t.ruleDays === 0)))
    .map((t) => (t.ruleWhen === "after_expiry" ? 0 : t.ruleDays));
  return { expiryDays: [...new Set(expiryDays)].sort((a, b) => b - a), birthdays: templates.some((t) => t.key === "birthday" && t.autoSend) };
}

/**
 * Settings › Reminders. The schedule goes to Setting "reminders"; the expiry pills and birthday
 * wishes also switch the matching templates' Auto-send (what the rule engine reads); the grace period
 * is the door rule in Setting "access" (one value, edited here and under Check-in devices) and is
 * only rewritten when it changes. Each write is its own audited row.
 */
export async function saveReminderSettings(u: CurrentUser, v: ReminderInput) {
  const { graceDays, ...reminders } = v;
  await putSetting(u, "reminders", reminders);
  for (const [day, key] of Object.entries(EXPIRY_TEMPLATE)) await setAutoSend(u, key, reminders.expiryDays.includes(Number(day)));
  await setAutoSend(u, "birthday", reminders.birthdays);
  if (graceDays !== (await getAccessRules(u.orgId)).graceDays) await putSetting(u, "access", { graceDays });
}

/** The expiry template for how many days are left (the prototype's renewal reminders). */
export const expiryKey = (daysLeft: number) => (daysLeft <= 0 ? "expired" : daysLeft === 1 ? "exp1" : daysLeft <= 3 ? "exp3" : daysLeft <= 7 ? "exp7" : "exp15");

async function ownMember(u: CurrentUser, memberId: string) {
  const m = await db.member.findFirst({ where: { ...memberScope(u), id: memberId, walkIn: false }, select: { id: true, name: true } });
  if (!m) throw new UserError("Member not found.");
  return m;
}

/** How one reminder went: what the provider did with it (Logged when WhatsApp is not linked), or null when it was skipped as a repeat. */
export type ReminderOutcome = { status: string; error: string | null } | null;
/** A bulk reminder's tally. `notLinked`: saved in Fitron but not sent, because WhatsApp is not linked. `error`: the first failure's reason. */
export type ReminderTally = { sent: number; skipped: number; failed: number; notLinked: number; error?: string };

const outcome = (m: { status: string; error: string | null } | null): ReminderOutcome => (m ? { status: m.status, error: m.error } : null);

function count(t: ReminderTally, r: ReminderOutcome) {
  if (!r) t.skipped++;
  else if (r.status === "Logged") t.notLinked++;
  else if (r.status === "Failed") {
    t.failed++;
    t.error ??= r.error ?? undefined;
  } else t.sent++;
}

/** One member's balance reminder. Null when they were reminded recently (no repeat within the de-dup window). */
export async function remindDue(u: CurrentUser, memberId: string, invoiceNumber?: string): Promise<ReminderOutcome> {
  await ownMember(u, memberId);
  return outcome(await sendTemplate({ orgId: u.orgId, memberId, key: "due", userId: u.id, vars: invoiceNumber ? { invoice_number: invoiceNumber } : undefined }));
}

/** "Remind all overdue": one reminder per member with an overdue invoice, oldest first. */
export async function remindAllOverdue(u: CurrentUser): Promise<ReminderTally> {
  const { list } = await listReceivables(u, "overdue");
  const seen = new Set<string>();
  const t: ReminderTally = { sent: 0, skipped: 0, failed: 0, notLinked: 0 };
  for (const inv of [...list].sort((a, b) => b.overdueDays - a.overdueDays)) {
    if (seen.has(inv.member.id)) continue;
    seen.add(inv.member.id);
    count(t, outcome(await sendTemplate({ orgId: u.orgId, memberId: inv.member.id, key: "due", userId: u.id, vars: { invoice_number: inv.number } })));
  }
  return t;
}

/** One member's renewal reminder, with the template for how soon the membership ends. */
export async function remindRenewal(u: CurrentUser, memberId: string): Promise<ReminderOutcome> {
  await ownMember(u, memberId);
  const end = (await summarize([memberId])).get(memberId)?.latestEnd;
  if (!end) throw new UserError("This member has no membership to renew.");
  return outcome(await sendTemplate({ orgId: u.orgId, memberId, key: expiryKey(daysBetween(end, todayIso())), userId: u.id }));
}

/** "Remind all": renewal reminders for everyone in the shown list. */
export async function remindRenewals(u: CurrentUser, memberIds: string[]): Promise<ReminderTally> {
  const t: ReminderTally = { sent: 0, skipped: 0, failed: 0, notLinked: 0 };
  for (const id of memberIds) {
    try {
      count(t, await remindRenewal(u, id));
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      t.skipped++;
    }
  }
  return t;
}

/** Each member's last renewal reminder (which one, when, and how it went), for the Renewals table. */
export async function lastRenewalReminders(memberIds: string[]) {
  const msgs = await db.whatsAppMessage.findMany({
    where: { memberId: { in: memberIds }, templateKey: { in: ["exp15", "exp7", "exp3", "exp1", "expired"] } },
    orderBy: { sentAt: "desc" },
    distinct: ["memberId"],
    select: { memberId: true, templateKey: true, sentAt: true, status: true },
  });
  return new Map(msgs.map((m) => [m.memberId!, m]));
}

/** The renewal price for each member: their latest membership's price after discount. */
export async function renewalAmounts(memberIds: string[]) {
  const ms = await db.membership.findMany({
    where: { memberId: { in: memberIds }, status: "VALID" },
    orderBy: { endDate: "desc" },
    distinct: ["memberId"],
    select: { memberId: true, price: true, discount: true },
  });
  return new Map(ms.map((m) => [m.memberId, m.price - m.discount]));
}
