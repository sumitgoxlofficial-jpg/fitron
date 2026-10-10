import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, daysBetween } from "@/lib/domain/dates";
import { hasDb, makeGym, pick } from "@/test/db";
import { createMember, summarize } from "./members";
import { createPlan } from "./plans";
import { cancelInvoice, sellMembership } from "./billing";
import { expiryKey, lastRenewalReminders, remindAllOverdue, remindDue, remindRenewal, renewalAmounts, sendInvoiceWhatsApp } from "./reminders";
import { todayIso } from "./time";

describe.skipIf(!hasDb)("reminders (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  let owing: string;
  let ending: string;
  let fortnight: string;

  beforeAll(async () => {
    gym = await makeGym();
    const admin = pick(await gym.user("Super Admin"), gym.a.id);
    const today = todayIso();
    const plan = await createPlan(admin, { name: "Monthly", kind: "Membership", months: 1, price: 150000, regFee: 0, discount: 0, gstApplicable: false, features: [] });
    owing = (await createMember(admin, { name: "Owes", gender: "Male", phone: "9876522001", source: "Walk-in", tags: [] })).id;
    ending = (await createMember(admin, { name: "Ends Soon", gender: "Female", phone: "9876522002", source: "Walk-in", tags: [] })).id;
    const sale = await sellMembership(admin, owing, { planId: plan.id, startDate: addDays(today, -20), discount: 0, includeRegFee: false, payAmount: 0 });
    // Make the unpaid invoice overdue.
    await db.invoice.update({ where: { id: sale.invoice.id }, data: { dueDate: new Date(`${addDays(today, -10)}T00:00:00Z`) } });
    await sellMembership(admin, ending, { planId: plan.id, startDate: addDays(today, -28), discount: 10000, includeRegFee: false, payAmount: 140000, payMethod: "UPI" });
    fortnight = (await createMember(admin, { name: "Ends In Two Weeks", gender: "Male", phone: "9876522003", source: "Walk-in", tags: [] })).id;
    // A one-month plan starting so that it ends in exactly 15 days.
    await sellMembership(admin, fortnight, { planId: plan.id, startDate: addDays(addDays(today, 15), -29), discount: 0, includeRegFee: false, payAmount: 0 });
  });

  it("picks the expiry template by days left", () => {
    expect([expiryKey(15), expiryKey(10), expiryKey(8), expiryKey(7), expiryKey(5), expiryKey(3), expiryKey(1), expiryKey(0), expiryKey(-4)]).toEqual(["exp15", "exp15", "exp15", "exp7", "exp7", "exp3", "exp1", "expired", "expired"]);
  });

  it("sends a due reminder once, then skips repeats within the window", async () => {
    const desk = await gym.user("Receptionist", [gym.a.id]);
    // Demo mode (WhatsApp not linked): the reminder is logged, not sent, and the desk is told so.
    expect(await remindDue(desk, owing)).toEqual({ status: "Logged", error: null });
    expect(await remindDue(desk, owing)).toBeNull();
    expect(await remindAllOverdue(desk)).toEqual({ sent: 0, skipped: 1, failed: 0, notLinked: 0 });
  });

  it("sends the right renewal reminder and reports it as the last one", async () => {
    const desk = await gym.user("Receptionist", [gym.a.id]);
    expect(await remindRenewal(desk, ending)).toMatchObject({ status: "Logged" });
    const last = (await lastRenewalReminders([ending])).get(ending);
    const end = (await summarize([ending])).get(ending)!.latestEnd!;
    expect(last?.templateKey).toBe(expiryKey(daysBetween(end, todayIso())));
    expect((await renewalAmounts([ending])).get(ending)).toBe(140000);
  });

  it("sends the 15-day reminder to a member whose membership ends in 15 days", async () => {
    const desk = await gym.user("Receptionist", [gym.a.id]);
    expect(daysBetween((await summarize([fortnight])).get(fortnight)!.latestEnd!, todayIso())).toBe(15);
    expect(await remindRenewal(desk, fortnight)).toMatchObject({ status: "Logged" });
    const msg = await db.whatsAppMessage.findFirst({ where: { memberId: fortnight }, orderBy: { sentAt: "desc" } });
    expect(msg).toMatchObject({ templateKey: "exp15", status: "Logged" });
    expect(msg!.body).toContain("15 days from now");
    expect((await lastRenewalReminders([fortnight])).get(fortnight)?.templateKey).toBe("exp15");
  });

  it("doesn't count a reminder only logged before WhatsApp was linked as a repeat, and reports a failed send", async () => {
    const desk = await gym.user("Receptionist", [gym.a.id]);
    // The due reminder above was logged in demo mode. Now the gym links a phone, but the connector isn't reachable here.
    await db.setting.upsert({ where: { orgId_key: { orgId: desk.orgId, key: "whatsapp" } }, create: { orgId: desk.orgId, key: "whatsapp", value: { mode: "connector" } }, update: { value: { mode: "connector" } } });
    const r = await remindDue(desk, owing);
    expect(r?.status).toBe("Failed");
    expect(r?.error).toBeTruthy();
    expect(await remindAllOverdue(desk)).toMatchObject({ sent: 0, skipped: 0, failed: 1, notLinked: 0 });
  });
});

