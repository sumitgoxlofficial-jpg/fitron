import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { LOSS_REASONS, OPEN_STAGES, funnel, isStage, maskPhone, showPhone, stageLabel, csvLine, type MetricLead } from "@/lib/domain/crm";
import { crmAudit, inScope, leadScope, need, type CrmUser } from "./crm-access";
import { UserError } from "./errors";
import { todayIso } from "./time";
import { normaliseLayout, type Layout } from "@/lib/domain/crm-dash";
import { DATE_RANGES } from "@/lib/domain/crm";

const DAY = 86_400_000;
const names = async (ids: string[]) => new Map((await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, photoKey: true } })).map((r) => [r.id, r]));

// ── Filters shared by the dashboard and Reports ────────────────────────────

export type ReportFilter = { range?: string; product?: string; campaignId?: string; ownerId?: string };
export const REPORT_RANGES = DATE_RANGES;

/** The leads in a report: the person's scope, then the filters, which apply to the lead's creation date. */
export function reportWhere(u: CrmUser, f: ReportFilter, now = new Date()): Prisma.CrmLeadWhereInput {
  const and: Prisma.CrmLeadWhereInput[] = [leadScope(u)];
  if (f.range === "7" || f.range === "30" || f.range === "90") and.push({ createdAt: { gte: new Date(now.getTime() - Number(f.range) * DAY) } });
  if (f.range === "month") and.push({ createdAt: { gte: new Date(`${todayIso(now).slice(0, 7)}-01T00:00:00+05:30`) } });
  if (f.product) and.push({ product: f.product });
  if (f.campaignId) and.push({ campaignId: f.campaignId });
  if (f.ownerId) and.push(f.ownerId === "none" ? { ownerId: null } : { ownerId: f.ownerId });
  return { AND: and };
}

const weekStart = (d: Date, now: Date) => Math.floor((now.getTime() - d.getTime()) / (7 * DAY));

/** Pipeline created and revenue approved, by week, for the last `weeks` weeks (oldest first). Revenue is approved deals only. */
export async function trendOf(u: CrmUser, f: ReportFilter, weeks = 12, now = new Date()) {
  const since = new Date(now.getTime() - weeks * 7 * DAY);
  const where = reportWhere(u, { ...f, range: undefined }, now);
  const [created, approved] = await Promise.all([
    db.crmLead.findMany({ where: { AND: [where, { createdAt: { gte: since } }] }, select: { createdAt: true, estValue: true } }),
    db.crmLead.findMany({ where: { AND: [where, { verification: "Verified", verifiedAt: { gte: since } }] }, select: { verifiedAt: true, estValue: true } }),
  ]);
  const a = Array<number>(weeks).fill(0);
  const b = Array<number>(weeks).fill(0);
  for (const l of created) { const w = weeks - 1 - weekStart(l.createdAt, now); if (w >= 0 && w < weeks) a[w]! += l.estValue; }
  for (const l of approved) { const w = weeks - 1 - weekStart(l.verifiedAt!, now); if (w >= 0 && w < weeks) b[w]! += l.estValue; }
  const labels = Array.from({ length: weeks }, (_, i) => new Date(now.getTime() - (weeks - 1 - i) * 7 * DAY).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }));
  return { labels, created: a, revenue: b, sumCreated: a.reduce((x, y) => x + y, 0), sumRevenue: b.reduce((x, y) => x + y, 0) };
}

// ── Reports ────────────────────────────────────────────────────────────────

