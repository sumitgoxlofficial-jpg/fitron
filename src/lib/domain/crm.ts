// The rules of FITRON's sales CRM, with no database in them: roles and what each may do, the pipeline's stages and what moving
// a lead needs, phone numbers, imports and the dashboard's metric definitions. The services (src/lib/services/crm*.ts) apply
// them on the server for every page, action and download; nothing here is trusted from the browser.

// ── Roles and permissions ──────────────────────────────────────────────────

export const CRM_ROLES = ["admin", "marketing", "manager", "sales"] as const;
export type CrmRole = (typeof CRM_ROLES)[number];
export const CRM_ROLE_LABEL: Record<CrmRole, string> = { admin: "Super Admin", marketing: "Marketing Head", manager: "Sales Manager", sales: "Sales Employee" };

export const CRM_PERMISSIONS = {
  "leads.all": "View all leads",
  "leads.team": "View team leads",
  "leads.own": "View & update own assigned leads",
  "phone.full": "See full phone numbers",
  "leads.assign": "Assign / reassign leads",
  "activity.log": "Log calls, notes & follow-ups",
  "deal.submit": "Submit Closed Won for verification",
  "deal.verify": "Approve / reject deals",
  "deal.correct": "Correct attribution after approval",
  "leads.import": "Import leads (CSV)",
  "leads.export": "Export leads (CSV)",
  "campaigns.manage": "Manage campaigns & spend",
  "employees.manage": "Manage employees & roles",
  "audit.view": "View full audit log",
  "intel.view": "View the gym database (Gym Intelligence)",
  "intel.manage": "Run collection, manage sources, merge, export & promote gyms",
  "calling.view": "See the AI calling dashboard, calls and transcripts",
  "calling.manage": "Run AI calling: campaigns, settings, emergency stop, do-not-call list",
} as const;
export type CrmPermission = keyof typeof CRM_PERMISSIONS;

/** The matrix from the handoff, row for row. "Export leads" is also attempted by sales employees, but refused and audited. */
const GRANTS: Record<CrmPermission, readonly CrmRole[]> = {
  "leads.all": ["admin", "marketing"],
  "leads.team": ["admin", "marketing", "manager"],
  "leads.own": ["admin", "marketing", "manager", "sales"],
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
  "intel.view": ["admin", "marketing"],
  "intel.manage": ["admin"],
  "calling.view": ["admin"],
  "calling.manage": ["admin"],
};

export const crmCan = (role: CrmRole, p: CrmPermission) => GRANTS[p].includes(role);
export const crmPermissionsOf = (role: CrmRole) => (Object.keys(GRANTS) as CrmPermission[]).filter((p) => crmCan(role, p));
export const isCrmRole = (v: unknown): v is CrmRole => typeof v === "string" && (CRM_ROLES as readonly string[]).includes(v);

// ── Stages ─────────────────────────────────────────────────────────────────