describe.skipIf(!hasDb)("send an invoice on WhatsApp (database)", () => {
  let gymA: Awaited<ReturnType<typeof makeGym>>;
  let gymB: Awaited<ReturnType<typeof makeGym>>;
  let invoiceA: string;
  let invoiceB: string;

  beforeAll(async () => {
    gymA = await makeGym();
    gymB = await makeGym();
    for (const [g, set] of [
      [gymA, (id: string) => (invoiceA = id)],
      [gymB, (id: string) => (invoiceB = id)],
    ] as const) {
      const admin = pick(await g.user("Super Admin"), g.a.id);
      const plan = await createPlan(admin, { name: "Monthly", kind: "Membership", months: 1, price: 150000, regFee: 0, discount: 0, gstApplicable: false, features: [] });
      const m = await createMember(admin, { name: "Invoice Member", gender: "Female", phone: g === gymA ? "9876522101" : "9876522102", source: "Walk-in", tags: [] });
      set((await sellMembership(admin, m.id, { planId: plan.id, startDate: todayIso(), discount: 0, includeRegFee: false, payAmount: 0 })).invoice.id);
    }
  });

  it("sends the invoice with its PDF to the invoice's own member", async () => {
    const desk = await gymA.user("Receptionist", [gymA.a.id]);
    // Not linked (demo mode): saved with the PDF attached, and the desk is told it was not sent.
    expect(await sendInvoiceWhatsApp(desk, invoiceA)).toEqual({ status: "Logged", error: null });
    const msg = await db.whatsAppMessage.findFirst({ where: { attachment: `invoice:${invoiceA}` }, orderBy: { sentAt: "desc" }, include: { member: true } });
    expect(msg).toMatchObject({ orgId: desk.orgId, templateKey: "invoice", status: "Logged" });
    expect(msg!.member!.name).toBe("Invoice Member");
  });

  it("another gym's invoice is not found, and nothing is recorded for it", async () => {
    const deskA = await gymA.user("Receptionist", [gymA.a.id]);
    await expect(sendInvoiceWhatsApp(deskA, invoiceB)).rejects.toThrow("Invoice not found.");
    expect(await db.whatsAppMessage.count({ where: { attachment: `invoice:${invoiceB}` } })).toBe(0);
  });

  it("a second press moments after a real send is not sent again", async () => {
    const desk = await gymA.user("Receptionist", [gymA.a.id]);
    // As if the first press had gone out through a linked phone.
    await db.whatsAppMessage.updateMany({ where: { attachment: `invoice:${invoiceA}` }, data: { status: "Sent" } });
    expect(await sendInvoiceWhatsApp(desk, invoiceA)).toBeNull();
    expect(await db.whatsAppMessage.count({ where: { attachment: `invoice:${invoiceA}` } })).toBe(1);
  });

  it("a cancelled invoice is not sent", async () => {
    const admin = pick(await gymB.user("Super Admin"), gymB.a.id);
    await cancelInvoice(admin, invoiceB, "Entered by mistake");
    await expect(sendInvoiceWhatsApp(admin, invoiceB)).rejects.toThrow("cancelled");
  });
});