export async function reportView(u: CrmUser, f: ReportFilter, now = new Date()) {
  if (u.role === "sales") need(u, "leads.team");
  const leads = await db.crmLead.findMany({
    where: reportWhere(u, f, now),
    select: { stage: true, verification: true, estValue: true, demoDone: true, source: true, product: true, lossReason: true, createdAt: true },
  });
  const m: MetricLead[] = leads.map((l) => l);
  const k = funnel(m);
  const won = leads.filter((l) => l.stage === "Closed Won" && l.verification === "Verified");
  const open = leads.filter((l) => (OPEN_STAGES as readonly string[]).includes(l.stage));
  const lossCounts = new Map<string, number>();
  for (const l of leads) if (l.stage === "Closed Lost" || l.stage === "Disqualified") { const key = (l.lossReason ?? "No reason").split(" — ")[0]!; lossCounts.set(key, (lossCounts.get(key) ?? 0) + 1); }
  const sources = [...new Set(leads.map((l) => l.source))].map((s) => {
    const mine = leads.filter((l) => l.source === s);
    const fn = funnel(mine);
    return { source: s, leads: fn.total, contacted: fn.contacted, demos: fn.demos, won: fn.verifiedWon, revenue: fn.verifiedRevenue };
  }).sort((a, b) => b.revenue - a.revenue || b.leads - a.leads);
  const stageValue = OPEN_STAGES.map((s) => ({ stage: s, label: stageLabel(s), n: leads.filter((l) => l.stage === s).length, value: leads.filter((l) => l.stage === s).reduce((a, l) => a + l.estValue, 0) }));
  const pipeSaaS = open.filter((l) => l.product === "SaaS").reduce((a, l) => a + l.estValue, 0);
  const pipePartner = open.filter((l) => l.product === "Partnership").reduce((a, l) => a + l.estValue, 0);
  return {
    kpi: { ...k, avgDeal: won.length ? Math.round(won.reduce((a, l) => a + l.estValue, 0) / won.length) : 0 },
    funnel: [
      { label: "Leads", n: k.total, conv: null as number | null },
      { label: "Contacted", n: k.contacted, conv: k.leadToContact },
      { label: "Demo done", n: k.demos, conv: k.contactToDemo },
      { label: "Won (verified)", n: k.verifiedWon, conv: k.demoToPaid },
    ],
    mix: { total: pipeSaaS + pipePartner, saas: pipeSaaS, partner: pipePartner },
    loss: [...LOSS_REASONS.map((r) => [r, lossCounts.get(r) ?? 0] as const), ...[...lossCounts].filter(([r]) => !(LOSS_REASONS as readonly string[]).includes(r))].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]),
    stageValue,
    sources,
    trend: await trendOf(u, f, 12, now),
  };
}

export async function reportCsv(u: CrmUser, f: ReportFilter) {
  if (!u.can("leads.export")) {
    await crmAudit(db, { actorId: u.id, kind: "export", text: "Report export blocked: this role can't export" });
    throw new UserError("Your role can't export.");
  }
  const r = await reportView(u, f);
  const lines = [csvLine(["Source", "Leads", "Contacted", "Demos", "Won (verified)", "Verified revenue (₹)"])];
  for (const s of r.sources) lines.push(csvLine([s.source, s.leads, s.contacted, s.demos, s.won, Math.round(s.revenue / 100)]));
  lines.push("", csvLine(["Funnel", "Count", "Conversion %"]));
  for (const x of r.funnel) lines.push(csvLine([x.label, x.n, x.conv ?? ""]));
  await crmAudit(db, { actorId: u.id, kind: "export", text: "Exported the report", meta: { sources: r.sources.length } });
  return lines.join("\n") + "\n";
}

// ── Leaderboard ────────────────────────────────────────────────────────────

