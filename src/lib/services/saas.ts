import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import type { Prisma, RazorpaySubscription } from "@/generated/prisma/client";
import { addDays, daysBetween } from "@/lib/domain/dates";
import { findPlan } from "@/lib/domain/pricing";
import { BRANCH_PLAN_KEY, razorpayPlan, RENEWING_STATUSES } from "@/lib/domain/razorpay-plans";
import { branchPrice, gstInside, gymTerms, longDate, nextPeriod, planPrice, planStanding, planWritable, reminderSubject, renewalReminder, standings, type Cycle, type GymTerms, type PlanStanding, type Standing, type SubscriptionSettings } from "@/lib/domain/saas";
import { findService, servicePaise } from "@/lib/domain/services";
import { createOrder, fitronKeyId, getFitronPayment, verifyCheckout, verifySubscriptionPayment } from "@/lib/integrations/razorpay";
import { cleanUtr, fitronAdmins, fitronUpi, qrSvg, upiLink } from "@/lib/integrations/upi";
import { sendEmail } from "@/lib/integrations/email";
import { audit } from "./audit";
import { isUniqueViolation, UserError } from "./errors";
import { notify } from "./notifications";
import { getGymProfile, getSetting } from "./settings";
import { getSubscriptionSettings, gymWhatsAppNumber, renewalEmails } from "./subscription";
import { createSubscription, lockSubscription, markCharged, renewingSubscriptions, stopSubscription, syncSubscription, type SubscriptionEntity } from "./subscriptions";
import { recordTrainerCharge, trainerRenewalTrouble } from "./trainer-billing";
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
  // A slot paid for by a renewing subscription: its renewals now pay for this branch.
  if (claimed.count && slot?.razorpaySubscriptionId) await tx.razorpaySubscription.updateMany({ where: { id: slot.razorpaySubscriptionId, branchId: null }, data: { branchId } });
  if (!claimed.count) throw new UserError(`Your plan includes ${terms.includedBranches} branches. Pay for an extra branch in Settings › Plan & billing, then add it here.`);
}

export async function billingHistory(u: CurrentUser) {
  return db.branchSubscription.findMany({ where: { orgId: u.orgId, status: { in: ["PAID", "SUBMITTED", "REJECTED"] } }, orderBy: { createdAt: "desc" }, take: 50 });
}

export type Checkout =
  | { mode: "DEMO"; id: string; total: number }
  | { mode: "UPI"; id: string; total: number; upiId: string; payee: string; ref: string; link: string; qr: string }
  /** Razorpay Checkout for one payment (a period at a time, or an add-on). */
  | { mode: "LIVE"; id: string; total: number; keyId: string; orderId: string; name: string; description: string; prefill: { name: string; email: string } }
  /** Razorpay Checkout for a plan that renews itself: the first payment authorises every later one. */
  | { mode: "SUBSCRIPTION"; id: string; total: number; keyId: string; subscriptionId: string; name: string; description: string; prefill: { name: string; email: string } };

/** An add-on's `amount` is in whole rupees and only counts for quoted add-ons (see services.ts). */
export type PaymentFor = { kind: "PLAN"; plan: string } | { kind: "BRANCH"; branchId: string | null } | { kind: "SERVICE"; service: string; amount?: number };

/** The short code a gym writes in the UPI note so the FITRON team can match the money. */
export const paymentRef = (id: string) => `FIT-${id.slice(-8).toUpperCase()}`;

function describe(what: PaymentFor, cycle: Cycle | "ONCE") {
  if (what.kind === "SERVICE") return findService(what.service)?.name ?? "Add-on";
  const period = cycle === "YEARLY" ? "1 year" : "1 month";
  if (what.kind === "PLAN") return `${findPlan(what.plan)?.product === "PARTNER" ? "Gym Partnership" : "Gym Accounting"} ${findPlan(what.plan)?.name ?? what.plan}, ${period}`;
  return `${what.branchId ? "Renew extra branch" : "Extra branch"}, ${period}`;
}

/**
 * Starts a payment to FITRON for the gym's plan (a period of it, or a change to another plan), a Gym Partnership
 * plan, an extra branch (a new slot, or another period for an existing branch) or a one-time add-on. Listed prices
 * include GST. With Fitron's Razorpay keys set, a plan or branch that has a Razorpay plan is a subscription that
 * renews itself, and anything else is one Razorpay payment; otherwise it is paid by UPI QR + UTR when FITRON_UPI_ID
 * is set, else simulated (development only: a production server refuses).
 */
