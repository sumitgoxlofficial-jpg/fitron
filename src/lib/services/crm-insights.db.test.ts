import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { hasDb } from "@/test/db";
import { loadCrmUser, nextEmpId, teamOrg, teamRoleId, type CrmUser } from "./crm-access";
import { approveDeal, bulkUpdate, changeStage, createLead } from "./crm-leads";
import { activityFeed, addContact, companies, deleteView, getLayout, leaderboard, listContacts, listViews, paletteSearch, reportCsv, reportView, saveLayout, saveView, trendOf } from "./crm-insights";
import { todayIso } from "./time";

const phone = () => `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
const base = (over: Record<string, unknown> = {}) => ({ contactName: "Asha", gymName: `Gym ${randomUUID().slice(0, 6)}`, phone: phone(), plan: "starter", city: "Pune", ...over });
const won = { to: "Closed Won" as const, proofType: "Payment reference", proofRef: "UTR 123456", plan: "professional", billing: "YEARLY", closedDate: todayIso() };
async function staff(role: "admin" | "marketing" | "manager" | "sales", managerId?: string): Promise<CrmUser> {
  const [orgId, roleId] = await Promise.all([teamOrg(), teamRoleId()]);
  const user = await db.user.create({ data: { orgId, roleId, name: `${role} ${randomUUID().slice(0, 4)}`, email: `${randomUUID()}@test.local`, phone: "", passwordHash: "x", emailVerifiedAt: new Date() } });
  await db.crmStaff.create({ data: { userId: user.id, empId: await nextEmpId(), role, managerId: managerId ?? null } });
  return (await loadCrmUser(user.id))!;
}

describe.skipIf(!hasDb)("reports, leaderboard, activity, companies and more (database)", () => {
  let admin: CrmUser, marketing: CrmUser, mgr: CrmUser, rahul: CrmUser, sneha: CrmUser, arjun: CrmUser, mgrE: CrmUser;
  beforeAll(async () => {
    admin = await staff("admin");
    marketing = await staff("marketing");
    mgr = await staff("manager");
    mgrE = await staff("manager");
    rahul = await staff("sales", mgr.id);
    sneha = await staff("sales", mgr.id);
    arjun = await staff("sales", mgrE.id);
    mgr = (await loadCrmUser(mgr.id))!;
    mgrE = (await loadCrmUser(mgrE.id))!;
  });

  it("limits reports to the role's own leads, and refuses a salesperson", async () => {
    const mine = await createLead(rahul, base({ source: "Referral" }));
    const theirs = await createLead(arjun, base());
    const team = await reportView(mgr, {});
    const all = await reportView(admin, {});
    expect(team.kpi.total).toBeLessThan(all.kpi.total);
    expect((await reportView(marketing, {})).kpi.total).toBe(all.kpi.total);
    await expect(reportView(rahul, {})).rejects.toThrow(/role/i);
    expect(mine.id).not.toBe(theirs.id);
    expect(team.funnel.map((x) => x.label)).toEqual(["Leads", "Contacted", "Demo done", "Won (verified)"]);
    expect(all.trend.labels).toHaveLength(12);
  });

  it("exports the report only for a role that may export, and records it", async () => {
    expect(await reportCsv(admin, {})).toContain("Source,Leads");
    await expect(reportCsv(rahul, {})).rejects.toThrow(/can't export/);
    const blocked = await db.crmAudit.findMany({ where: { actorId: rahul.id, kind: "export" } });
    expect(blocked.some((a) => /blocked/.test(a.text))).toBe(true);
  });

  it("counts a verified deal in the trend by the week it was approved", async () => {
    const l = await createLead(rahul, base());
    await changeStage(rahul, l.id, won);
    const before = (await trendOf(admin, {})).sumRevenue;
    await approveDeal(mgr, l.id);
    const t = await trendOf(admin, {});
    expect(t.sumRevenue).toBe(before + 19_99_000);
    expect(t.revenue.at(-1)).toBeGreaterThanOrEqual(19_99_000);
  });

  it("ranks salespeople by verified revenue, this month or all time", async () => {
    const l = await createLead(sneha, base());
    await changeStage(sneha, l.id, won);
    await approveDeal(mgr, l.id);
    const rows = await leaderboard(admin, "month");
    const me = rows.find((r) => r.userId === sneha.id)!;
    expect(me.revenue).toBeGreaterThanOrEqual(19_99_000);
    expect(rows.map((r) => r.rank)).toEqual(rows.map((_, i) => i + 1));
    expect([...rows].sort((a, b) => b.revenue - a.revenue).map((r) => r.userId)).toEqual(rows.map((r) => r.userId));
    expect(rows.every((r) => r.userId !== mgr.id && r.userId !== marketing.id)).toBe(true);
    expect((await leaderboard(rahul, "all")).length).toBe((await leaderboard(admin, "all")).length);
  });

  it("shows a salesperson only their own actions, and others only what is on leads they may open", async () => {
    const mine = await createLead(rahul, base());
    const theirs = await createLead(arjun, base());
    const own = await activityFeed(rahul, {});
    const ids = own.days.flatMap((d) => d.items);
    expect(ids.every((i) => i.actorId === rahul.id)).toBe(true);
    expect(ids.some((i) => i.leadId === mine.id)).toBe(true);
    const team = (await activityFeed(mgr, {})).days.flatMap((d) => d.items);
    expect(team.some((i) => i.leadId === mine.id)).toBe(true);
    expect(team.some((i) => i.leadId === theirs.id)).toBe(false);
    expect((await activityFeed(admin, {})).days.flatMap((d) => d.items).some((i) => i.leadId === theirs.id)).toBe(true);
    expect((await activityFeed(admin, { kind: "create" })).days.flatMap((d) => d.items).every((i) => i.kind === "create")).toBe(true);
    // A refusal is for the Super Admin's audit log, not anyone's feed.
    expect((await activityFeed(admin, {})).days.flatMap((d) => d.items).every((i) => i.kind !== "denied")).toBe(true);
    expect((await activityFeed(rahul, {})).people).toEqual([]);
  });

  it("groups leads at the same gym into one company, with the contacts and values", async () => {
    const name = `Iron Works ${randomUUID().slice(0, 5)}`;
    const a = await createLead(rahul, base({ gymName: name }));
    await createLead(rahul, base({ gymName: name.toUpperCase(), contactName: "Second" }));
    await addContact(rahul, a.id, { name: "Owner Two", title: "Owner", phone: "98765 43210" });
    const c = (await companies(rahul, name)).filter((x) => x.name.toLowerCase() === name.toLowerCase());
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ contacts: 3, status: "Prospect", where: "Pune" });
    expect(c[0]!.openValue).toBe(2 * 99_900);
    expect((await companies(arjun, name)).length).toBe(0); // not in their scope
  });

  it("adds contacts only to a lead the person may open, and masks their numbers for a role that can't see them", async () => {
    const l = await createLead(rahul, base());
    await expect(addContact(arjun, l.id, { name: "Intruder" })).rejects.toThrow(/access/i);
    await expect(addContact(marketing, l.id, { name: "Marketer" })).rejects.toThrow(/role/i);
    await expect(addContact(rahul, l.id, { name: "A" })).rejects.toThrow(/name/i);
    await expect(addContact(rahul, l.id, { name: "Valid Name", phone: "123" })).rejects.toThrow(/10-digit/);
    const raw = phone();
    await addContact(rahul, l.id, { name: "Second Person", phone: raw, email: "second@gym.example" });
    const seen = await listContacts(marketing, l.id);
    expect(seen).toHaveLength(2);
    expect(JSON.stringify(seen)).not.toContain(raw);
    expect(JSON.stringify(seen)).not.toContain("second@gym");
    expect(JSON.stringify(await listContacts(rahul, l.id))).toContain(raw.slice(0, 5));
    expect(await listContacts(arjun, l.id)).toEqual([]);
  });

  it("keeps saved views private and limited, and cleans their filters", async () => {
    await saveView(rahul, "Hot leads", { stage: "Interested", q: "pune", bogus: "x" } as never);
    const mine = await listViews(rahul);
    expect(mine.at(-1)).toMatchObject({ name: "Hot leads", filters: { stage: "Interested", q: "pune" } });
    expect(await listViews(sneha)).toEqual([]);
    await expect(saveView(rahul, "x", {})).rejects.toThrow(/Name the view/);
    await deleteView(sneha, mine[0]!.id); // someone else's: nothing happens
    expect((await listViews(rahul)).length).toBe(mine.length);
    await deleteView(rahul, mine[0]!.id);
    expect((await listViews(rahul)).length).toBe(mine.length - 1);
  });

  it("saves a dashboard layout per person, cleaned to the widgets their role has", async () => {
    await saveLayout(rahul, { order: ["activity", "people", "kpis"], hidden: ["trend", "people", "kpis"], mode: "focus" });
    const l = await getLayout(rahul);
    expect(l.order).toEqual(["activity", "kpis", "target", "tasks", "trend"]);
    expect(l.hidden).toEqual(["trend"]);
    expect(l.mode).toBe("focus");
    expect((await getLayout(sneha)).mode).toBe("tiles");
  });

  it("searches for pages and leads the person may open, and finds a number only for a role that sees numbers", async () => {
    const raw = phone();
    const l = await createLead(rahul, base({ phone: raw, gymName: "Zebra Fitness Club" }));
    const theirs = await createLead(arjun, base({ gymName: "Zebra Hidden Gym" }));
    const pages = [{ label: "Leads", sub: "Sales", href: "/crm/leads" }];
    const hit = await paletteSearch(rahul, "Zebra", pages);
    expect(hit.map((h) => h.href)).toContain(`/crm/leads/${l.id}`);
    expect(hit.map((h) => h.href)).not.toContain(`/crm/leads/${theirs.id}`);
    expect((await paletteSearch(rahul, raw.slice(2, 8), pages)).some((h) => h.href.endsWith(l.id))).toBe(true);
    expect((await paletteSearch(marketing, raw.slice(2, 8), pages)).some((h) => h.href.endsWith(l.id))).toBe(false);
    expect((await paletteSearch(marketing, "Zebra", pages)).length).toBeGreaterThanOrEqual(2);
    expect((await paletteSearch(rahul, "", pages)).map((h) => h.kind)).toEqual(["page"]);
  });

  it("changes many leads at once, each through the usual checks, and reports the ones it could not", async () => {
    const a = await createLead(rahul, base());
    const b = await createLead(rahul, base());
    const c = await createLead(arjun, base());
    await expect(bulkUpdate(rahul, [a.id], { kind: "owner", ownerId: sneha.id })).rejects.toThrow(/role/i);
    await expect(bulkUpdate(rahul, [], { kind: "priority", value: "High" })).rejects.toThrow(/Select/);
    await expect(bulkUpdate(rahul, [a.id], { kind: "stage", to: "Closed Won" })).rejects.toThrow(/open the lead/);
    const p = await bulkUpdate(rahul, [a.id, b.id, c.id], { kind: "priority", value: "High" });
    expect(p.done).toBe(2);
    expect(p.failed.map((f) => f.id)).toEqual([c.id]); // not theirs
    expect((await db.crmLead.findUniqueOrThrow({ where: { id: a.id } })).priority).toBe("High");
    expect((await db.crmLead.findUniqueOrThrow({ where: { id: c.id } })).priority).not.toBe("High");
    const m = await bulkUpdate(mgr, [a.id, b.id], { kind: "owner", ownerId: sneha.id });
    expect(m.done).toBe(2);
    const x = await bulkUpdate(mgr, [a.id], { kind: "owner", ownerId: arjun.id }); // not on their team
    expect(x).toMatchObject({ done: 0, failed: [{ id: a.id }] });
    const s = await bulkUpdate(sneha, [a.id, b.id], { kind: "stage", to: "Contacted" });
    expect(s.done).toBe(2);
    expect(mgrE.id).not.toBe(mgr.id);
  });
});