export async function leaderboard(u: CrmUser, period: "month" | "all", now = new Date()) {
  const staff = await db.crmStaff.findMany({ where: { role: "sales", status: "Active" }, include: { user: { select: { name: true, photoKey: true } } } });
  const since = period === "month" ? new Date(`${todayIso(now).slice(0, 7)}-01T00:00:00+05:30`) : new Date(0);
  const ids = staff.map((s) => s.userId);
  const [deals, closed, calls, demos] = await Promise.all([
    db.crmLead.findMany({ where: { closedById: { in: ids }, stage: "Closed Won", verification: "Verified", verifiedAt: { gte: since } }, select: { closedById: true, estValue: true } }),
    db.crmLead.findMany({ where: { ownerId: { in: ids }, stage: "Closed Lost", updatedAt: { gte: since } }, select: { ownerId: true } }),
    db.crmActivity.groupBy({ by: ["actorId"], where: { type: "call", actorId: { in: ids }, at: { gte: since } }, _count: { _all: true } }),
    db.crmLead.findMany({ where: { ownerId: { in: ids }, demoDone: true, updatedAt: { gte: since } }, select: { ownerId: true } }),
  ]);
  const rows = staff.map((s) => {
    const mine = deals.filter((d) => d.closedById === s.userId);
    const lost = closed.filter((d) => d.ownerId === s.userId).length;
    return { userId: s.userId, name: s.user.name, hasPhoto: !!s.user.photoKey, revenue: mine.reduce((a, d) => a + d.estValue, 0), won: mine.length, calls: calls.find((c) => c.actorId === s.userId)?._count._all ?? 0, demos: demos.filter((d) => d.ownerId === s.userId).length, conversion: mine.length + lost ? Math.round((mine.length / (mine.length + lost)) * 100) : null };
  }).sort((a, b) => b.revenue - a.revenue || b.won - a.won || a.name.localeCompare(b.name));
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

// ── Activity ───────────────────────────────────────────────────────────────

export const ACTIVITY_KINDS = ["call", "stage", "assign", "verify", "task", "create", "import", "export", "user"] as const;

/** What happened, newest first: a salesperson sees their own actions; everyone else sees what happened on the leads they may open. */
export async function activityFeed(u: CrmUser, f: { person?: string; kind?: string }, limit = 120) {
  const where: Prisma.CrmAuditWhereInput[] = [{ kind: { not: "denied" } }];
  if (u.role === "sales") where.push({ actorId: u.id });
  
  if (f.person) where.push({ actorId: f.person });
  if (f.kind && (ACTIVITY_KINDS as readonly string[]).includes(f.kind)) where.push({ kind: f.kind });
  let rows = await db.crmAudit.findMany({ where: { AND: where }, orderBy: { id: "desc" }, take: limit * 2 });
  // Only entries about leads the person may open (the audit table has no relation to leads).
  const leadIds = [...new Set(rows.map((r) => r.leadId).filter((x): x is string => !!x))];
  const visible = u.role === "admin" || u.role === "sales" ? null : new Set((await db.crmLead.findMany({ where: { AND: [{ id: { in: leadIds } }, leadScope(u)] }, select: { id: true } })).map((l) => l.id));
  rows = rows.filter((r) => !r.leadId || !visible || visible.has(r.leadId)).slice(0, limit);
  const nm = await names([...new Set(rows.map((r) => r.actorId))]);
  const gyms = new Map((await db.crmLead.findMany({ where: { id: { in: rows.map((r) => r.leadId).filter((x): x is string => !!x) } }, select: { id: true, gymName: true } })).map((l) => [l.id, l.gymName]));
  const items = rows.map((r) => ({ id: String(r.id), at: r.at, kind: r.kind, text: r.text, actorId: r.actorId, actor: nm.get(r.actorId)?.name ?? "—", hasPhoto: !!nm.get(r.actorId)?.photoKey, leadId: r.leadId, gym: r.leadId ? (gyms.get(r.leadId) ?? null) : null }));
  const days = new Map<string, typeof items>();
  for (const it of items) {
    const d = new Date(it.at.getTime() + 330 * 60_000).toISOString().slice(0, 10);
    days.set(d, [...(days.get(d) ?? []), it]);
  }
  const people = u.role === "sales" ? [] : (await db.crmStaff.findMany({ where: { status: { not: "Invited" } }, include: { user: { select: { name: true } } }, orderBy: { empId: "asc" } })).map((s) => ({ id: s.userId, name: s.user.name }));
  return { days: [...days].map(([day, list]) => ({ day, items: list })), people };
}

// ── Companies and contacts ─────────────────────────────────────────────────

export type Company = { key: string; name: string; where: string; status: "Customer" | "Prospect" | "Lost"; contacts: number; openValue: number; wonValue: number; plan: string; owner: string; leadId: string };

/** Gyms, with every contact and deal under them. Leads at the same gym in the same city are one company. */
export async function companies(u: CrmUser, q?: string): Promise<Company[]> {
  const leads = await db.crmLead.findMany({ where: leadScope(u), include: { contacts: { select: { id: true } } }, orderBy: { updatedAt: "desc" }, take: 2000 });
  const owners = await names([...new Set(leads.map((l) => l.ownerId).filter((x): x is string => !!x))]);
  const groups = new Map<string, typeof leads>();
  for (const l of leads) {
    const key = `${l.gymName.trim().toLowerCase()}|${(l.city ?? "").trim().toLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  const needle = q?.trim().toLowerCase();
  const out: Company[] = [];
  for (const [key, g] of groups) {
    const first = g[0]!;
    const hay = `${first.gymName} ${first.city ?? ""} ${first.state ?? ""}`.toLowerCase();
    if (needle && !hay.includes(needle)) continue;
    const wonV = g.filter((l) => l.stage === "Closed Won" && l.verification === "Verified");
    out.push({
      key, name: first.gymName, where: [first.city, first.state].filter(Boolean).join(", "),
      status: wonV.length ? "Customer" : g.every((l) => l.stage === "Closed Lost" || l.stage === "Disqualified") ? "Lost" : "Prospect",
      contacts: g.reduce((a, l) => a + 1 + l.contacts.length, 0),
      openValue: g.filter((l) => (OPEN_STAGES as readonly string[]).includes(l.stage)).reduce((a, l) => a + l.estValue, 0),
      wonValue: wonV.reduce((a, l) => a + l.estValue, 0),
      plan: first.plan, owner: first.ownerId ? (owners.get(first.ownerId)?.name ?? "—") : "Unassigned", leadId: first.id,
    });
  }
  return out.sort((a, b) => b.wonValue - a.wonValue || b.openValue - a.openValue || a.name.localeCompare(b.name)).slice(0, 300);
}

export async function listContacts(u: CrmUser, leadId: string) {
  const l = await db.crmLead.findFirst({ where: { AND: [{ id: leadId }, leadScope(u)] }, select: { contactName: true, phone: true, email: true, id: true } });
  if (!l) return [];
  const extra = await db.crmContact.findMany({ where: { leadId }, orderBy: { createdAt: "asc" } });
  const full = u.can("phone.full");
  return [
    { id: "primary", name: l.contactName, title: "Primary contact", phone: showPhone(l.phone, full), email: full ? (l.email ?? "") : l.email ? l.email.replace(/^(.).*(@.*)$/, "$1•••$2") : "" },
    ...extra.map((c) => ({ id: c.id, name: c.name, title: c.title ?? "", phone: c.phone ? (full ? showPhone(c.phone, true) : maskPhone(c.phone)) : "", email: c.email ? (full ? c.email : c.email.replace(/^(.).*(@.*)$/, "$1•••$2")) : "" })),
  ];
}

export async function addContact(u: CrmUser, leadId: string, c: { name: string; title?: string; phone?: string; email?: string }) {
  need(u, "activity.log");
  const lead = await db.crmLead.findUnique({ where: { id: leadId } });
  if (!lead || !inScope(u, lead)) throw new UserError("You don't have access to this lead.");
  const name = c.name.trim();
  if (name.length < 2) throw new UserError("Enter the person's name.", "name");
  const { normalizePhone } = await import("@/lib/domain/crm");
  const phone = c.phone?.trim() ? normalizePhone(c.phone) : null;
  if (c.phone?.trim() && !phone) throw new UserError("Enter a valid 10-digit mobile number.", "phone");
  if (c.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim())) throw new UserError("That email address isn't valid.", "email");
  await db.$transaction(async (tx) => {
    await tx.crmContact.create({ data: { leadId, name: name.slice(0, 120), title: c.title?.trim().slice(0, 80) || null, phone, email: c.email?.trim() || null, createdById: u.id } });
    await crmAudit(tx, { actorId: u.id, leadId, kind: "create", text: `Contact added: ${name}` });
  });
}

// ── Saved views and bulk actions on the leads list ─────────────────────────

export async function listViews(u: CrmUser) {
  return (await db.crmSavedView.findMany({ where: { ownerId: u.id }, orderBy: { createdAt: "asc" } })).map((v) => ({ id: v.id, name: v.name, filters: v.filters as Record<string, string> }));
}

const FILTER_KEYS = ["q", "stage", "product", "owner", "campaign", "verification"] as const;
export async function saveView(u: CrmUser, name: string, filters: Record<string, string | undefined>) {
  const n = name.trim();
  if (n.length < 2) throw new UserError("Name the view.", "name");
  if ((await db.crmSavedView.count({ where: { ownerId: u.id } })) >= 20) throw new UserError("You can keep up to 20 views. Delete one first.");
  const clean = Object.fromEntries(FILTER_KEYS.filter((k) => filters[k]).map((k) => [k, String(filters[k]).slice(0, 100)]));
  await db.crmSavedView.create({ data: { ownerId: u.id, name: n.slice(0, 40), filters: clean } });
}
export async function deleteView(u: CrmUser, id: string) {
  await db.crmSavedView.deleteMany({ where: { id, ownerId: u.id } });
}

// ── The dashboard's layout, saved with the person ──────────────────────────

export async function getLayout(u: CrmUser): Promise<Layout> {
  const s = await db.crmStaff.findUnique({ where: { userId: u.id }, select: { prefs: true } });
  return normaliseLayout(u.role, (s?.prefs as { dashboard?: unknown } | null)?.dashboard);
}
export async function saveLayout(u: CrmUser, raw: unknown) {
  const layout = normaliseLayout(u.role, raw);
  const s = await db.crmStaff.findUnique({ where: { userId: u.id }, select: { prefs: true } });
  await db.crmStaff.update({ where: { userId: u.id }, data: { prefs: { ...((s?.prefs as object | null) ?? {}), dashboard: layout } } });
  return layout;
}

// ── The search palette ─────────────────────────────────────────────────────

export type PaletteHit = { kind: "page" | "lead" | "action"; label: string; sub: string; href: string };

export async function paletteSearch(u: CrmUser, q: string, pages: { label: string; sub: string; href: string }[]): Promise<PaletteHit[]> {
  const s = q.trim();
  const hits: PaletteHit[] = [];
  const needle = s.toLowerCase();
  for (const p of pages) if (!needle || p.label.toLowerCase().includes(needle)) hits.push({ kind: "page", ...p });
  if (s.length >= 2) {
    const digits = s.replace(/\D/g, "");
    const or: Prisma.CrmLeadWhereInput[] = [{ gymName: { contains: s, mode: "insensitive" } }, { contactName: { contains: s, mode: "insensitive" } }, { id: { contains: s, mode: "insensitive" } }, { city: { contains: s, mode: "insensitive" } }];
    // A number only finds a lead for a role that sees numbers in full.
    if (digits.length >= 4 && u.can("phone.full")) or.push({ phone: { contains: digits } });
    const leads = await db.crmLead.findMany({ where: { AND: [leadScope(u), { OR: or }] }, orderBy: { updatedAt: "desc" }, take: 6, select: { id: true, gymName: true, contactName: true, stage: true } });
    for (const l of leads) hits.push({ kind: "lead", label: l.gymName, sub: `${l.id} · ${l.contactName} · ${isStage(l.stage) ? stageLabel(l.stage) : l.stage}`, href: `/crm/leads/${l.id}` });
  }
  return hits.slice(0, 12);
}

