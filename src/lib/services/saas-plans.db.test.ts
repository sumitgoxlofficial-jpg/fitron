import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { hasDb, makeGym, pick } from "@/test/db";

const sent: { to: string; subject: string; text: string }[] = [];
vi.mock("@/lib/integrations/email", () => ({
  emailReady: () => true,
  sendEmail: async (m: { to: string; subject: string; text: string }) => {
    sent.push(m);
    return { sent: true };
  },
}));

const { createMember } = await import("./members");
const { saveBranch } = await import("./settings");
const { billingHistory, gymPlan, paymentsToCheck, reviewPayment, startPayment, submitUtr } = await import("./saas");

const DAY = 86_400_000;
const utr = () => String(Math.floor(1e11 + Math.random() * 9e11));
let phone = 9_700_000_000;
const member = (name: string) => ({ name, gender: "Female" as const, phone: String(phone++), source: "Walk-in" as const, tags: [] });

describe.skipIf(!hasDb)("FITRON plans paid by UPI + UTR (database)", () => {
  beforeAll(() => {
    vi.stubEnv("FITRON_UPI_ID", "fitron@okaxis");
    vi.stubEnv("FITRON_UPI_NAME", "FITRON");
    vi.stubEnv("FITRON_ADMIN_EMAILS", "Team@Fitron.in");
  });
  afterAll(() => vi.unstubAllEnvs());

  it("runs a trial, locks when it ends, and reopens once the FITRON team confirms the UTR", async () => {
    const gym = await makeGym();
    await db.organization.update({ where: { id: gym.org.id }, data: { plan: "enterprise", trialEndsAt: new Date(Date.now() + 7 * DAY) } });
    const owner = await gym.user("Super Admin");
    const inA = pick(owner, gym.a.id);
    expect((await gymPlan(gym.org.id)).standing.kind).toBe("TRIAL");
    await createMember(inA, member("Trial Tara"));

    await db.organization.update({ where: { id: gym.org.id }, data: { trialEndsAt: new Date(Date.now() - 2 * DAY) } });
    expect((await gymPlan(gym.org.id)).standing.kind).toBe("LAPSED");
    await expect(createMember(inA, member("Locked Lata"))).rejects.toThrow(/plan has ended/);

    await expect(startPayment(owner, { kind: "PLAN", plan: "professional" }, "MONTHLY")).rejects.toThrow(/2 branches/);
    await expect(startPayment(owner, { kind: "PLAN", plan: "ai-pro" }, "MONTHLY")).rejects.toThrow(/Gym Accounting or Gym Partnership plan/);
    const c = await startPayment(owner, { kind: "PLAN", plan: "enterprise" }, "MONTHLY");
    if (c.mode !== "UPI") throw new Error("expected UPI");
    expect(c.total).toBe(3_99_900); // the listed Enterprise price, GST inside
    expect(c.link).toMatch(/^upi:\/\/pay\?pa=fitron@okaxis&pn=FITRON&am=3999\.00&cu=INR&tn=FIT-/);
    expect(c.qr).toMatch(/^<svg/);

    await expect(submitUtr(owner, c.id, "12345")).rejects.toThrow(/12-digit/);
    const number = utr();
    sent.length = 0;
    await submitUtr(owner, c.id, `${number.slice(0, 4)} ${number.slice(4)}`);
    expect(sent.map((m) => m.to)).toEqual(["team@fitron.in"]);
    expect(sent[0]!.text).toContain(number);
    await expect(submitUtr(owner, c.id, number)).rejects.toThrow(/already has a UTR/);

    // While the team checks, the gym keeps working.
    expect((await gymPlan(gym.org.id)).checking).toBe(true);
    await createMember(inA, member("Waiting Wasim"));
    expect((await paymentsToCheck()).waiting.map((p) => p.id)).toContain(c.id);

    // The same UTR can't pay twice.
    const again = await startPayment(owner, { kind: "PLAN", plan: "enterprise" }, "MONTHLY");
    await expect(submitUtr(owner, again.id, number)).rejects.toThrow(/already entered/);

    await expect(reviewPayment({ email: "team@fitron.in" }, c.id, "REJECT", " ")).rejects.toThrow(/why/);
    sent.length = 0;
    const paid = await reviewPayment({ email: "team@fitron.in" }, c.id, "CONFIRM");
    expect(paid).toMatchObject({ status: "PAID", reviewedBy: "team@fitron.in", utr: number });
    expect(paid?.invoiceNo).toMatch(/^FIT\//);
    expect(sent.map((m) => m.subject)).toEqual(["Your FITRON payment is confirmed"]);
    const plan = await gymPlan(gym.org.id);
    expect(plan).toMatchObject({ key: "enterprise", cycle: "MONTHLY", checking: false });
    expect(plan.standing.kind).toBe("PAID");
    await createMember(inA, member("Paid Pooja"));
    await expect(reviewPayment({ email: "team@fitron.in" }, c.id, "CONFIRM")).rejects.toThrow(/isn't waiting/);
  });

  it("tells the gym when a UTR doesn't match", async () => {
    const gym = await makeGym();
    await db.organization.update({ where: { id: gym.org.id }, data: { plan: "enterprise", trialEndsAt: new Date(Date.now() + 3 * DAY) } });
    const owner = await gym.user("Super Admin");
    const c = await startPayment(owner, { kind: "BRANCH", branchId: null }, "YEARLY");
    await submitUtr(owner, c.id, utr());
    sent.length = 0;
    await reviewPayment({ email: "team@fitron.in" }, c.id, "REJECT", "No payment with this UTR");
    expect(sent[0]).toMatchObject({ to: owner.email, subject: "We couldn't confirm your FITRON payment" });
    const h = await billingHistory(owner);
    expect(h.find((x) => x.id === c.id)).toMatchObject({ status: "REJECTED", rejectReason: "No payment with this UTR", invoiceNo: null });
    // The decision is in the gym's audit log, with the reviewer and the reason, and no gym user as the actor.
    const row = await db.auditLog.findFirstOrThrow({ where: { orgId: gym.org.id, action: "billing.utr-rejected", entityId: c.id } });
    expect(row).toMatchObject({ actorType: "SYSTEM", userId: null, entity: "BranchSubscription" });
    expect(row.after).toMatchObject({ status: "REJECTED", reviewedBy: "team@fitron.in", rejectReason: "No payment with this UTR" });
    expect(row.hash).toBeTruthy();
  });

  it("caps Starter at 100 active members and one branch", async () => {
    const gym = await makeGym();
    await db.branch.delete({ where: { id: gym.b.id } });
    await db.organization.update({ where: { id: gym.org.id }, data: { plan: "starter", trialEndsAt: new Date(Date.now() + 7 * DAY) } });
    const owner = await gym.user("Super Admin", [gym.a.id]);
    await db.member.createMany({
      data: Array.from({ length: 100 }, (_, i) => ({ orgId: gym.org.id, branchId: gym.a.id, code: `S-${i}`, name: `M${i}`, gender: "Male", phone: String(phone++), source: "Walk-in", createdById: owner.id })),
    });
    await expect(createMember(owner, member("Over Omar"))).rejects.toThrow(/allows 100 active members/);
    // A suspended member frees a place.
    await db.member.updateMany({ where: { orgId: gym.org.id, code: "S-0" }, data: { suspended: true } });
    await createMember(owner, member("Room Rhea"));

    await expect(saveBranch(owner, null, { name: "Second", address: "", phone: "" })).rejects.toThrow(/for one branch/);
    await expect(startPayment(owner, { kind: "BRANCH", branchId: null }, "MONTHLY")).rejects.toThrow(/for one branch/);
  });
});
