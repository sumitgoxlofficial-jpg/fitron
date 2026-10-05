import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import type { Prisma } from "@/generated/prisma/client";
import { addDays, daysBetween } from "@/lib/domain/dates";
import { findPlan } from "@/lib/domain/pricing";
import { branchPrice, gymTerms, longDate, nextPeriod, planPrice, planStanding, planWritable, reminderSubject, renewalReminder, standings, type Cycle, type GymTerms, type PlanStanding, type Standing, type SubscriptionSettings } from "@/lib/domain/saas";
import { createOrder, fitronKeyId, verifyCheckout } from "@/lib/integrations/razorpay";
import { cleanUtr, fitronAdmins, fitronUpi, qrSvg, upiLink } from "@/lib/integrations/upi";
import { sendEmail } from "@/lib/integrations/email";
import { audit } from "./audit";
import { isUniqueViolation, UserError } from "./errors";
import { notify } from "./notifications";
import { getGymProfile, getSetting } from "./settings";
import { getSubscriptionSettings, gymWhatsAppNumber, renewalEmails } from "./subscription";
import { sendGymWhatsApp } from "./whatsapp";
import { fromIso, toIso, todayIso } from "./time";
import { log } from "@/lib/log";

type Tx = Prisma.TransactionClient | typeof db;

/** Who Fitron is on its own tax invoices. */
export const fitronSeller = () => ({
  name: process.env.FITRON_LEGAL_NAME?.trim() || "Fitron Technologies",
  gstin: process.env.FITRON_GSTIN?.trim() || "",
  address: process.env.FITRON_ADDRESS?.trim() || "",
});

async function paidUntil(tx: Tx, orgId: string) {
  const subs = await tx.branchSubscription.findMany({ where: { orgId, kind: "BRANCH", status: "PAID", branchId: { not: null } }, select: { branchId: true, periodEnd: true } });
  const out = new Map<string, string>();
  for (const s of subs) {
    const end = toIso(s.periodEnd!);
    if ((out.get(s.branchId!) ?? "") < end) out.set(s.branchId!, end);
  }
  return out;
}

/** The trial's last day in India. It is stored as sign-up time + 7 days, so sign-up day counts as day 1 of 7. */
const trialLastDay = (endsAt: Date | null) => (endsAt ? addDays(todayIso(endsAt), -1) : null);

async function planPaidUntil(tx: Tx, orgId: string) {
  const last = await tx.branchSubscription.findFirst({ where: { orgId, kind: "PLAN", status: "PAID" }, orderBy: { periodEnd: "desc" }, select: { periodEnd: true } });
  return last?.periodEnd ? toIso(last.periodEnd) : null;
}

export type GymPlan = {
  key: string;
  name: string;
  cycle: Cycle;
  terms: GymTerms;
  standing: PlanStanding;
  /** A UPI payment for the plan is waiting for the FITRON team to check its UTR. */
  checking: boolean;
};

/** The gym's FITRON plan: which one, its limits, and whether it is on trial, paid, in grace or lapsed. */
export async function gymPlan(orgId: string, today = todayIso(), tx: Tx = db): Promise<GymPlan> {
  const org = await tx.organization.findUniqueOrThrow({ where: { id: orgId }, select: { plan: true, planCycle: true, trialEndsAt: true } });
  const [paid, checking] = await Promise.all([planPaidUntil(tx, orgId), tx.branchSubscription.count({ where: { orgId, kind: "PLAN", status: "SUBMITTED" } })]);
  return {
    key: org.plan,
    name: findPlan(org.plan)?.name ?? org.plan,
    cycle: org.planCycle as Cycle,
    terms: gymTerms(org),
    standing: planStanding(trialLastDay(org.trialEndsAt), paid, today),
    checking: checking > 0,
  };
}

/** Every branch of the gym with where it stands on the plan, oldest first. */
export async function branchStandings(orgId: string, today = todayIso(), tx: Tx = db) {
  const branches = await tx.branch.findMany({ where: { orgId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true, gstin: true, active: true } });
  const { terms } = await gymPlan(orgId, today, tx);
  const paid = await paidUntil(tx, orgId);
  const s = standings(branches, paid, today, terms.includedBranches);
  const freeSlots = await tx.branchSubscription.findMany({ where: { orgId, kind: "BRANCH", status: "PAID", branchId: null, periodEnd: { gte: fromIso(today) } }, orderBy: { periodEnd: "asc" } });
  return { branches: branches.map((b) => ({ ...b, standing: s.get(b.id)! })), freeSlots, terms };
}