export const STAGES = ["New Lead", "Contacted", "Interested", "Demo Scheduled", "Demo Completed", "Negotiation", "Closed Won", "Closed Lost", "Disqualified"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Partial<Record<Stage, string>> = { Negotiation: "Follow-up / Negotiation" };
export const stageLabel = (s: string) => STAGE_LABEL[s as Stage] ?? s;
/** The pipeline board's columns: every stage that is still being worked, then the two ways a deal closes. */
export const BOARD_STAGES = STAGES.slice(0, 8);
export const OPEN_STAGES = STAGES.slice(0, 6);
export const isStage = (v: unknown): v is Stage => typeof v === "string" && (STAGES as readonly string[]).includes(v);

export const PRODUCTS = ["SaaS", "Partnership"] as const;
export type Product = (typeof PRODUCTS)[number];
export const PRIORITIES = ["Low", "Medium", "High"] as const;
export const SOURCES = ["Meta Ads", "Google Ads", "Referral", "Event", "Website", "Other"] as const;
export const LOSS_REASONS = ["Price too high", "Chose competitor", "No response", "Not a gym / invalid lead", "Gym closed", "Timing — revisit later"] as const;
export const PROOF_TYPES = ["Payment reference", "Partnership agreement"] as const;
export const CALL_OUTCOMES = ["Connected", "No answer", "Busy", "Wrong number", "Callback requested"] as const;
export const TASK_TYPES = ["Call", "Demo", "Follow-up", "Other"] as const;
export const MIN_REJECT_REASON = 5;
export const MIN_PROOF_REF = 4;

// ── Phone numbers ──────────────────────────────────────────────────────────

/** Strips everything but digits, drops a leading 91 from a 12-digit number and a leading 0 from an 11-digit one. Null unless the result is a mobile number: 10 digits starting 6–9. */
export function normalizePhone(raw: string | null | undefined): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

/** "+91 98••• ••210": enough to recognise a number, not enough to call it. */
export const maskPhone = (p: string | null | undefined) => (p && p.length >= 4 ? `+91 ${p.slice(0, 2)}••• ••${p.slice(-3)}` : "••••••••••");
export const showPhone = (p: string | null | undefined, full: boolean) => (!p ? "" : full ? `+91 ${p.slice(0, 5)} ${p.slice(5)}` : maskPhone(p));

/** Where a mobile number's trailing digits are hidden in an email address too, so a masked view can't leak what it hides. */
export const maskEmail = (e: string | null | undefined) => (e ? e.replace(/^(.).*(@.*)$/, "$1•••$2") : "");

// ── Moving a lead between stages ───────────────────────────────────────────

export type LeadState = { stage: string; verification: string | null; estValue: number };
export type StageChange = {
  to: Stage;
  lossReason?: string;
  proofType?: string;
  proofRef?: string;
  /** Paise: for Closed Won the services work it out from the plan, never from what the browser says */
  value?: number;
  closedDate?: string;
  /** Closed Won: the plan sold, how it is billed, and the one-time add-ons (src/lib/domain/crm-plans.ts) */
  plan?: string;
  billing?: string;
  addons?: string[];
};
export type StageCheck =
  | { ok: true; /** Leaving Closed Won while it waits for approval takes the submission back. */ withdraws: boolean }
  | { ok: false; error: string; field?: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** What a move needs, from the handoff's business rules. `today` is an ISO date in India. */
export function checkStageChange(lead: LeadState, c: StageChange, role: CrmRole, today: string): StageCheck {
  if (!isStage(c.to)) return { ok: false, error: "That is not a stage." };
  if (lead.verification === "Verified" && role !== "admin") return { ok: false, error: "This deal is verified, so its stage is locked. Only a Super Admin can correct it." };
  if (c.to === lead.stage) return { ok: false, error: "The lead is already in that stage." };
  if (c.to === "Closed Lost" || c.to === "Disqualified") {
    if (!c.lossReason || !(LOSS_REASONS as readonly string[]).includes(c.lossReason)) return { ok: false, error: "Choose a reason.", field: "lossReason" };
  }
  if (c.to === "Closed Won") {
    if (!c.proofType || !(PROOF_TYPES as readonly string[]).includes(c.proofType)) return { ok: false, error: "Choose the proof: a payment reference or a partnership agreement.", field: "proofType" };
    if (!c.proofRef || c.proofRef.trim().length < MIN_PROOF_REF) return { ok: false, error: `The reference needs at least ${MIN_PROOF_REF} characters.`, field: "proofRef" };
    if (!Number.isInteger(c.value) || (c.value ?? 0) <= 0) return { ok: false, error: "Enter the deal value, more than zero.", field: "value" };
    if (!c.closedDate || !ISO.test(c.closedDate)) return { ok: false, error: "Enter the closed date.", field: "closedDate" };
    if (c.closedDate > today) return { ok: false, error: "The closed date can't be in the future.", field: "closedDate" };
  }
  return { ok: true, withdraws: lead.verification === "Pending" && c.to !== "Closed Won" };
}

/** Whether `role` may change this lead's stage, owner or closer once it is verified: only a Super Admin, and each change is logged as a correction. */
export const isLocked = (lead: { verification: string | null }, role: CrmRole) => lead.verification === "Verified" && role !== "admin";

// ── Import and export ──────────────────────────────────────────────────────

export type ImportField = "contactName" | "gymName" | "phone" | "altPhone" | "email" | "city" | "district" | "state" | "pin" | "product" | "address" | "estValue";
export const IMPORT_FIELDS: { key: ImportField; label: string; required?: boolean; aliases: string[] }[] = [
  { key: "contactName", label: "Contact name", required: true, aliases: ["contact", "name", "contact name", "owner", "person"] },
  { key: "gymName", label: "Gym / business name", required: true, aliases: ["gym", "gym name", "business", "business name", "company"] },
  { key: "phone", label: "Primary phone", required: true, aliases: ["phone", "mobile", "mobile number", "phone number", "primary phone", "contact number", "whatsapp"] },
  { key: "altPhone", label: "Alternate phone", aliases: ["alt phone", "alternate phone", "alternate", "phone 2", "mobile 2"] },
  { key: "email", label: "Email", aliases: ["email", "e-mail", "email id"] },
  { key: "city", label: "City", aliases: ["city", "town"] },
  { key: "district", label: "District", aliases: ["district"] },
  { key: "state", label: "State", aliases: ["state"] },
  { key: "pin", label: "PIN code", aliases: ["pin", "pincode", "pin code", "zip", "postal code"] },
  { key: "address", label: "Address", aliases: ["address", "street"] },
  { key: "product", label: "Product", required: true, aliases: ["product", "interest", "interested in", "service"] },
  { key: "estValue", label: "Estimated value (₹)", aliases: ["value", "est value", "estimated value", "deal value"] },
];
export const MAX_IMPORT_ROWS = 2000;

/** Maps the file's header row to fields, by name; unmatched fields stay unmapped. */
export function autoMapColumns(headers: string[]): Partial<Record<ImportField, number>> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const out: Partial<Record<ImportField, number>> = {};
  const used = new Set<number>();
  for (const f of IMPORT_FIELDS) {
    const i = headers.findIndex((h, idx) => !used.has(idx) && (f.aliases.includes(norm(h)) || norm(h) === norm(f.label)));
    if (i >= 0) {
      out[f.key] = i;
      used.add(i);
    }
  }
  return out;
}

/** "SaaS" / "Gym Accounting" / "software" → SaaS; "Partnership" / "partner" → Partnership. */
export function parseProduct(v: string | null | undefined): Product | null {
  const s = (v ?? "").toLowerCase();
  if (!s.trim()) return null;
  if (/partner/.test(s)) return "Partnership";
  if (/saas|account|software|gym management|billing/.test(s)) return "SaaS";
  return null;
}

export type ImportRow = { n: number; phone: string | null; contactName: string; gymName: string; altPhone: string | null; email: string | null; city: string | null; district: string | null; state: string | null; pin: string | null; address: string | null; product: Product | null; estValue: number };
export type ImportResult =
  | { n: number; status: "valid"; row: ImportRow & { phone: string; product: Product } }
  | { n: number; status: "invalid"; error: string; row: ImportRow }
  | { n: number; status: "duplicate"; error: string; existingId: string | null; row: ImportRow };

/** Checks each row on its own: a missing name, an invalid number, no product, a number already in the CRM (`existing`: phone → lead id) or earlier in the same file. Only the "valid" ones are inserted. */
export function checkImport(rows: Record<string, string>[], existing: ReadonlyMap<string, string>): ImportResult[] {
  const seen = new Map<string, number>();
  return rows.map((r, i) => {
    const n = i + 1;
    const phone = normalizePhone(r.phone);
    const rupees = Number(String(r.estValue ?? "").replace(/[^\d.]/g, ""));
    const row: ImportRow = {
      n,
      phone,
      contactName: (r.contactName ?? "").trim().slice(0, 120),
      gymName: (r.gymName ?? "").trim().slice(0, 160),
      altPhone: normalizePhone(r.altPhone),
      email: (r.email ?? "").trim().slice(0, 160) || null,
      city: (r.city ?? "").trim().slice(0, 80) || null,
      district: (r.district ?? "").trim().slice(0, 80) || null,
      state: (r.state ?? "").trim().slice(0, 80) || null,
      pin: (r.pin ?? "").replace(/\D/g, "").slice(0, 6) || null,
      address: (r.address ?? "").trim().slice(0, 300) || null,
      product: parseProduct(r.product),
      estValue: Number.isFinite(rupees) && rupees > 0 ? Math.round(rupees * 100) : 0,
    };
    if (!row.contactName) return { n, status: "invalid", error: "Missing contact name", row };
    if (!row.gymName) return { n, status: "invalid", error: "Missing gym name", row };
    if (!phone) return { n, status: "invalid", error: "Invalid phone number", row };
    if (!row.product) return { n, status: "invalid", error: "Missing or unknown product", row };
    if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) return { n, status: "invalid", error: "Invalid email", row };
    const inCrm = existing.get(phone);
    if (inCrm) return { n, status: "duplicate", error: `Duplicate of ${inCrm} — skipped for review`, existingId: inCrm, row };
    const first = seen.get(phone);
    if (first) return { n, status: "duplicate", error: `Duplicate of row ${first} in this file`, existingId: null, row };
    seen.set(phone, n);
    return { n, status: "valid", row: { ...row, phone, product: row.product } };
  });
}

