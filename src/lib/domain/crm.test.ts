import { describe, expect, it } from "vitest";
import { autoMapColumns, checkImport, checkStageChange, costPerLead, crmCan, csvCell, funnel, isDueToday, isOverdue, maskPhone, normalizePhone, parseProduct, targetProgress, type CrmRole } from "./crm";

const TODAY = "2026-10-24";

describe("permission matrix", () => {
  const expected: Record<string, CrmRole[]> = {
    "leads.all": ["admin", "marketing"],
    "leads.team": ["admin", "marketing", "manager"],
    "phone.full": ["admin", "manager", "sales"],
    "leads.assign": ["admin", "marketing", "manager"],
    "activity.log": ["admin", "manager", "sales"],
    "deal.submit": ["admin", "manager", "sales"],
    "deal.verify": ["admin", "manager"],
    "deal.correct": ["admin"],
    "leads.import": ["admin", "marketing"],
    "leads.export": ["admin", "marketing", "manager"],
    "campaigns.manage": ["admin", "marketing"],
    "employees.manage": ["admin"],
    "audit.view": ["admin"],
  };
  it.each(Object.entries(expected))("%s", (perm, roles) => {
    for (const r of ["admin", "marketing", "manager", "sales"] as const) expect(crmCan(r, perm as never), `${perm} for ${r}`).toBe(roles.includes(r));
  });
});

describe("phone numbers", () => {
  it("normalises the ways a number is written", () => {
    expect(normalizePhone("+91 98123 45678")).toBe("9812345678");
    expect(normalizePhone("098123-45678")).toBe("9812345678");
    expect(normalizePhone("9812345678")).toBe("9812345678");
    expect(normalizePhone("919812345678")).toBe("9812345678");
  });
  it("refuses what is not a mobile number", () => {
    for (const bad of ["", "0801234", "5812345678", "98123456", "98123456789012", null, undefined]) expect(normalizePhone(bad as string)).toBeNull();
  });
  it("masks all but a few digits", () => {
    expect(maskPhone("9812345678")).toBe("+91 98••• ••678");
    expect(maskPhone("9812345678")).not.toContain("12345");
  });
});

describe("moving a lead", () => {
  const open = { stage: "Negotiation", verification: null, estValue: 0 };
  const won = { to: "Closed Won" as const, proofType: "Payment reference", proofRef: "UTR 1234", value: 1999900, closedDate: "2026-10-23" };
  it("needs a reason to close lost or disqualify", () => {
    expect(checkStageChange(open, { to: "Closed Lost" }, "sales", TODAY)).toMatchObject({ ok: false, field: "lossReason" });
    expect(checkStageChange(open, { to: "Disqualified", lossReason: "Gym closed" }, "sales", TODAY)).toMatchObject({ ok: true });
    expect(checkStageChange(open, { to: "Closed Lost", lossReason: "made up" }, "sales", TODAY)).toMatchObject({ ok: false });
  });
  it("needs proof, a reference, a value and a date to close won", () => {
    expect(checkStageChange(open, won, "sales", TODAY)).toMatchObject({ ok: true, withdraws: false });
    expect(checkStageChange(open, { ...won, proofType: undefined }, "sales", TODAY)).toMatchObject({ ok: false, field: "proofType" });
    expect(checkStageChange(open, { ...won, proofRef: "ab" }, "sales", TODAY)).toMatchObject({ ok: false, field: "proofRef" });
    expect(checkStageChange(open, { ...won, value: 0 }, "sales", TODAY)).toMatchObject({ ok: false, field: "value" });
    expect(checkStageChange(open, { ...won, closedDate: undefined }, "sales", TODAY)).toMatchObject({ ok: false, field: "closedDate" });
    expect(checkStageChange(open, { ...won, closedDate: "2026-10-25" }, "sales", TODAY)).toMatchObject({ ok: false, field: "closedDate" });
  });
  it("locks a verified deal for everyone but a Super Admin", () => {
    const verified = { stage: "Closed Won", verification: "Verified", estValue: 100 };
    expect(checkStageChange(verified, { to: "Negotiation" }, "manager", TODAY).ok).toBe(false);
    expect(checkStageChange(verified, { to: "Negotiation" }, "admin", TODAY).ok).toBe(true);
  });
  it("withdraws a pending submission when the lead moves on", () => {
    const pending = { stage: "Closed Won", verification: "Pending", estValue: 100 };
    expect(checkStageChange(pending, { to: "Negotiation" }, "sales", TODAY)).toEqual({ ok: true, withdraws: true });
  });
});