export const CLOSED_MESSAGE = "This branch is closed. Reopen it in Settings › Branches to add records here.";
export const READ_ONLY_MESSAGE = "This branch is read-only because its extra-branch plan has lapsed. Its records are safe; a Super Admin can renew it in Settings › Plan & billing.";
export const PLAN_LAPSED_MESSAGE = "Your FITRON plan has ended, so the gym is read-only. Your records are safe; a Super Admin can choose a plan in Settings › Plan & billing.";

/**
 * No new members or invoices when the gym's trial or paid plan has run out (a UPI payment being
 * checked keeps it open), or in an extra branch whose paid period and grace have both run out.
 */
export async function assertBranchWritable(tx: Tx, orgId: string, branchId: string) {
  const plan = await gymPlan(orgId, todayIso(), tx);
  if (!planWritable(plan.standing) && !plan.checking) throw new UserError(PLAN_LAPSED_MESSAGE);
  const row = await tx.branch.findFirst({ where: { orgId, id: branchId }, select: { active: true } });
  if (row && !row.active) throw new UserError(CLOSED_MESSAGE);
  const count = await tx.branch.count({ where: { orgId, active: true } });
  if (count <= plan.terms.includedBranches) return;
  const { branches } = await branchStandings(orgId, todayIso(), tx);
  if (branches.find((b) => b.id === branchId)?.standing.kind === "READ_ONLY") throw new UserError(READ_ONLY_MESSAGE);
}

/** Members who count towards a plan's cap: not walk-ins, suspended or deleted, and not expired. */
export function activeMemberCount(tx: Tx, orgId: string, today = todayIso()) {
  return tx.member.count({
    where: {
      orgId,
      deletedAt: null,
      walkIn: false,
      suspended: false,
      OR: [{ memberships: { some: { status: "VALID", endDate: { gte: fromIso(today) } } } }, { memberships: { none: {} } }],
    },
  });
}

/** Starter and Professional cap active members. Call before adding a member. */
export async function assertMemberRoom(tx: Tx, orgId: string) {
  const plan = await gymPlan(orgId, todayIso(), tx);
  const limit = plan.terms.memberLimit;
  if (limit === null) return;
  if ((await activeMemberCount(tx, orgId)) >= limit) {
    throw new UserError(`Your ${plan.name} plan allows ${limit} active members and you've reached it. A Super Admin can move to a bigger plan in Settings › Plan & billing.`);
  }
}

/** A new branch beyond those included takes a paid, unused slot. Call inside the transaction that creates it. */
export async function claimSlot(tx: Prisma.TransactionClient, orgId: string, branchId: string) {
  const existing = await tx.branch.count({ where: { orgId, active: true, id: { not: branchId } } });
  const { terms, name } = await gymPlan(orgId, todayIso(), tx);
  if (existing < terms.includedBranches) return;
  if (!terms.extraBranches) throw new UserError(`The ${name} plan is for one branch. Move to Enterprise in Settings › Plan & billing to add more.`);
  const slot = await tx.branchSubscription.findFirst({ where: { orgId, kind: "BRANCH", status: "PAID", branchId: null, periodEnd: { gte: fromIso(todayIso()) } }, orderBy: { periodEnd: "asc" } });
  const claimed = slot ? await tx.branchSubscription.updateMany({ where: { id: slot.id, branchId: null }, data: { branchId } }) : { count: 0 };
  if (!claimed.count) throw new UserError(`Your plan includes ${terms.includedBranches} branches. Pay for an extra branch in Settings › Plan & billing, then add it here.`);
}

export async function billingHistory(u: CurrentUser) {
  return db.branchSubscription.findMany({ where: { orgId: u.orgId, status: { in: ["PAID", "SUBMITTED", "REJECTED"] } }, orderBy: { createdAt: "desc" }, take: 50 });
}

export type Checkout =
  | { mode: "DEMO"; id: string; total: number }
  | { mode: "UPI"; id: string; total: number; upiId: string; payee: string; ref: string; link: string; qr: string }
  | { mode: "LIVE"; id: string; total: number; keyId: string; orderId: string; name: string; description: string; prefill: { name: string; email: string } };

export type PaymentFor = { kind: "PLAN"; plan: string } | { kind: "BRANCH"; branchId: string | null };