/** One CSV cell. A value that a spreadsheet would run as a formula ( = + - @ ) is written as text, so a lead named "=HYPERLINK(…)" can't do anything when an export is opened. */
export function csvCell(v: string | number | null | undefined): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const csvLine = (cells: (string | number | null | undefined)[]) => cells.map(csvCell).join(",");

// ── Dashboard metrics ──────────────────────────────────────────────────────
// Filters apply to the lead's creation date, so each figure is a cohort. Revenue is verified Closed Won only; a deal waiting for
// approval is "pending value" and never added to it.

export type MetricLead = { stage: string; verification: string | null; estValue: number; demoDone: boolean; closedById?: string | null; closedDate?: string | null };

export const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) : null);

export function funnel(leads: MetricLead[]) {
  const total = leads.length;
  const contacted = leads.filter((l) => l.stage !== "New Lead").length;
  const demos = leads.filter((l) => l.demoDone).length;
  const verifiedWon = leads.filter((l) => l.stage === "Closed Won" && l.verification === "Verified");
  const lost = leads.filter((l) => l.stage === "Closed Lost").length;
  return {
    total,
    contacted,
    demos,
    verifiedWon: verifiedWon.length,
    lost,
    leadToContact: pct(contacted, total),
    contactToDemo: pct(demos, contacted),
    demoToPaid: pct(verifiedWon.length, demos),
    /** Verified won ÷ (verified won + closed lost) */
    conversion: pct(verifiedWon.length, verifiedWon.length + lost),
    verifiedRevenue: verifiedWon.reduce((a, l) => a + l.estValue, 0),
    pendingValue: leads.filter((l) => l.verification === "Pending").reduce((a, l) => a + l.estValue, 0),
    pendingCount: leads.filter((l) => l.verification === "Pending").length,
    openPipeline: leads.filter((l) => (OPEN_STAGES as readonly string[]).includes(l.stage)).reduce((a, l) => a + l.estValue, 0),
  };
}

