"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/current";
import { remindAllOverdue, remindDue, remindRenewal, remindRenewals, type ReminderOutcome, type ReminderTally } from "@/lib/services/reminders";
import { UserError } from "@/lib/services/errors";

/** Back to the list, with the result shown at the top. Only same-app paths. */
function back(path: string, msg: string): never {
  const to = path.startsWith("/") && !path.startsWith("//") ? path : "/dashboard";
  revalidatePath(to.split("?")[0]!);
  redirect(`${to}${to.includes("?") ? "&" : "?"}msg=${encodeURIComponent(msg)}`);
}

const NOT_LINKED = "WhatsApp is not linked yet, so nothing was sent. It is saved in Fitron: link WhatsApp in Settings › WhatsApp to send reminders.";

const summary = (r: ReminderTally) => {
  if (r.notLinked && !r.sent && !r.failed) return `Not sent: ${NOT_LINKED}`;
  const parts = [`${r.sent} reminder${r.sent === 1 ? "" : "s"} sent on WhatsApp`];
  if (r.failed) parts.push(`${r.failed} failed${r.error ? ` (${r.error})` : ""}`);
  if (r.notLinked) parts.push(`${r.notLinked} not sent (WhatsApp not linked)`);
  if (r.skipped) parts.push(`${r.skipped} skipped (reminded recently or no number)`);
  return `${parts.join(" · ")}.`;
};

/** What happened to one reminder, in words for the desk. */
function one(r: ReminderOutcome, what: string) {
  if (!r) return "Not sent: this member was reminded recently.";
  if (r.status === "Logged") return `Not sent: ${NOT_LINKED}`;
  if (r.status === "Failed") return `${what} not sent: ${r.error ?? "WhatsApp could not send it."}`;
  return r.status === "Queued" ? `${what} queued on the linked WhatsApp.` : `${what} sent on WhatsApp.`;
}

async function run(path: string, fn: () => Promise<string>) {
  let msg: string;
  try {
    msg = await fn();
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    msg = e.message;
  }
  back(path, msg);
}

export async function remindDueAction(memberId: string, invoiceNumber: string, path: string) {
  const u = await requirePermission("whatsapp.send");
  await run(path, async () => one(await remindDue(u, memberId, invoiceNumber), "Payment reminder"));
}

export async function remindAllOverdueAction(path: string) {
  const u = await requirePermission("whatsapp.send");
  await run(path, async () => summary(await remindAllOverdue(u)));
}

export async function remindRenewalAction(memberId: string, path: string) {
  const u = await requirePermission("whatsapp.send");
  await run(path, async () => one(await remindRenewal(u, memberId), "Renewal reminder"));
}

export async function remindRenewalsAction(memberIds: string[], path: string) {
  const u = await requirePermission("whatsapp.send");
  await run(path, async () => summary(await remindRenewals(u, memberIds.slice(0, 500))));
}