/** The short code a gym writes in the UPI note so the FITRON team can match the money. */
export const paymentRef = (id: string) => `FIT-${id.slice(-8).toUpperCase()}`;

function describe(what: PaymentFor, cycle: Cycle) {
  const period = cycle === "YEARLY" ? "1 year" : "1 month";
  if (what.kind === "PLAN") return `Gym Accounting ${findPlan(what.plan)?.name ?? what.plan}, ${period}`;
  return `${what.branchId ? "Renew extra branch" : "Extra branch"}, ${period}`;
}

/**
 * Starts a payment to FITRON for the gym's plan (a period of it, or a change to another plan), or
 * an extra branch (a new slot, or another period for an existing branch). Paid by UPI QR + UTR
 * when FITRON_UPI_ID is set, else Razorpay when Fitron's keys are set, else simulated.
 */
export async function startPayment(u: CurrentUser, what: PaymentFor, cycle: Cycle): Promise<Checkout> {
  const plan = await gymPlan(u.orgId);
  let price;
  if (what.kind === "PLAN") {
    const p = findPlan(what.plan);
    if (!p || p.product !== "GYM_ACCOUNTING") throw new UserError("Pick a Gym Accounting plan.");
    if (plan.terms.custom) throw new UserError("Your gym is on a plan FITRON set up for you, so there's nothing to pay here. Write to hello@fitron.in to change it.");
    const branches = await db.branch.count({ where: { orgId: u.orgId, active: true } });
    if (!p.multiBranch && branches > 1) throw new UserError(`You have ${branches} branches, and ${p.name} is for one branch. Stay on Enterprise, or write to hello@fitron.in.`);
    price = planPrice(p.key, cycle);
  } else {
    if (!plan.terms.extraBranches) throw new UserError(`The ${plan.name} plan is for one branch. Move to Enterprise to add more.`);
    if (what.branchId) {
      const { branches } = await branchStandings(u.orgId);
      const b = branches.find((x) => x.id === what.branchId);
      if (!b) throw new UserError("Branch not found.");
      if (b.standing.kind === "INCLUDED") throw new UserError("This branch is included in your plan.");
    }
    price = branchPrice(cycle);
  }
  const upi = fitronUpi();
  const keyId = upi ? null : fitronKeyId();
  const sub = await db.branchSubscription.create({
    data: {
      orgId: u.orgId,
      kind: what.kind,
      plan: what.kind === "PLAN" ? what.plan : null,
      branchId: what.kind === "BRANCH" ? what.branchId : null,
      cycle,
      ...price,
      mode: upi ? "UPI" : keyId ? "LIVE" : "DEMO",
      createdById: u.id,
    },
  });
  const description = `${describe(what, cycle)} (incl. 18% GST)`;
  if (upi) {
    const ref = paymentRef(sub.id);
    const link = upiLink({ id: upi.id, name: upi.name, amount: price.total, note: `${ref} ${describe(what, cycle)}`.slice(0, 50) });
    return { mode: "UPI", id: sub.id, total: price.total, upiId: upi.id, payee: upi.name, ref, link, qr: await qrSvg(link) };
  }
  if (!keyId) return { mode: "DEMO", id: sub.id, total: price.total };
  const order = await createOrder({ amount: price.total, receipt: sub.id, notes: { subscription: sub.id, org: u.orgId, cycle } });
  await db.branchSubscription.update({ where: { id: sub.id }, data: { razorpayOrderId: order.id } });
  const seller = fitronSeller();
  return { mode: "LIVE", id: sub.id, total: price.total, keyId, orderId: order.id, name: seller.name, description, prefill: { name: u.name, email: u.email } };
}

export const startBranchPayment = (u: CurrentUser, cycle: Cycle, branchId: string | null) => startPayment(u, { kind: "BRANCH", branchId }, cycle);