export async function startPayment(u: CurrentUser, what: PaymentFor, cycle: Cycle | "ONCE"): Promise<Checkout> {
  const plan = await gymPlan(u.orgId);
  let price;
  if (what.kind === "SERVICE") {
    const service = findService(what.service);
    if (!service) throw new UserError("Pick an add-on.");
    try {
      price = gstInside(servicePaise(service, what.amount));
    } catch (e) {
      throw new UserError((e as Error).message);
    }
    cycle = "ONCE";
  } else if (cycle === "ONCE") {
    throw new UserError("Pick monthly or yearly.");
  } else if (what.kind === "PLAN") {
    const p = findPlan(what.plan);
    if (!p || (p.product !== "GYM_ACCOUNTING" && p.product !== "PARTNER")) throw new UserError("Pick a Gym Accounting or Gym Partnership plan.");
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
  const keyId = fitronKeyId();
  const upi = keyId ? null : fitronUpi();
  // Demo payments move no money and are marked paid by the gym itself, so a live server never starts one.
  if (!upi && !keyId && process.env.NODE_ENV === "production") throw new UserError("Payments to FITRON aren't switched on yet. Write to hello@fitron.in and we will set up your plan.");
  const renews = keyId && what.kind !== "SERVICE" ? razorpayPlan(what.kind === "PLAN" ? what.plan : BRANCH_PLAN_KEY, cycle) : null;
  if (renews && what.kind !== "SERVICE") {
    // The same plan and cycle already renewing, or that branch already renewing: a second subscription would charge twice.
    const live = await renewingSubscriptions({ orgId: u.orgId, kind: what.kind === "PLAN" ? "GYM_PLAN" : "BRANCH" });
    const twin = live.find((s) => s.cycle === cycle && (what.kind === "PLAN" ? s.plan === what.plan : !!what.branchId && s.branchId === what.branchId));
    if (twin) throw new UserError(`${describe(what, cycle).replace(/, 1 (month|year)$/, "")} already renews automatically${twin.nextChargeAt ? ` (next charge ${longDate(toIso(twin.nextChargeAt))})` : ""}. To change it, pick another plan, or cancel the renewal under Automatic renewals.`);
  }
  const mode = renews ? "SUBSCRIPTION" : keyId ? "LIVE" : upi ? "UPI" : "DEMO";
  // Razorpay first: if it refuses, nothing is left half-made here.
  const rz = renews ? await createSubscription({ kind: what.kind === "PLAN" ? "GYM_PLAN" : "BRANCH", plan: what.kind === "PLAN" ? what.plan : null, cycle: cycle as Cycle, expectedTotal: price.total, orgId: u.orgId, branchId: what.kind === "BRANCH" ? what.branchId : null }) : null;
  const sub = await db.branchSubscription.create({
    data: {
      orgId: u.orgId,
      kind: what.kind,
      plan: what.kind === "PLAN" ? what.plan : what.kind === "SERVICE" ? what.service : null,
      branchId: what.kind === "BRANCH" ? what.branchId : null,
      cycle,
      ...price,
      mode,
      razorpaySubscriptionId: rz?.id ?? null,
      createdById: u.id,
    },
  });
  const description = `${describe(what, cycle)} (GST included)`;
  if (upi) {
    const ref = paymentRef(sub.id);
    const link = upiLink({ id: upi.id, name: upi.name, amount: price.total, note: `${ref} ${describe(what, cycle)}`.slice(0, 50) });
    return { mode: "UPI", id: sub.id, total: price.total, upiId: upi.id, payee: upi.name, ref, link, qr: await qrSvg(link) };
  }
  if (!keyId) return { mode: "DEMO", id: sub.id, total: price.total };
  const seller = fitronSeller();
  const prefill = { name: u.name, email: u.email };
  if (rz) return { mode: "SUBSCRIPTION", id: sub.id, total: price.total, keyId, subscriptionId: rz.id, name: seller.name, description, prefill };
  const order = await createOrder({ amount: price.total, receipt: sub.id, notes: { subscription: sub.id, org: u.orgId, cycle } });
  await db.branchSubscription.update({ where: { id: sub.id }, data: { razorpayOrderId: order.id } });
  return { mode: "LIVE", id: sub.id, total: price.total, keyId, orderId: order.id, name: seller.name, description, prefill };
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
  const what = sub.kind === "PLAN" ? `Gym Accounting ${findPlan(sub.plan)?.name ?? sub.plan}` : sub.kind === "SERVICE" ? (findService(sub.plan)?.name ?? "an add-on") : "an extra branch";
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
 * A plan payment also switches the gym to that plan at once (unless `keepPlan`: the payment came from a
 * subscription the gym has already moved off); its period starts after the current paid period, or after
 * the trial if that is still running. An add-on has no period and changes nothing else.
 */
async function completeIn(tx: Prisma.TransactionClient, where: { id: string } | { razorpayOrderId: string }, paymentId: string | null, reviewer?: string, opts: { keepPlan?: boolean } = {}) {
  const today = todayIso();
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
    if (!opts.keepPlan) await tx.organization.update({ where: { id: fresh.orgId }, data: { plan: fresh.plan!, planCycle: fresh.cycle } });
  } else if (fresh.branchId) {
    last = (await paidUntil(tx, fresh.orgId)).get(fresh.branchId) ?? null;
  }
  const p = fresh.kind === "SERVICE" ? null : nextPeriod(fresh.cycle as Cycle, today, last);
  const after = await tx.branchSubscription.update({
    where: { id: fresh.id },
    data: {
      status: "PAID",
      paidAt: new Date(),
      ...(p ? { periodStart: fromIso(p.start), periodEnd: fromIso(p.end) } : {}),
      razorpayPaymentId: paymentId,
      invoiceNo: await invoiceNumber(tx, today),
      ...(reviewer ? { reviewedBy: reviewer, reviewedAt: new Date(), rejectReason: null } : {}),
    },
  });
  const action = fresh.kind === "PLAN" ? "billing.plan-paid" : fresh.kind === "SERVICE" ? "billing.service-paid" : "billing.branch-paid";
  await audit(tx, { orgId: fresh.orgId, userId: fresh.createdById, action, entity: "BranchSubscription", entityId: fresh.id, before: fresh, after });
  return after;
}

const complete = (where: { id: string } | { razorpayOrderId: string }, paymentId: string | null, reviewer?: string) => db.$transaction((tx) => completeIn(tx, where, paymentId, reviewer));

/** Demo mode only (neither FITRON_UPI_ID nor Fitron's Razorpay keys set): the payment is simulated. Never on a live server. */
export async function confirmDemoPayment(u: CurrentUser, id: string) {
  if (process.env.NODE_ENV === "production") throw new UserError("Payments to FITRON are confirmed by the FITRON team. Write to hello@fitron.in.");
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

/**
 * A charge on a gym's Razorpay subscription: Checkout's reply for the first payment, or Razorpay's webhook for any
 * payment. The first charge pays the row made when the gym started; every renewal after it is a new row, with its
 * own period and invoice. One at a time per subscription, and a payment already recorded changes nothing.
 */
async function recordGymCharge(subId: string, paymentId: string, amount: number | null) {
  const out = await db.$transaction(async (tx) => {
    await lockSubscription(tx, subId);
    const seen = await tx.branchSubscription.findUnique({ where: { razorpayPaymentId: paymentId } });
    if (seen) return { row: seen, fresh: false, sub: null, renewal: false };
    const sub = await tx.razorpaySubscription.findUniqueOrThrow({ where: { id: subId } });
    if (!sub.orgId) throw new Error(`Subscription ${subId} has no gym`);
    let row = await tx.branchSubscription.findFirst({ where: { razorpaySubscriptionId: subId, status: "PENDING" }, orderBy: { createdAt: "asc" } });
    const renewal = !row;
    const listed = amount ?? razorpayPlan(sub.kind === "BRANCH" ? BRANCH_PLAN_KEY : sub.plan, sub.cycle)?.amount;
    if (!listed) throw new Error(`Don't know what subscription ${subId} charges`);
    if (!row) {
      const prior = await tx.branchSubscription.findFirst({ where: { razorpaySubscriptionId: subId }, orderBy: { createdAt: "desc" } });
      const by = prior?.createdById ?? (await tx.user.findFirst({ where: { orgId: sub.orgId, active: true }, orderBy: { createdAt: "asc" }, select: { id: true } }))?.id;
      if (!by) throw new Error(`Gym ${sub.orgId} has nobody to record a renewal against`);
      row = await tx.branchSubscription.create({
        data: { orgId: sub.orgId, kind: sub.kind === "BRANCH" ? "BRANCH" : "PLAN", plan: sub.plan, branchId: sub.branchId, cycle: sub.cycle, ...gstInside(listed), mode: "SUBSCRIPTION", razorpaySubscriptionId: subId, createdById: by },
      });
    } else if (row.total !== listed) {
      // Razorpay charged something other than what the price list said: books and invoice follow what was really paid.
      log.warn("saas.subscription_amount_differs", new Error(`Subscription ${subId} charged ${listed}, expected ${row.total}`));
      row = await tx.branchSubscription.update({ where: { id: row.id }, data: gstInside(listed) });
    }
    // A subscription the gym has already moved off (new plan paid, or renewal cancelled) must not flip the plan back.
    const movedOn = sub.kind === "GYM_PLAN" && !!sub.cancelledAt && !!(await tx.branchSubscription.findFirst({ where: { orgId: sub.orgId, kind: "PLAN", status: "PAID", createdAt: { gt: sub.createdAt }, NOT: { razorpaySubscriptionId: subId } }, select: { id: true } }));
    const done = await completeIn(tx, { id: row.id }, paymentId, undefined, { keepPlan: movedOn });
    await markCharged(tx, subId);
    return { row: done!, fresh: true, sub, renewal };
  });
  if (out.fresh && out.sub) {
    const sub = out.sub as RazorpaySubscription;
    // We had stopped this one but it charged anyway (the stop never reached Razorpay): try again.
    if (sub.cancelledAt) await stopSubscription(sub.id);
    // The gym paid for another plan: the old plan's renewal ends so it is not charged twice.
    else if (sub.kind === "GYM_PLAN" && !out.renewal) for (const other of await renewingSubscriptions({ orgId: sub.orgId!, kind: "GYM_PLAN" })) if (other.id !== sub.id) await stopSubscription(other.id);
    if (out.renewal && out.row.status === "PAID") {
      const what = sub.kind === "BRANCH" ? "extra branch" : `${findPlan(sub.plan)?.name ?? sub.plan} plan`;
      await tellGym(sub.orgId!, `Your ${what} renewed automatically: Rs ${(out.row.total / 100).toFixed(2)} charged, valid till ${out.row.periodEnd ? longDate(toIso(out.row.periodEnd)) : ""}. The invoice is in Settings › Plan & billing.`, "Your FITRON plan renewed");
    }
  }
  return out;
}

/**
 * Checkout's success handler for a subscription. Trusted only when Razorpay's signature checks out and Razorpay says the
 * payment went through; the webhook records it too, whichever comes first.
 */
export async function confirmSubscription(u: CurrentUser, a: { paymentId: string; subscriptionId: string; signature: string }) {
  const sub = await db.razorpaySubscription.findFirst({ where: { id: a.subscriptionId, orgId: u.orgId, kind: { in: ["GYM_PLAN", "BRANCH"] } } });
  if (!sub) throw new UserError("Payment not found.");
  if (!verifySubscriptionPayment(a.paymentId, a.subscriptionId, a.signature)) throw new UserError("Razorpay couldn't confirm this payment. If money left your account, it will show here once Razorpay tells us.");
  const pay = await getFitronPayment(a.paymentId);
  if (pay.status !== "captured") return { status: "PROCESSING" as const };
  const { row } = await recordGymCharge(sub.id, a.paymentId, pay.amount ?? null);
  return { status: row.status === "PAID" ? ("PAID" as const) : ("PROCESSING" as const) };
}

/** The plans and branches of this gym that renew themselves, for Settings › Plan & billing. */
export async function autoRenewals(orgId: string) {
  const subs = await renewingSubscriptions({ orgId });
  const { branches } = await branchStandings(orgId);
  return subs.map((s) => ({
    id: s.id,
    kind: s.kind,
    cycle: s.cycle as Cycle,
    nextChargeAt: s.nextChargeAt ? toIso(s.nextChargeAt) : null,
    status: s.status,
    /** The gym asked to stop it but Razorpay hasn't confirmed: it may still charge, and stopping can be tried again. */
    stopPending: !!s.cancelledAt,
    what: s.kind === "BRANCH" ? `Extra branch${s.branchId ? ` · ${branches.find((b) => b.id === s.branchId)?.name ?? ""}` : " · not used yet"}` : `${findPlan(s.plan)?.name ?? s.plan} plan`,
  }));
}

/** The gym stops a plan or branch renewing. What it already paid for stays valid to the end of the period. A stop Razorpay didn't confirm can be tried again. */
export async function cancelAutoRenewal(u: CurrentUser, id: string) {
  const sub = await db.razorpaySubscription.findFirst({ where: { id, orgId: u.orgId, kind: { in: ["GYM_PLAN", "BRANCH"] } } });
  if (!sub || !(RENEWING_STATUSES as readonly string[]).includes(sub.status)) throw new UserError("This plan isn't renewing automatically.");
  if (!(await stopSubscription(id))) throw new UserError("We couldn't reach Razorpay to stop the renewal just now. Nothing was changed on your side; try again in a minute.");
  await db.$transaction((tx) => audit(tx, { orgId: u.orgId, userId: u.id, action: "billing.autorenew-cancelled", entity: "RazorpaySubscription", entityId: id, before: sub, after: { ...sub, status: "cancelled" } }));
}

/** UPI payments waiting for the FITRON team, oldest first, across all gyms. */
export async function paymentsToCheck() {
  const subs = await db.branchSubscription.findMany({ where: { mode: "UPI", status: "SUBMITTED" }, orderBy: { submittedAt: "asc" }, take: 200 });
  const recent = await db.branchSubscription.findMany({ where: { mode: "UPI", reviewedAt: { not: null } }, orderBy: { reviewedAt: "desc" }, take: 20 });
  const orgs = await db.organization.findMany({ where: { id: { in: [...subs, ...recent].map((s) => s.orgId) } }, select: { id: true, name: true } });
  const name = new Map(orgs.map((o) => [o.id, o.name]));
  const row = (s: (typeof subs)[number]) => ({ ...s, gym: name.get(s.orgId) ?? "", ref: paymentRef(s.id), what: s.kind === "PLAN" ? `${findPlan(s.plan)?.name ?? s.plan} plan` : s.kind === "SERVICE" ? (findService(s.plan)?.name ?? "Add-on") : "Extra branch" });
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
  // The audit row has no gym user as actor (the reviewer belongs to the FITRON team); who decided, and why, are in `after`.
  await db.$transaction(async (tx) => {
    const after = await tx.branchSubscription.update({ where: { id }, data: { status: "REJECTED", reviewedBy: reviewer.email, reviewedAt: new Date(), rejectReason: reason.trim() } });
    await audit(tx, { orgId: sub.orgId, userId: null, action: "billing.utr-rejected", entity: "BranchSubscription", entityId: id, before: sub, after });
  });
  await tellGym(sub.orgId, `We couldn't match your UPI payment of ${amount} (UTR ${sub.utr}): ${reason.trim()}. Check the UTR in your UPI app and pay again, or reply to this email.`, "We couldn't confirm your FITRON payment");
  return null;
}

type RzpPayment = { id?: string; order_id?: string; status?: string; amount?: number };
type RzpEvent = { event?: string; payload?: { payment?: { entity?: RzpPayment }; subscription?: { entity?: SubscriptionEntity } } };

const subscriptionWhat = (s: { kind: string; plan: string | null }) => (s.kind === "BRANCH" ? "extra branch" : `${findPlan(s.plan)?.name ?? s.plan} plan`);

/** subscription.* events: a charge becomes a paid period; the rest keep our copy of the state, and a failing renewal tells the gym or member. */
async function applySubscriptionEvent(event: string, e: SubscriptionEntity, pay: RzpPayment | undefined) {
  const sub = await db.razorpaySubscription.findUnique({ where: { id: e.id! } });
  // Made by hand in Razorpay's dashboard, or in another environment: nothing here to update.
  if (!sub) return "unknown subscription";
  if (event === "subscription.charged") {
    if (!pay?.id || (pay.status && pay.status !== "captured")) return "ignored";
    const out = sub.kind === "TRAINER" ? await recordTrainerCharge(sub.id, pay.id, pay.amount ?? null) : await recordGymCharge(sub.id, pay.id, pay.amount ?? null);
    await syncSubscription(e);
    return out.fresh ? "paid" : "already recorded";
  }
  const after = await syncSubscription(e);
  if ((event === "subscription.pending" || event === "subscription.halted") && after && after.status !== sub.status) {
    if (sub.kind === "TRAINER") await trainerRenewalTrouble(sub, event === "subscription.halted");
    else {
      const what = subscriptionWhat(sub);
      await tellGym(
        sub.orgId!,
        event === "subscription.halted"
          ? `Automatic renewal of your ${what} has stopped after repeated failed charges. It stays active until the end of the period you already paid for. To keep it going, pay again in Settings › Plan & billing.`
          : `We couldn't charge the renewal of your ${what}. Razorpay will try again in a day or two, so check that your UPI app or card has the money. It stays active until the end of the period you already paid for.`,
        event === "subscription.halted" ? "Your FITRON plan stopped renewing" : "Your FITRON renewal payment failed",
      );
    }
  }
  return "synced";
}

/** Fitron's Razorpay account: payment.captured marks a one-time payment paid, subscription.charged each period of a renewing plan (idempotent). */
export async function applyFitronBillingEvent(ev: RzpEvent) {
  const pay = ev.payload?.payment?.entity;
  const subscription = ev.payload?.subscription?.entity;
  if (ev.event?.startsWith("subscription.") && subscription?.id) return applySubscriptionEvent(ev.event, subscription, pay);
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