describe("import", () => {
  const base = { contactName: "A", gymName: "G", phone: "98123 45678", product: "Gym Accounting" };
  it("keeps only valid rows and says why the rest are not", () => {
    const r = checkImport(
      [base, { ...base, phone: "98123 45678" }, { ...base, phone: "0801234" }, { ...base, phone: "9000000001", product: "" }, { ...base, phone: "9000000002", contactName: "" }, { ...base, phone: "9000000003", email: "nope" }, { ...base, phone: "9000000004" }],
      new Map([["9000000004", "FL-1001"]]),
    );
    expect(r.map((x) => x.status)).toEqual(["valid", "duplicate", "invalid", "invalid", "invalid", "invalid", "duplicate"]);
    expect(r[1]).toMatchObject({ error: "Duplicate of row 1 in this file" });
    expect(r[6]).toMatchObject({ existingId: "FL-1001" });
  });
  it("maps columns by name", () => {
    expect(autoMapColumns(["Name", "Gym", "Mobile", "City", "Interest"])).toMatchObject({ contactName: 0, gymName: 1, phone: 2, city: 3, product: 4 });
  });
  it("reads the product", () => {
    expect(parseProduct("Gym Partnership")).toBe("Partnership");
    expect(parseProduct("Accounting")).toBe("SaaS");
    expect(parseProduct("??")).toBeNull();
  });
});

describe("csv", () => {
  it("writes a formula as text and quotes what needs it", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+91 98")).toBe("'+91 98");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell(null)).toBe("");
  });
});

describe("metrics", () => {
  const leads = [
    { stage: "Closed Won", verification: "Verified", estValue: 1000, demoDone: true },
    { stage: "Closed Won", verification: "Pending", estValue: 500, demoDone: true },
    { stage: "Closed Lost", verification: null, estValue: 200, demoDone: false },
    { stage: "Contacted", verification: null, estValue: 300, demoDone: false },
    { stage: "New Lead", verification: null, estValue: 400, demoDone: false },
  ];
  it("counts only verified deals as revenue, and keeps pending apart", () => {
    const f = funnel(leads);
    expect(f).toMatchObject({ total: 5, contacted: 4, demos: 2, verifiedWon: 1, verifiedRevenue: 1000, pendingValue: 500, pendingCount: 1, openPipeline: 700 });
    expect(f.leadToContact).toBe(80);
    expect(f.demoToPaid).toBe(50);
    expect(f.conversion).toBe(50);
  });
  it("shows cost per lead only when spend is recorded", () => {
    expect(costPerLead(null, 10)).toBeNull();
    expect(costPerLead(10000, 4)).toBe(2500);
    expect(costPerLead(10000, 0)).toBeNull();
  });
  it("measures a target by deals the person closed this month", () => {
    const deals = [
      { closedById: "u", closedDate: "2026-10-03", verification: "Verified", stage: "Closed Won", estValue: 600 },
      { closedById: "u", closedDate: "2026-09-28", verification: "Verified", stage: "Closed Won", estValue: 999 },
      { closedById: "u", closedDate: "2026-10-04", verification: "Pending", stage: "Closed Won", estValue: 999 },
      { closedById: "x", closedDate: "2026-10-05", verification: "Verified", stage: "Closed Won", estValue: 999 },
    ];
    expect(targetProgress(deals, "u", "2026-10", 1000)).toEqual({ achieved: 600, target: 1000, pct: 60 });
  });
  it("is overdue only when not done and past due; due today only later today (IST)", () => {
    const now = new Date("2026-10-24T08:00:00Z");
    expect(isOverdue({ done: false, dueAt: new Date("2026-10-24T07:59:00Z") }, now)).toBe(true);
    expect(isOverdue({ done: true, dueAt: new Date("2026-10-20T07:59:00Z") }, now)).toBe(false);
    expect(isDueToday({ done: false, dueAt: new Date("2026-10-24T10:00:00Z") }, now, TODAY)).toBe(true);
    expect(isDueToday({ done: false, dueAt: new Date("2026-10-24T07:00:00Z") }, now, TODAY)).toBe(false);
    expect(isDueToday({ done: false, dueAt: new Date("2026-10-25T10:00:00Z") }, now, TODAY)).toBe(false);
  });
});