/** The gym paid by UPI and typed the UTR. The FITRON team is told to check it. */
export async function submitUtr(u: CurrentUser, id: string, raw: string) {
  const utr = cleanUtr(raw);
  if (!utr) throw new UserError("A UTR is the 12-digit number your UPI app shows after paying. Check it and try again.");
  const sub = await db.branchSubscription.findFirst({ where: { id, orgId: u.orgId, mode: "UPI" } });
  if (!sub) throw new UserError("Payment not found.");
  if (sub.status !== "PENDING") throw new UserError("This payment already has a UTR. Start a new payment if you paid again.");
  // A UTR is one bank transfer: it can't pay for both a gym plan and an AI Trainer plan.
  if (await db.trainerPayment.findFirst({ where: { utr }, select: { id: true } })) throw new UserError("This UTR was already entered for another payment. Check the number in your UPI app.");
  try {
    await db.$transaction(async (tx) => {
      const after = await tx.branchSubscription.update({ where: { id }, data: { status: "SUBMITTED", utr, submittedAt: new Date() } });
      await audit(tx, { orgId: u.orgId, userId: u.id, action: "billing.utr-submitted", entity: "BranchSubscription", entityId: id, before: sub, after });
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new UserError("This UTR was already entered for another payment. Check the number in your UPI app.");
    throw e;
  }
  const what = sub.kind === "PLAN" ? `Gym Accounting ${findPlan(sub.plan)?.name ?? sub.plan}` : "an extra branch";
  for (const to of fitronAdmins()) {
    await sendEmail({
      to,
      subject: `UPI payment to check: ${(sub.total / 100).toFixed(2)} from ${u.orgName}`,
      text: `${u.orgName} says they paid Rs ${(sub.total / 100).toFixed(2)} for ${what} (${sub.cycle.toLowerCase()}).\n\nUTR: ${utr}\nReference: ${paymentRef(sub.id)}\nBy: ${u.name} <${u.email}>\n\nCheck your bank or UPI app for this UTR, then confirm or reject it:\n${process.env.APP_URL?.trim() || "https://fitron.in"}/fitron-admin`,
    }).catch((e) => log.error("saas.utr_email_failed", e));
  }
}

async function invoiceNumber(tx: Prisma.TransactionClient, today: string) {
  const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('fitron_invoice_seq') AS n`;
  const y = Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 4 ? 1 : 0);
  return `FIT/${y}-${String(y + 1).slice(2)}/${String(n).padStart(5, "0")}`;
}

/**
 * Marks a payment done, once: sets the paid period, gives it a Fitron invoice number, and audits it.
 * A plan payment also switches the gym to that plan at once; its period starts after the current
 * paid period, or after the trial if that is still running.
 */
async function complete(where: { id: string } | { razorpayOrderId: string }, paymentId: string | null, reviewer?: string) {
  const today = todayIso();
  return db.$transaction(async (tx) => {
    const sub = await tx.branchSubscription.findFirst({ where });
    if (!sub) return null;
    await tx.$queryRaw`SELECT id FROM "BranchSubscription" WHERE id = ${sub.id} FOR UPDATE`;
    const fresh = await tx.branchSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    if (fresh.status === "PAID") return fresh;
    let last: string | null = null;
    if (fresh.kind === "PLAN") {
      const org = await tx.organization.findUniqueOrThrow({ where: { id: fresh.orgId } });
      const trialEnd = trialLastDay(org.trialEndsAt);
      last = (await planPaidUntil(tx, fresh.orgId)) ?? (trialEnd && trialEnd >= today ? trialEnd : null);
      await tx.organization.update({ where: { id: fresh.orgId }, data: { plan: fresh.plan!, planCycle: fresh.cycle } });
    } else if (fresh.branchId) {
      last = (await paidUntil(tx, fresh.orgId)).get(fresh.branchId) ?? null;
    }
    const p = nextPeriod(fresh.cycle as Cycle, today, last);
    const after = await tx.branchSubscription.update({
      where: { id: fresh.id },
      data: {
        status: "PAID",
        paidAt: new Date(),
        periodStart: fromIso(p.start),
        periodEnd: fromIso(p.end),
        razorpayPaymentId: paymentId,
        invoiceNo: await invoiceNumber(tx, today),
        ...(reviewer ? { reviewedBy: reviewer, reviewedAt: new Date(), rejectReason: null } : {}),
      },
    });
    await audit(tx, { orgId: fresh.orgId, userId: fresh.createdById, action: fresh.kind === "PLAN" ? "billing.plan-paid" : "billing.branch-paid", entity: "BranchSubscription", entityId: fresh.id, before: fresh, after });
    return after;
  });
}

/** Demo mode only (Fitron's Razorpay keys not set): the payment is simulated. */
export async function confirmDemoPayment(u: CurrentUser, id: string) {
  const sub = await db.branchSubscription.findFirst({ where: { id, orgId: u.orgId } });
  if (!sub || sub.mode !== "DEMO") throw new UserError("Payment not found.");
  return complete({ id }, null);
}

/** Checkout reported success; trust it only if Razorpay's signature checks out. The webhook confirms it too. */
export async function confirmCheckout(u: CurrentUser, a: { orderId: string; paymentId: string; signature: string }) {
  const sub = await db.branchSubscription.findFirst({ where: { razorpayOrderId: a.orderId, orgId: u.orgId } });
  if (!sub) throw new UserError("Payment not found.");
  if (!verifyCheckout(a.orderId, a.paymentId, a.signature)) throw new UserError("Razorpay couldn't confirm this payment. If money left your account, it will show here once Razorpay tells us.");
  return complete({ id: sub.id }, a.paymentId);
}

/** UPI payments waiting for the FITRON team, oldest first, across all gyms. */
export async function paymentsToCheck() {
  const subs = await db.branchSubscription.findMany({ where: { mode: "UPI", status: "SUBMITTED" }, orderBy: { submittedAt: "asc" }, take: 200 });
  const recent = await db.branchSubscription.findMany({ where: { mode: "UPI", reviewedAt: { not: null } }, orderBy: { reviewedAt: "desc" }, take: 20 });
  const orgs = await db.organization.findMany({ where: { id: { in: [...subs, ...recent].map((s) => s.orgId) } }, select: { id: true, name: true } });
  const name = new Map(orgs.map((o) => [o.id, o.name]));
  const row = (s: (typeof subs)[number]) => ({ ...s, gym: name.get(s.orgId) ?? "", ref: paymentRef(s.id), what: s.kind === "PLAN" ? `${findPlan(s.plan)?.name ?? s.plan} plan` : "Extra branch" });
  return { waiting: subs.map(row), recent: recent.map(row) };
}

async function tellGym(orgId: string, text: string, subject: string) {
  await db.$transaction((tx) => notify(tx, { orgId, type: "BILLING", text, link: "/settings/billing" }));
  const owners = await db.user.findMany({ where: { orgId, active: true, deletedAt: null, role: { name: "Super Admin" } }, select: { email: true, name: true } });
  for (const o of owners) await sendEmail({ to: o.email, subject, text: `Hi ${o.name},\n\n${text}\n\nFITRON\nhello@fitron.in` }).catch((e) => log.error("saas.billing_email_failed", e));
}

/** The FITRON team found the UTR in the bank statement (or didn't). Confirming makes it paid and issues the invoice. */
export async function reviewPayment(reviewer: { email: string }, id: string, decision: "CONFIRM" | "REJECT", reason = "") {
  const sub = await db.branchSubscription.findFirst({ where: { id, mode: "UPI", status: { in: ["SUBMITTED", "REJECTED"] } } });
  if (!sub) throw new UserError("This payment isn't waiting for a check.");
  const amount = `Rs ${(sub.total / 100).toFixed(2)}`;
  if (decision === "CONFIRM") {
    const done = await complete({ id }, null, reviewer.email);
    await tellGym(sub.orgId, `We received your UPI payment of ${amount} (UTR ${sub.utr}). It's active now and the invoice is in Settings › Plan & billing.`, "Your FITRON payment is confirmed");
    return done;
  }
  if (!reason.trim()) throw new UserError("Say why, so the gym knows what to fix.");
  await db.branchSubscription.update({ where: { id }, data: { status: "REJECTED", reviewedBy: reviewer.email, reviewedAt: new Date(), rejectReason: reason.trim() } });
  await tellGym(sub.orgId, `We couldn't match your UPI payment of ${amount} (UTR ${sub.utr}): ${reason.trim()}. Check the UTR in your UPI app and pay again, or reply to this email.`, "We couldn't confirm your FITRON payment");
  return null;
}

type RzpEvent = { event?: string; payload?: { payment?: { entity?: { id?: string; order_id?: string; status?: string } } } };

/** Fitron's Razorpay account → payment.captured marks the extra branch paid (idempotent). */
export async function applyFitronBillingEvent(ev: RzpEvent) {
  const pay = ev.payload?.payment?.entity;
  if (ev.event === "payment.captured" && pay?.order_id && pay.id) {
    const done = await complete({ razorpayOrderId: pay.order_id }, pay.id);
    return done ? "paid" : "unknown order";
  }
  if (ev.event === "payment.failed" && pay?.order_id) {
    await db.branchSubscription.updateMany({ where: { razorpayOrderId: pay.order_id, status: "PENDING" }, data: { status: "FAILED" } });
    return "failed";
  }
  return "ignored";
}

export async function getBillingInvoice(u: CurrentUser, id: string) {
  const sub = await db.branchSubscription.findFirst({ where: { id, orgId: u.orgId, status: "PAID" } });
  if (!sub) return null;
  const [branch, gym, tax, anyGstin, cfg] = await Promise.all([
    sub.branchId ? db.branch.findUnique({ where: { id: sub.branchId } }) : null,
    getGymProfile(u.orgId),
    getSetting<{ gstin?: string }>(u.orgId, "tax"),
    db.branch.findFirst({ where: { orgId: u.orgId, gstin: { not: null } }, orderBy: { createdAt: "asc" } }),
    getSubscriptionSettings(u.orgId),
  ]);
  const buyer = branch?.gstin ? branch : anyGstin;
  // Settings › Subscription › Billing details come first; the gym profile and branches fill in what is blank.
  return {
    sub,
    branch,
    buyer: {
      name: cfg.legalName || gym.name || u.orgName,
      gstin: cfg.gstin || buyer?.gstin || tax?.gstin || null,
      address: cfg.address || gym.address || buyer?.address || branch?.address || "",
      email: cfg.billingEmail || "",
    },
    seller: fitronSeller(),
  };
}

type ReminderCounts = { sent: number; whatsapp: number; email: number };

/** One reminder on every channel the gym switched on: the bell, WhatsApp to the gym number, email to the billing email. */
async function deliverReminder(orgId: string, cfg: SubscriptionSettings, text: string, branchId: string | null, n: ReminderCounts) {
  await db.$transaction((tx) => notify(tx, { orgId, branchId, type: "BILLING", text, link: "/settings/billing" }));
  n.sent++;
  if (cfg.whatsapp) {
    const to = await gymWhatsAppNumber(orgId);
    if (to) {
      const m = await sendGymWhatsApp({ orgId, key: "fitron_renewal", to, body: `${text}\n\nPay in FITRON › Settings › Plan & billing.` }).catch((e) => (log.error("saas.renewal_whatsapp_failed", e), null));
      if (m && m.status !== "Failed") n.whatsapp++;
    }
  }
  if (cfg.email) {
    const link = `${process.env.APP_URL?.trim() || "https://fitron.in"}/settings/billing`;
    for (const to of await renewalEmails(orgId, cfg)) {
      const ok = await sendEmail({ to, subject: reminderSubject(text), text: `Hi,\n\n${text}\n\nPay in Settings › Plan & billing: ${link}\n\nFITRON\nhello@fitron.in` })
        .then(() => true)
        .catch((e) => (log.error("saas.renewal_email_failed", e), false));
      if (ok) n.email++;
    }
  }
}

/**
 * Daily: warn the gym before the plan or an extra branch's period ends (as many days ahead as
 * Settings › Subscription says, and again the day before), during grace, and when it turns read-only.
 */
export async function billingReminders(orgId: string, today: string): Promise<ReminderCounts> {
  const [cfg, plan, { branches }] = await Promise.all([getSubscriptionSettings(orgId), gymPlan(orgId, today), branchStandings(orgId, today)]);
  const n: ReminderCounts = { sent: 0, whatsapp: 0, email: 0 };
  const r = renewalReminder(plan.standing, plan.name, today, cfg.remindDays, plan.checking);
  if (r) await deliverReminder(orgId, cfg, r.text, null, n);
  for (const b of branches) {
    const s: Standing = b.standing;
    if (s.kind === "CLOSED") continue;
    let text = "";
    if (s.kind === "PAID" && [cfg.remindDays, 1].includes(daysBetween(s.until, today))) text = `${b.name}'s extra-branch plan ends in ${daysBetween(s.until, today) === 1 ? "1 day" : `${daysBetween(s.until, today)} days`} (${longDate(s.until)}). Renew to keep it running.`;
    if (s.kind === "GRACE") text = `${b.name}'s extra-branch plan has ended. It becomes read-only on ${longDate(s.readOnlyFrom)} unless renewed.`;
    if (s.kind === "READ_ONLY" && s.since === today) text = `${b.name} is now read-only: no new members or invoices until its extra-branch plan is renewed.`;
    if (!text) continue;
    await deliverReminder(orgId, cfg, text, b.id, n);
  }
  return n;
}
