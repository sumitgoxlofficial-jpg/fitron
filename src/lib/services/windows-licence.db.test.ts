import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { hasDb } from "@/test/db";
import { newSigningKey } from "@/lib/licence/issue";
import { verifyLicence } from "@/lib/licence/licence";
import { buyerDetails } from "@/lib/domain/windows-licence";
import { addDays, membershipEndDate } from "@/lib/domain/dates";
import { applyFitronBillingEvent } from "./saas";
import { applyWindowsLicencePayment, claimWindowsLicence, confirmWindowsLicenceCheckout, confirmWindowsLicenceDemo, quoteWindowsCoupon, startWindowsLicence } from "./windows-licence";
import { todayIso, toIso } from "./time";

// fitron.in's side of buying a FITRON for Windows licence (docs/local-windows/LICENSING.md).
describe.skipIf(!hasDb)("FITRON for Windows licences bought on fitron.in (database)", () => {
  const key = newSigningKey("fitron-online-test");
  const today = todayIso();
  const buyer = { licensee: "Iron Gym, Pune", email: "owner@irongym.in", phone: "98765 43210", gstin: "" };
  let installationId: string;
  let claim: string;

  beforeEach(() => {
    vi.stubEnv("FITRON_RAZORPAY_KEY_ID", "");
    vi.stubEnv("FITRON_RAZORPAY_KEY_SECRET", "");
    vi.stubEnv("FITRON_LICENCE_SIGNING_KEY_ID", key.trusted.id);
    vi.stubEnv("FITRON_LICENCE_SIGNING_KEY", key.privatePem.replace(/\n/g, "\\n"));
    installationId = randomUUID();
    claim = randomBytes(32).toString("base64url");
  });
  afterEach(() => vi.unstubAllEnvs());

  const buy = (plan = "professional", cycle = "YEARLY", c = claim) => startWindowsLicence({ installationId, claim: c, plan, cycle, ...buyer });

  it("sells a plan at fitron.in's price and signs a licence for that one computer", async () => {
    const c = await buy();
    expect(c).toMatchObject({ mode: "DEMO", total: 19_99_000 });
    expect(await claimWindowsLicence({ installationId, claim })).toEqual({ status: "pending" });

    const paid = await confirmWindowsLicenceDemo(c.id);
    expect(paid?.status).toBe("PAID");
    expect(paid?.invoiceNo).toMatch(/^FIT\/\d{4}-\d{2}\/\d{5}$/);
    expect(paid).toMatchObject({ base: 16_94_068, gst: 3_04_932, phone: "9876543210" });
    expect(toIso(paid!.periodStart!)).toBe(today);
    expect(toIso(paid!.periodEnd!)).toBe(membershipEndDate(today, 12));

    const got = await claimWindowsLicence({ installationId, claim });
    expect(got.status).toBe("paid");
    const v = verifyLicence(got.status === "paid" ? got.licence : "", [key.trusted]);
    expect(v.ok && v.licence).toMatchObject({ edition: "local", plan: "professional", branches: 1, installationId, licensee: "Iron Gym, Pune", expiresOn: membershipEndDate(today, 12), graceDays: 15 });
    // Confirming twice changes nothing.
    expect((await confirmWindowsLicenceDemo(c.id))?.invoiceNo).toBe(paid?.invoiceNo);
  });

  it("gives the licence only to the computer and claim that bought it", async () => {
    const c = await buy();
    await confirmWindowsLicenceDemo(c.id);
    expect(await claimWindowsLicence({ installationId, claim: randomBytes(32).toString("base64url") })).toEqual({ status: "none" });
    expect(await claimWindowsLicence({ installationId: randomUUID(), claim })).toEqual({ status: "none" });
    expect(await claimWindowsLicence({ installationId: "x", claim: "short" })).toEqual({ status: "none" });
  });

  it("starts a renewal when the computer's current licence ends, and Enterprise allows its branches", async () => {
    await confirmWindowsLicenceDemo((await buy("starter", "MONTHLY")).id);
    const next = randomBytes(32).toString("base64url");
    const again = await confirmWindowsLicenceDemo((await buy("enterprise", "YEARLY", next)).id);
    const firstEnd = membershipEndDate(today, 1);
    expect(toIso(again!.periodStart!)).toBe(addDays(firstEnd, 1));
    const got = await claimWindowsLicence({ installationId, claim: next });
    const v = verifyLicence(got.status === "paid" ? got.licence : "", [key.trusted]);
    expect(v.ok && v.licence).toMatchObject({ plan: "enterprise", branches: 3, expiresOn: toIso(again!.periodEnd!) });
  });

  it("keeps a payment made while the signing key is missing, and signs it once the key is set", async () => {
    vi.stubEnv("FITRON_LICENCE_SIGNING_KEY", "");
    const paid = await confirmWindowsLicenceDemo((await buy()).id);
    expect(paid).toMatchObject({ status: "PAID", licenceText: null });
    expect(await claimWindowsLicence({ installationId, claim })).toEqual({ status: "preparing" });
    vi.stubEnv("FITRON_LICENCE_SIGNING_KEY", key.privatePem);
    const got = await claimWindowsLicence({ installationId, claim });
    expect(got.status).toBe("paid");
    expect((await db.windowsLicenceOrder.findUniqueOrThrow({ where: { id: paid!.id } })).licenceText).toBe(got.status === "paid" ? got.licence : "");
  });

  it("is confirmed by Razorpay's signature or its webhook, never by a wrong amount", async () => {
    const order = await db.windowsLicenceOrder.create({ data: { installationId, claimHash: "x".repeat(64), plan: "starter", cycle: "MONTHLY", base: 84_661, gst: 15_239, total: 99_900, licensee: "Iron Gym", email: "a@b.in", razorpayOrderId: `order_${randomUUID()}` } });
    vi.stubEnv("FITRON_RAZORPAY_KEY_SECRET", "secret");
    await expect(confirmWindowsLicenceCheckout({ orderId: order.razorpayOrderId!, paymentId: "pay_1", signature: "bad" })).rejects.toThrow(/couldn't confirm/);
    const ev = (amount: number, id: string) => ({ event: "payment.captured", payload: { payment: { entity: { id, order_id: order.razorpayOrderId!, amount, status: "captured" } } } });
    expect(await applyFitronBillingEvent(ev(100, `pay_${randomUUID()}`))).toBe("held");
    expect((await db.windowsLicenceOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING");
    const payId = `pay_${randomUUID()}`;
    const sig = createHmac("sha256", "secret").update(`${order.razorpayOrderId}|${payId}`).digest("hex");
    expect(await confirmWindowsLicenceCheckout({ orderId: order.razorpayOrderId!, paymentId: payId, signature: sig })).toEqual({ paid: true });
    // The webhook arriving afterwards finds it paid.
    expect(await applyFitronBillingEvent(ev(99_900, payId))).toBe("paid");
    const after = await db.windowsLicenceOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(after).toMatchObject({ status: "PAID", razorpayPaymentId: payId });
    expect(after.licenceText).toMatch(/^FITRON-LICENCE-1\./);
  });

  const coupon = (over: { percentOff?: number; payPaise?: number | null; appliesTo?: string; usageLimit?: number | null; validTill?: Date | null } = {}) =>
    db.coupon.create({ data: { code: `WIN${randomBytes(4).toString("hex").toUpperCase()}`, percentOff: 20, appliesTo: "GYM", createdBy: "test", ...over } });

  it("takes a coupon before paying: the order, the invoice and the licence are at the coupon's price, and it is used once", async () => {
    const c20 = await coupon({ percentOff: 20 });
    const q = await quoteWindowsCoupon({ installationId, claim, plan: "professional", cycle: "YEARLY", coupon: c20.code.toLowerCase() });
    expect(q).toEqual({ code: c20.code, label: "20% off", listTotal: 19_99_000, discount: 3_99_800, total: 15_99_200 });
    const c = await startWindowsLicence({ installationId, claim, plan: "professional", cycle: "YEARLY", ...buyer, coupon: c20.code });
    expect(c).toMatchObject({ mode: "DEMO", total: 15_99_200 });
    expect(await db.couponRedemption.findUnique({ where: { paymentId: c.id } })).toMatchObject({ installationId, status: "PENDING", listTotal: 19_99_000, discount: 3_99_800, paid: 15_99_200 });
    const paid = await confirmWindowsLicenceDemo(c.id);
    expect(paid).toMatchObject({ status: "PAID", total: 15_99_200, couponCode: c20.code, discount: 3_99_800 });
    expect(paid!.base + paid!.gst).toBe(15_99_200);
    expect((await db.couponRedemption.findUniqueOrThrow({ where: { paymentId: c.id } })).status).toBe("USED");
    expect((await claimWindowsLicence({ installationId, claim })).status).toBe("paid");
    // The same computer cannot use it again; another computer can.
    await expect(quoteWindowsCoupon({ installationId, claim, plan: "starter", cycle: "MONTHLY", coupon: c20.code })).rejects.toThrow(/already used/);
    await expect(quoteWindowsCoupon({ installationId: randomUUID(), claim, plan: "starter", cycle: "MONTHLY", coupon: c20.code })).resolves.toMatchObject({ total: 79_920 });
  });

  it("gives the licence at once for a 100% coupon, with no payment to make", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const free = await coupon({ percentOff: 100 });
    const c = await startWindowsLicence({ installationId, claim, plan: "starter", cycle: "YEARLY", ...buyer, coupon: free.code });
    expect(c).toEqual({ mode: "FREE", id: expect.any(String), total: 0 });
    expect(await db.windowsLicenceOrder.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ status: "PAID", total: 0, base: 0, gst: 0, razorpayOrderId: null });
    expect((await claimWindowsLicence({ installationId, claim })).status).toBe("paid");
  });

  it("refuses a coupon that is unknown, paused, expired, used up or only for the AI Trainer, and gives a failed payment's use back", async () => {
    const ask = (code: string) => quoteWindowsCoupon({ installationId, claim, plan: "starter", cycle: "YEARLY", coupon: code });
    await expect(ask("NOSUCHCODE")).rejects.toThrow(/isn't valid/);
    await expect(ask((await coupon({ appliesTo: "TRAINER" })).code)).rejects.toThrow(/only works on AI Trainer plans/);
    await expect(ask((await coupon({ validTill: new Date("2020-01-01") })).code)).rejects.toThrow(/expired/);
    const paused = await coupon();
    await db.coupon.update({ where: { id: paused.id }, data: { status: "PAUSED" } });
    await expect(ask(paused.code)).rejects.toThrow(/isn't valid/);
    // One use: held by a payment started on another computer, given back when that payment fails.
    const one = await coupon({ usageLimit: 1 });
    vi.stubEnv("FITRON_RAZORPAY_KEY_ID", "rzp_test_x");
    vi.stubEnv("FITRON_RAZORPAY_KEY_SECRET", "secret");
    const other = randomUUID();
    const held = await db.windowsLicenceOrder.create({ data: { installationId: other, claimHash: "h", plan: "starter", cycle: "YEARLY", base: 1, gst: 0, total: 1, licensee: "X", email: "x@y.in", razorpayOrderId: `order_${randomUUID()}` } });
    await db.couponRedemption.create({ data: { couponId: one.id, installationId: other, paymentId: held.id, listTotal: 9_99_000, discount: 1_99_800, paid: 7_99_200 } });
    await expect(ask(one.code)).rejects.toThrow(/fully used/);
    expect(await applyWindowsLicencePayment("payment.failed", { order_id: held.razorpayOrderId! })).toBe("failed");
    expect((await db.couponRedemption.findUniqueOrThrow({ where: { paymentId: held.id } })).status).toBe("RELEASED");
    await expect(ask(one.code)).resolves.toMatchObject({ code: one.code });
  });

  it("asks for the buyer's details it writes on the licence and receipt", () => {
    expect(buyerDetails({ licensee: " Iron  Gym ", email: "A@B.IN" })).toEqual({ licensee: "Iron Gym", email: "a@b.in", phone: null, gstin: null });
    expect(buyerDetails({ licensee: "I", email: "a@b.in" })).toHaveProperty("error");
    expect(buyerDetails({ licensee: "Iron Gym", email: "nope" })).toHaveProperty("error");
    expect(buyerDetails({ licensee: "Iron Gym", email: "a@b.in", gstin: "27AAAPL1234C1Z5" })).toMatchObject({ gstin: "27AAAPL1234C1Z5" });
    expect(buyerDetails({ licensee: "Iron Gym", email: "a@b.in", gstin: "123" })).toHaveProperty("error");
  });

  it("refuses an incomplete link or an unknown plan", async () => {
    await expect(startWindowsLicence({ installationId, claim: "short", plan: "starter", cycle: "YEARLY", ...buyer })).rejects.toThrow(/not complete/);
    await expect(startWindowsLicence({ installationId, claim, plan: "ai-pro", cycle: "YEARLY", ...buyer })).rejects.toThrow(/Pick a plan/);
  });
});