/** Spend ÷ leads, only when spend was recorded; null reads "Not recorded". */
export const costPerLead = (spend: number | null, leads: number) => (spend == null || leads === 0 ? null : Math.round(spend / leads));

/** Verified revenue from deals this person closed in `month` (YYYY-MM) ÷ their monthly target. */
export function targetProgress(deals: { closedById: string | null; closedDate: string | null; verification: string | null; stage: string; estValue: number }[], userId: string, month: string, target: number) {
  const achieved = deals.filter((d) => d.closedById === userId && d.stage === "Closed Won" && d.verification === "Verified" && d.closedDate?.startsWith(month)).reduce((a, d) => a + d.estValue, 0);
  return { achieved, target, pct: pct(achieved, target) };
}

/** Whole days since `at`, for the open-lead ageing table; 31+ days is "stale". */
export const ageDays = (at: Date, now = new Date()) => Math.max(0, Math.floor((now.getTime() - at.getTime()) / 86_400_000));
export const STALE_DAYS = 31;

/** A task is overdue when it isn't done and was due before `now`. */
export const isOverdue = (t: { done: boolean; dueAt: Date }, now = new Date()) => !t.done && t.dueAt.getTime() < now.getTime();
/** Due later today (India), not done and not yet overdue. */
export function isDueToday(t: { done: boolean; dueAt: Date }, now = new Date(), today: string) {
  if (t.done || isOverdue(t, now)) return false;
  return new Date(t.dueAt.getTime() + 330 * 60_000).toISOString().slice(0, 10) === today;
}

/** The date ranges the dashboard and Reports can be limited to (the lead's creation date). */
export const DATE_RANGES = [
  ["all", "All time"],
  ["7", "Last 7 days"],
  ["30", "Last 30 days"],
  ["month", "This month"],
  ["90", "Last 90 days"],
] as const;
