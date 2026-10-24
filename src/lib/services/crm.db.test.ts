import { randomInt, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { hasDb } from "@/test/db";
import { loadCrmUser, nextEmpId, teamOrg, teamRoleId, type CrmUser } from "./crm-access";
import { addNote, addTask, approveDeal, assignLead, changeStage, completeTask, createLead, getLead, leadDetail, listLeads, listTasks, logCall, rejectDeal, updateLead, verificationQueue } from "./crm-leads";
import { commitImport, exportLeads, previewImport } from "./crm-io";
import { dashboard } from "./crm-reports";
import { inviteEmployee, listAudit, listEmployees, updateEmployee } from "./crm-people";
import { crmUserFor } from "./crm-people";
import { todayIso } from "./time";

const phone = () => `9${String(randomInt(0, 1e9)).padStart(9, "0")}`;
const base = (over: Record<string, unknown> = {}) => ({ contactName: "Asha", gymName: `Gym ${randomUUID().slice(0, 6)}`, phone: phone(), product: "SaaS", ...over });
const won = { to: "Closed Won" as const, proofType: "Payment reference", proofRef: "UTR 123456", plan: "professional", billing: "YEARLY", closedDate: todayIso() };
const WON_VALUE = 19_99_000; // Accounting Professional, yearly: ₹19,990

async function staff(role: "admin" | "marketing" | "manager" | "sales", managerId?: string): Promise<CrmUser> {
  const [orgId, roleId] = await Promise.all([teamOrg(), teamRoleId()]);
  const user = await db.user.create({ data: { orgId, roleId, name: `${role} ${randomUUID().slice(0, 4)}`, email: `${randomUUID()}@test.local`, phone: "", passwordHash: "x", emailVerifiedAt: new Date() } });
  await db.crmStaff.create({ data: { userId: user.id, empId: await nextEmpId(), role, managerId: managerId ?? null } });
  return (await loadCrmUser(user.id))!;
}
const reload = async (u: CrmUser) => (await loadCrmUser(u.id))!;

describe.skipIf(!hasDb)("sales CRM (database)", () => {
  let admin: CrmUser, marketing: CrmUser, mgrW: CrmUser, mgrE: CrmUser, rahul: CrmUser, sneha: CrmUser, arjun: CrmUser;

  beforeAll(async () => {
    admin = await staff("admin");
    marketing = await staff("marketing");
    mgrW = await staff("manager");
    mgrE = await staff("manager");
    rahul = await staff("sales", mgrW.id);
    sneha = await staff("sales", mgrW.id);
    arjun = await staff("sales", mgrE.id);
    mgrW = await reload(mgrW);
    mgrE = await reload(mgrE);
  });

  describe("who sees which lead", () => {
    it("scopes every list and every single lead to the role", async () => {
      const mine = await createLead(rahul, base());
      const theirs = await createLead(arjun, base());
      const loose = await createLead(marketing, base());
      const ids = async (u: CrmUser) => (await listLeads(u, { pageSize: 500 })).leads.map((l) => l.id);
      expect(await ids(rahul)).toContain(mine.id);
      expect(await ids(rahul)).not.toContain(theirs.id);
      expect(await ids(rahul)).not.toContain(loose.id);
      const w = await ids(mgrW);
      expect(w).toContain(mine.id);
      expect(w).toContain(loose.id); // unassigned
      expect(w).not.toContain(theirs.id);
      const all = await ids(marketing);
      expect([mine.id, theirs.id, loose.id].every((i) => all.includes(i))).toBe(true);
      expect(await getLead(rahul, theirs.id)).toBeNull();
      expect(await getLead(admin, theirs.id)).not.toBeNull();
    });

    it("refuses and records a lead outside the scope, and a filter can't widen it", async () => {
      const theirs = await createLead(arjun, base());
      expect(await leadDetail(rahul, theirs.id)).toBe("denied");
      expect(await leadDetail(rahul, "FL-0")).toBeNull();
      const { rows } = await listAudit(admin, { kind: "denied" });
      expect(rows.some((r) => r.leadId === theirs.id)).toBe(true);
      expect((await listLeads(rahul, { ownerId: arjun.id, pageSize: 500 })).total).toBe(0);
      await expect(changeStage(rahul, theirs.id, { to: "Contacted" })).rejects.toThrow(/access/i);
      await expect(logCall(rahul, theirs.id, { outcome: "Connected" })).rejects.toThrow(/access/i);
      await expect(assignLead(mgrW, theirs.id, rahul.id)).rejects.toThrow(/access/i);
    });

    it("masks phone numbers and emails for a role that may not see them, in lists, details and searches", async () => {
      const raw = phone();
      const l = await createLead(rahul, base({ phone: raw, email: "owner@gym.example" }));
      const seen = (await listLeads(marketing, { q: l.id })).leads[0]!;
      expect(seen.phone).not.toContain(raw.slice(2, 7));
      expect(seen.email).not.toContain("owner@");
      expect((await listLeads(rahul, { q: l.id })).leads[0]!.phone.replace(/\s/g, "")).toContain(raw);
      // Searching by number finds nothing for marketing, so a masked number can't be recovered by guessing.
      expect((await listLeads(marketing, { q: raw })).total).toBe(0);
      expect((await listLeads(rahul, { q: raw })).total).toBe(1);
      const d = await leadDetail(marketing, l.id);
      expect(d).not.toBe("denied");
      if (d && d !== "denied") expect(JSON.stringify(d)).not.toContain(raw);
      await expect(updateLead(marketing, l.id, { phone: phone() })).rejects.toThrow(/role/i);
    });
  });

  describe("creating and duplicates", () => {
    it("treats the same number written differently as a duplicate, even from two people at once", async () => {
      const p = phone();
      await createLead(rahul, base({ phone: `+91 ${p.slice(0, 5)} ${p.slice(5)}` }));
      await expect(createLead(sneha, base({ phone: `0${p}` }))).rejects.toThrow(/already exists/);
      const q = phone();
      const results = await Promise.allSettled([createLead(rahul, base({ phone: q })), createLead(sneha, base({ phone: q }))]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await db.crmLead.count({ where: { phone: q } })).toBe(1);
    });

    it("rejects a bad number and keeps the source, the creator and the owner as they were made", async () => {
      await expect(createLead(rahul, base({ phone: "12345" }))).rejects.toThrow(/10-digit/);
      const c = await db.crmCampaign.create({ data: { name: "Diwali", source: "Meta Ads" } });
      const l = await createLead(marketing, base({ campaignId: c.id }));
      expect(l).toMatchObject({ source: "Meta Ads", createdById: marketing.id, ownerId: null });
      await db.crmCampaign.update({ where: { id: c.id }, data: { source: "Google Ads" } });
      expect((await db.crmLead.findUniqueOrThrow({ where: { id: l.id } })).source).toBe("Meta Ads");
      await assignLead(marketing, l.id, rahul.id);
      expect(await db.crmLead.findUniqueOrThrow({ where: { id: l.id } })).toMatchObject({ source: "Meta Ads", createdById: marketing.id, ownerId: rahul.id });
    });
  });

  describe("assigning", () => {
    it("moves open tasks, notifies both people, and keeps a manager to their own team", async () => {
      const l = await createLead(rahul, base());
      await addTask(rahul, l.id, { type: "Call", dueAt: new Date(Date.now() + 3_600_000) });
      await assignLead(mgrW, l.id, sneha.id);
      expect((await db.crmTask.findMany({ where: { leadId: l.id } })).every((t) => t.ownerId === sneha.id)).toBe(true);
      expect(await db.crmNotification.count({ where: { userId: sneha.id, leadId: l.id } })).toBe(1);
      expect(await db.crmNotification.count({ where: { userId: rahul.id, leadId: l.id } })).toBe(1);
      expect(await db.crmAssignment.count({ where: { leadId: l.id } })).toBe(2);
      await expect(assignLead(mgrW, l.id, arjun.id)).rejects.toThrow(/own team/);
      await expect(assignLead(sneha, l.id, rahul.id)).rejects.toThrow(/role/i);
      await assignLead(marketing, l.id, arjun.id);
      expect((await db.crmLead.findUniqueOrThrow({ where: { id: l.id } })).ownerId).toBe(arjun.id);
    });
  });

  describe("calls and follow-ups", () => {
    it("moves a New Lead to Contacted on a connected call, and turns a future follow-up into a task", async () => {
      const l = await createLead(rahul, base());
      await expect(logCall(rahul, l.id, { outcome: "Connected", followUpAt: new Date(Date.now() - 1000) })).rejects.toThrow(/future/);
      await expect(logCall(marketing, l.id, { outcome: "Connected" })).rejects.toThrow(/role/i);
      await logCall(rahul, l.id, { outcome: "No answer" });
      expect((await db.crmLead.findUniqueOrThrow({ where: { id: l.id } })).stage).toBe("New Lead");
      await logCall(rahul, l.id, { outcome: "Connected", notes: "Wants a demo", followUpAt: new Date(Date.now() + 86_400_000) });
      const row = await db.crmLead.findUniqueOrThrow({ where: { id: l.id } });
      expect(row.stage).toBe("Contacted");
      expect(row.lastContactAt).not.toBeNull();
      const t = await listTasks(rahul, "mine");
      expect(t.some((x) => x.leadId === l.id)).toBe(true);
      await addNote(rahul, l.id, "Sent the brochure");
    });

    it("only lets people finish tasks that are theirs", async () => {
      const l = await createLead(rahul, base());
      await addTask(rahul, l.id, { type: "Call", dueAt: new Date(Date.now() + 3_600_000) });
      const task = await db.crmTask.findFirstOrThrow({ where: { leadId: l.id } });
      await expect(completeTask(arjun, task.id)).rejects.toThrow(/access/i);
      await completeTask(rahul, task.id);
      expect((await db.crmTask.findUniqueOrThrow({ where: { id: task.id } })).done).toBe(true);
    });
  });

  describe("closing a deal", () => {
    it("needs a reason to lose, and the proof to win; a pending deal is not revenue", async () => {
      const l = await createLead(rahul, base());
      await expect(changeStage(rahul, l.id, { to: "Closed Lost" })).rejects.toThrow(/reason/i);
      await expect(changeStage(rahul, l.id, { ...won, proofRef: "x" })).rejects.toThrow(/at least 4/);
      await changeStage(rahul, l.id, won);
      const row = await db.crmLead.findUniqueOrThrow({ where: { id: l.id } });
      expect(row).toMatchObject({ stage: "Closed Won", verification: "Pending", closedById: rahul.id, estValue: WON_VALUE });
      // The manager and the Super Admin are told; revenue is still zero for this cohort.
      expect(await db.crmNotification.count({ where: { userId: mgrW.id, leadId: l.id } })).toBe(1);
      expect(await db.crmNotification.count({ where: { userId: admin.id, leadId: l.id } })).toBe(1);
      const d = await dashboard(rahul, {});
      expect(d.kpi.pendingValue).toBeGreaterThanOrEqual(WON_VALUE);
      const before = (await dashboard(admin, {})).kpi.verifiedRevenue;
      await approveDeal(mgrW, l.id);
      expect((await dashboard(admin, {})).kpi.verifiedRevenue).toBe(before + WON_VALUE);
    });

    it("lets a manager approve only their own team's deals, never their own, and a salesperson nothing", async () => {
      const l = await createLead(rahul, base());
      await changeStage(rahul, l.id, won);
      await expect(approveDeal(rahul, l.id)).rejects.toThrow(/role/i);
      await expect(approveDeal(marketing, l.id)).rejects.toThrow(/role/i);
      await expect(approveDeal(mgrE, l.id)).rejects.toThrow(/access|team/i);
      expect((await verificationQueue(mgrE)).pending.some((p) => p.id === l.id)).toBe(false);
      expect((await verificationQueue(mgrW)).pending.some((p) => p.id === l.id)).toBe(true);
      // A manager's own deal goes to the Super Admin.
      const own = await createLead(mgrW, base());
      await changeStage(mgrW, own.id, won);
      await expect(approveDeal(mgrW, own.id)).rejects.toThrow(/closed yourself/);
      await approveDeal(admin, own.id);
      expect((await db.crmLead.findUniqueOrThrow({ where: { id: own.id } })).verification).toBe("Verified");
    });

    it("sends a rejected deal back to negotiation with the reason, and a withdrawn one back to nothing", async () => {
      const l = await createLead(rahul, base());
      await changeStage(rahul, l.id, won);
      await expect(rejectDeal(mgrW, l.id, "no")).rejects.toThrow(/at least 5/);
      await rejectDeal(mgrW, l.id, "Reference doesn't match");
      expect(await db.crmLead.findUniqueOrThrow({ where: { id: l.id } })).toMatchObject({ stage: "Negotiation", verification: "Rejected", rejectReason: "Reference doesn't match" });
      expect(await db.crmNotification.count({ where: { userId: rahul.id, leadId: l.id, text: { contains: "rejected" } } })).toBe(1);
      await changeStage(rahul, l.id, won);
      await changeStage(rahul, l.id, { to: "Interested" });
      expect(await db.crmLead.findUniqueOrThrow({ where: { id: l.id } })).toMatchObject({ stage: "Interested", verification: null, closedById: null });
      const { rows } = await listAudit(admin, {});
      expect(rows.some((r) => r.leadId === l.id && /withdrawn/.test(r.text))).toBe(true);
    });

    it("locks a verified deal for everyone but the Super Admin, whose change is logged as a correction", async () => {
      const l = await createLead(rahul, base());
      await changeStage(rahul, l.id, won);
      await approveDeal(mgrW, l.id);
      await expect(changeStage(rahul, l.id, { to: "Negotiation" })).rejects.toThrow(/locked/);
      await expect(changeStage(mgrW, l.id, { to: "Negotiation" })).rejects.toThrow(/locked/);
      await expect(assignLead(mgrW, l.id, sneha.id)).rejects.toThrow(/locked/);
      await expect(updateLead(rahul, l.id, { priority: "High" })).rejects.toThrow(/locked/);
      await changeStage(admin, l.id, { to: "Negotiation" });
      const { rows } = await listAudit(admin, { kind: "stage" });
      expect(rows.some((r) => r.leadId === l.id && /Correction by Super Admin/.test(r.text))).toBe(true);
    });
  });

  describe("two people editing", () => {
    it("refuses a change made on a stale copy", async () => {
      const l = await createLead(rahul, base());
      const v = l.version;
      await updateLead(rahul, l.id, { priority: "High" }, v);
      await expect(updateLead(rahul, l.id, { priority: "Low" }, v)).rejects.toThrow(/Someone else/);
    });
  });

  describe("import and export", () => {
    it("imports the valid rows only, in one go, unassigned, and reports the rest", async () => {
      const a = phone(), b = phone(), dup = phone();
      await createLead(rahul, base({ phone: dup }));
      const csv = ["Name,Gym,Mobile,City,Interest", `A,Gym A,${a},Pune,Gym Accounting`, `B,Gym B,${b},Pune,Partnership`, `C,Gym C,${dup},Pune,SaaS`, `D,Gym D,123,Pune,SaaS`, `,Gym E,${phone()},Pune,SaaS`, `F,Gym F,${a},Pune,SaaS`].join("\n");
      const map = { contactName: 0, gymName: 1, phone: 2, city: 3, product: 4 };
      const pre = await previewImport(admin, csv, map);
      expect([pre.valid, pre.duplicates, pre.errors]).toEqual([2, 2, 2]);
      const out = await commitImport(marketing, csv, map);
      expect(out.inserted).toBe(2);
      expect(await db.crmLead.count({ where: { phone: { in: [a, b] }, ownerId: null } })).toBe(2);
      expect((await commitImport(marketing, csv, map)).inserted).toBe(0); // everything is a duplicate now
      await expect(commitImport(rahul, csv, map)).rejects.toThrow(/role/i);
      await expect(previewImport(mgrW, csv, map)).rejects.toThrow(/role/i);
    });

    it("exports the filtered list with masked phones for marketing, refuses and records a salesperson's attempt", async () => {
      const raw = phone();
      const l = await createLead(rahul, base({ phone: raw, gymName: '=HYPERLINK("http://evil")' }));
      const m = await exportLeads(marketing, { q: l.id });
      expect(m.rows).toBe(1);
      expect(m.csv).not.toContain(raw);
      expect(m.csv).toContain(`'=HYPERLINK`);
      const a = await exportLeads(admin, { q: l.id });
      expect(a.csv).toContain(raw);
      await expect(exportLeads(rahul, {})).rejects.toThrow(/can't export/);
      const { rows } = await listAudit(admin, { kind: "export" });
      expect(rows.some((r) => /blocked/.test(r.text) && r.actor === rahul.name)).toBe(true);
      expect(rows.some((r) => /Exported 1 leads/.test(r.text))).toBe(true);
    });
  });

  describe("the audit trail", () => {
    it("is append-only, even for the application itself, and never holds a phone number or email", async () => {
      const raw = phone();
      const l = await createLead(rahul, base({ phone: raw }));
      await logCall(rahul, l.id, { outcome: "Connected", notes: `Call back on ${raw} or mail owner@gym.example` });
      const rows = await db.crmAudit.findMany({ where: { leadId: l.id } });
      const text = rows.map((r) => r.text + JSON.stringify(r.meta)).join("\n");
      expect(rows.length).toBeGreaterThan(1);
      expect(text).not.toContain(raw);
      expect(text).not.toContain("owner@gym.example");
      await expect(db.crmAudit.update({ where: { id: rows[0]!.id }, data: { text: "changed" } })).rejects.toThrow(/append-only/);
      await expect(db.crmAudit.delete({ where: { id: rows[0]!.id } })).rejects.toThrow(/append-only/);
      await expect(db.crmAudit.deleteMany({})).rejects.toThrow(/append-only/);
      await expect(listAudit(rahul, {})).rejects.toThrow(/role/i);
      await expect(listAudit(mgrW, {})).rejects.toThrow(/role/i);
    });
  });

  describe("employees", () => {
    it("lets only a Super Admin manage them, never deactivate themselves, and always keeps one", async () => {
      await expect(listEmployees(mgrW)).rejects.toThrow(/role/i);
      await expect(inviteEmployee(marketing, { name: "New Person", email: "x@y.example", role: "sales" })).rejects.toThrow(/role/i);
      const email = `${randomUUID()}@test.local`;
      const s = await inviteEmployee(admin, { name: "New Person", email, role: "sales", managerId: mgrW.id, target: 150000 });
      expect(s).toMatchObject({ role: "sales", managerId: mgrW.id, monthlyTarget: 15000000 });
      await expect(inviteEmployee(admin, { name: "Again", email, role: "sales" })).rejects.toThrow(/already/);
      await expect(updateEmployee(admin, admin.id, { active: false })).rejects.toThrow(/yourself/);
      await updateEmployee(admin, s.userId, { active: false });
      expect(await loadCrmUser(s.userId)).toBeNull(); // a deactivated employee is out of the CRM at once
      await expect(updateEmployee(mgrW, s.userId, { active: true })).rejects.toThrow(/role/i);
    });

    it("signs a deactivated employee out everywhere", async () => {
      const u = await staff("sales");
      await db.session.create({ data: { id: randomUUID(), userId: u.id, expiresAt: new Date(Date.now() + 1e6) } });
      await updateEmployee(admin, u.id, { active: false });
      expect(await db.session.count({ where: { userId: u.id } })).toBe(0);
    });

    it("does not make a stranger an employee, and makes a FITRON admin one", async () => {
      const org = await teamOrg();
      const roleId = await teamRoleId();
      const stranger = await db.user.create({ data: { orgId: org, roleId, name: "Gym owner", email: `${randomUUID()}@gym.example`, phone: "", passwordHash: "x" } });
      expect(await crmUserFor(stranger.id, stranger.email)).toBeNull();
      process.env.FITRON_ADMIN_EMAILS = stranger.email;
      try {
        expect(await crmUserFor(stranger.id, stranger.email)).toMatchObject({ role: "admin" });
      } finally {
        delete process.env.FITRON_ADMIN_EMAILS;
      }
    });
  });

  describe("dashboard", () => {
    it("starts from each role's own scope", async () => {
      const mine = (await dashboard(rahul, {})).kpi.total;
      expect(mine).toBe((await listLeads(rahul, { pageSize: 1 })).total);
      expect((await dashboard(admin, {})).kpi.total).toBe(await db.crmLead.count());
      expect((await dashboard(mgrW, {})).kpi.total).toBe((await listLeads(mgrW, { pageSize: 1 })).total);
      expect((await dashboard(rahul, {})).people).toBeUndefined();
      expect((await dashboard(marketing, {})).campaigns).toBeDefined();
    });
  });
});
