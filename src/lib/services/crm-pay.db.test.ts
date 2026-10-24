import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { hasDb } from "@/test/db";
import { addDays } from "@/lib/domain/dates";
import { loadCrmUser, nextEmpId, teamOrg, teamRoleId, type CrmUser } from "./crm-access";
import { approveDeal, changeStage, createLead } from "./crm-leads";
import { earningsView } from "./crm-earnings";
import { updateEmployee } from "./crm-people";
import { readCrmPhoto, removeCrmPhoto, saveProfile, setCrmPhoto } from "./crm-profile";
import { sealSecret } from "./two-step";
import { todayIso, fromIso } from "./time";

const phone = () => `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
const base = (over: Record<string, unknown> = {}) => ({ contactName: "Asha", gymName: `Gym ${randomUUID().slice(0, 6)}`, phone: phone(), plan: "starter", ...over });
const won = (over: Record<string, unknown> = {}) => ({ to: "Closed Won" as const, proofType: "Payment reference", proofRef: "UTR 123456", plan: "professional", billing: "YEARLY", closedDate: todayIso(), ...over });
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 0x90, 0x77, 0x53, 0xde]);

async function staff(role: "admin" | "marketing" | "manager" | "sales", o: { managerId?: string; joinedDaysAgo?: number; account?: boolean } = {}): Promise<CrmUser> {
  const [orgId, roleId] = await Promise.all([teamOrg(), teamRoleId()]);
  const user = await db.user.create({ data: { orgId, roleId, name: `${role} ${randomUUID().slice(0, 4)}`, email: `${randomUUID()}@test.local`, phone: "", passwordHash: "x", emailVerifiedAt: new Date() } });
  await db.crmStaff.create({
    data: { userId: user.id, empId: await nextEmpId(), role, managerId: o.managerId ?? null, joinedAt: fromIso(addDays(todayIso(), -(o.joinedDaysAgo ?? 0))), salary: 20_000_00,
      profile: { fullName: user.name }, payout: o.account === false ? null : sealSecret(JSON.stringify({ method: "upi", accName: "", bankName: "", accNo: "", ifsc: "", upi: "x@okhdfc", upiName: "X" })), termsVersion: "v1.1", termsAcceptedAt: new Date() },
  });
  return (await loadCrmUser(user.id))!;
}

describe.skipIf(!hasDb)("deal values, commission and payouts (database)", () => {
  let admin: CrmUser, marketing: CrmUser, mgr: CrmUser, other: CrmUser, veteran: CrmUser, rookie: CrmUser, rival: CrmUser, nobank: CrmUser;
  beforeAll(async () => {
    admin = await staff("admin");
    marketing = await staff("marketing");
    mgr = await staff("manager");
    other = await staff("manager");
    mgr = (await loadCrmUser(mgr.id))!;
    veteran = await staff("sales", { managerId: mgr.id, joinedDaysAgo: 90 });
    rookie = await staff("sales", { managerId: mgr.id, joinedDaysAgo: 2 });
    nobank = await staff("sales", { managerId: mgr.id, joinedDaysAgo: 2, account: false });
    rival = await staff("sales", { managerId: other.id, joinedDaysAgo: 90 });
    mgr = (await loadCrmUser(mgr.id))!;
    other = (await loadCrmUser(other.id))!;
  });

  it("works a deal's value out from the plan and add-ons, whatever the browser sends", async () => {
    const l = await createLead(veteran, base({ plan: "starter", billing: "MONTHLY" }));
    expect(l).toMatchObject({ plan: "starter", billing: "MONTHLY", product: "SaaS", estValue: 99_900 });
    await expect(changeStage(veteran, l.id, won({ plan: undefined }))).rejects.toThrow(/plan/);
    await expect(changeStage(veteran, l.id, won({ billing: "weekly" }))).rejects.toThrow(/monthly or yearly/);
    await changeStage(veteran, l.id, won({ plan: "professional", billing: "YEARLY", addons: ["setup", "brand", "nonsense"], value: 1 } as never));
    expect(await db.crmLead.findUniqueOrThrow({ where: { id: l.id } })).toMatchObject({ estValue: 19_99_000 + 99_900 + 4_99_900, plan: "professional", billing: "YEARLY", addons: ["setup", "brand"], product: "SaaS", verification: "Pending", verifiedAt: null });
    const p = await createLead(veteran, base({ plan: "partner-software", billing: "MONTHLY" }));
    expect(p.product).toBe("Partnership");
  });

  it("stamps the day a deal is approved, and clears it when the deal is corrected", async () => {
    const l = await createLead(veteran, base());
    await changeStage(veteran, l.id, won());
    await approveDeal(mgr, l.id);
    const row = await db.crmLead.findUniqueOrThrow({ where: { id: l.id } });
    expect(row.verifiedAt).not.toBeNull();
    await changeStage(admin, l.id, { to: "Negotiation" });
    expect((await db.crmLead.findUniqueOrThrow({ where: { id: l.id } })).verifiedAt).toBeNull();
  });

  it("pays 20% in the first 30 days and the incentive after, and counts only approved deals", async () => {
    const a = await createLead(veteran, base());
    await changeStage(veteran, a.id, won({ plan: "starter", billing: "MONTHLY" }));
    await approveDeal(mgr, a.id);
    const b = await createLead(rookie, base());
    await changeStage(rookie, b.id, won({ plan: "starter", billing: "MONTHLY" }));
    await approveDeal(mgr, b.id);
    const c = await createLead(rookie, base());
    await changeStage(rookie, c.id, won({ plan: "starter", billing: "MONTHLY" })); // pending: earns nothing yet
    const v = (await earningsView(veteran)).totals;
    expect(v.month).toBeGreaterThanOrEqual(Math.round(99_900 * 0.05));
    const rk = await earningsView(rookie);
    expect(rk.totals.total).toBe(Math.round(99_900 * 0.2));
    expect(rk.totals.pending).toBe(Math.round(99_900 * 0.2));
    expect(rk.rows.map((r) => r.status).sort()).toEqual(["Earned", "Pending"]);
    expect(rk.rows.find((r) => r.status === "Earned")).toMatchObject({ rate: 0.2, commission: Math.round(99_900 * 0.2) });
    expect(rk.payout.amount).toBe(rk.people[0]!.month); // first month: no salary yet
    expect(rk.payout.account).toMatch(/^UPI/);
  });

  it("shows each person only the earnings they may see", async () => {
    const own = await earningsView(veteran);
    expect(own.scope).toBe("self");
    expect(own.people.map((p) => p.userId)).toEqual([veteran.id]);
    const team = await earningsView(mgr);
    expect(team.scope).toBe("team");
    expect(team.people.map((p) => p.userId)).toContain(veteran.id);
    expect(team.people.map((p) => p.userId)).not.toContain(rival.id);
    expect(team.rows.every((r) => r.closer !== undefined)).toBe(true);
    const all = await earningsView(admin);
    expect(all.people.map((p) => p.userId)).toEqual(expect.arrayContaining([veteran.id, rival.id, mgr.id]));
    expect(all.people.map((p) => p.userId)).not.toContain(marketing.id);
    await expect(earningsView(marketing)).rejects.toThrow(/role/i);
  });

  it("holds the payout of someone with no account, and adds salary only after the first month", async () => {
    const all = await earningsView(admin);
    const vet = all.people.find((p) => p.userId === veteran.id)!;
    const rk = all.people.find((p) => p.userId === rookie.id)!;
    expect(vet).toMatchObject({ onSalary: true, due: 20_000_00 + vet.month });
    expect(rk.onSalary).toBe(false);
    const x = await createLead(nobank, base());
    await changeStage(nobank, x.id, won({ plan: "starter", billing: "MONTHLY" }));
    await approveDeal(mgr, x.id);
    const held = (await earningsView(admin)).payout.held;
    expect(held).toContain(nobank.name);
  });

  it("lets only a Super Admin set salary and incentive, keeps the incentive between 0 and 5, and records it", async () => {
    await updateEmployee(admin, rookie.id, { salary: 18000, incentive: 4 });
    expect(await db.crmStaff.findUniqueOrThrow({ where: { userId: rookie.id } })).toMatchObject({ salary: 18_000_00, incentive: 4 });
    await expect(updateEmployee(admin, rookie.id, { incentive: 9 })).rejects.toThrow(/0 to 5/);
    await expect(updateEmployee(admin, rookie.id, { incentive: -1 })).rejects.toThrow(/0 to 5/);
    await expect(updateEmployee(mgr, rookie.id, { salary: 99999 })).rejects.toThrow(/role/i);
    await expect(updateEmployee(rookie, rookie.id, { salary: 99999 })).rejects.toThrow(/role/i);
    await updateEmployee(admin, rookie.id, { salary: null });
    expect((await db.crmStaff.findUniqueOrThrow({ where: { userId: rookie.id } })).salary).toBeNull();
    const log = (await db.crmAudit.findMany({ where: { actorId: admin.id, kind: "user" } })).map((a) => a.text).join("\n");
    expect(log).toContain("monthly salary changed");
  });

  it("stores a photo privately, replaces it and removes it, and refuses what is not a picture", async () => {
    const png = new File([PNG], "me.png", { type: "image/png" });
    await expect(setCrmPhoto(veteran, new File([new Uint8Array([1, 2, 3])], "x.png", { type: "image/png" }))).rejects.toThrow(/JPG, PNG or WebP/);
    await expect(setCrmPhoto(veteran, new File([], "e.png"))).rejects.toThrow(/Choose a photo/);
    await setCrmPhoto(veteran, png);
    const first = await readCrmPhoto(veteran.id);
    expect(first?.mime).toBe("image/png");
    await setCrmPhoto(veteran, png);
    expect((await readCrmPhoto(veteran.id))?.key).not.toBe(first?.key);
    await removeCrmPhoto(veteran);
    expect(await readCrmPhoto(veteran.id)).toBeNull();
    expect(await readCrmPhoto("nobody")).toBeNull();
    // A person who is not an employee has no photo to read, even if the account has one.
    const [orgId, roleId] = await Promise.all([teamOrg(), teamRoleId()]);
    const gym = await db.user.create({ data: { orgId, roleId, name: "Gym", email: `${randomUUID()}@gym.test`, phone: "", passwordHash: "x", photoKey: first!.key } });
    expect(await readCrmPhoto(gym.id)).toBeNull();
  });

  it("keeps a saved account number out of what an employee sees", async () => {
    const p = { fullName: "Test Person", phone: "9876543210", address: "12 MG Road", city: "Pune", state: "Maharashtra", pin: "411001", payMethod: "bank" as const, accName: "Test Person", bankName: "HDFC Bank", accNo: "50100234567812", accNo2: "50100234567812", ifsc: "HDFC0000523", upi: "", upiName: "", agree: true };
    await saveProfile(rookie, p);
    const e = await earningsView(admin);
    expect(JSON.stringify(e)).not.toContain("50100234567812");
    expect(e.people.find((x) => x.userId === rookie.id)?.account).toBe("HDFC Bank ••••7812");
  });
});
