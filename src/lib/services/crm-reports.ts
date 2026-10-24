import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { DATE_RANGES, STALE_DAYS, ageDays, costPerLead, funnel, isDueToday, isOverdue, targetProgress, type MetricLead } from "@/lib/domain/crm";
import { leadScope, type CrmUser } from "./crm-access";
import { todayIso } from "./time";
import { trendOf } from "./crm-insights";

export type DashFilter = { range?: string; product?: string; campaignId?: string; ownerId?: string };

const dayMs = 86_400_000;
export const RANGES = DATE_RANGES;

/** Filters apply to the lead's creation date, so each figure is a cohort, on top of what the person may see. */
function where(u: CrmUser, f: DashFilter, now: Date): Prisma.CrmLeadWhereInput {
  const and: Prisma.CrmLeadWhereInput[] = [leadScope(u)];
  const today = todayIso(now);
  if (f.range === "7" || f.range === "30" || f.range === "90") and.push({ createdAt: { gte: new Date(now.getTime() - Number(f.range) * dayMs) } });
  if (f.range === "month") and.push({ createdAt: { gte: new Date(`${today.slice(0, 7)}-01T00:00:00+05:30`) } });
  if (f.product) and.push({ product: f.product });
  if (f.campaignId) and.push({ campaignId: f.campaignId });
  if (f.ownerId) and.push(f.ownerId === "none" ? { ownerId: null } : { ownerId: f.ownerId });
  return { AND: and };
}

const names = async (ids: string[]) => new Map((await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((r) => [r.id, r.name]));
const metric = (l: { stage: string; verification: string | null; estValue: number; demoDone: boolean }): MetricLead => l;
const count = <T,>(rows: T[], key: (r: T) => string | null | undefined) => {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r) || "Unknown";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

/** What the dashboard shows, for this person's role. Every query starts from their scope. */
export async function dashboard(u: CrmUser, f: DashFilter = {}, now = new Date()) {
  const w = where(u, f, now);
  const today = todayIso(now);
  const leads = await db.crmLead.findMany({
    where: w,
    select: { id: true, stage: true, verification: true, estValue: true, demoDone: true, ownerId: true, closedById: true, closedDate: true, product: true, source: true, campaignId: true, state: true, city: true, createdAt: true, lastContactAt: true, gymName: true, updatedAt: true },
  });
  const m = leads.map((l) => ({ ...metric(l), closedDate: l.closedDate ? l.closedDate.toISOString().slice(0, 10) : null, closedById: l.closedById }));
  const kpi = funnel(m);

  // Leads per week, the last 8.
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const end = now.getTime() - (7 - i) * 7 * dayMs + 7 * dayMs;
    return { label: new Date(end - 7 * dayMs).toISOString().slice(5, 10), n: leads.filter((l) => l.createdAt.getTime() > end - 7 * dayMs && l.createdAt.getTime() <= end).length };
  });

  const myTasks = await db.crmTask.findMany({ where: { ownerId: u.id, done: false, lead: leadScope(u) }, include: { lead: { select: { id: true, gymName: true } } }, orderBy: { dueAt: "asc" }, take: 8 });
  const tasks = myTasks.map((t) => ({ ...t, overdue: isOverdue(t, now), today: isDueToday(t, now, today) }));
  const overdueAll = await db.crmTask.count({ where: { done: false, dueAt: { lt: now }, lead: leadScope(u), ...(u.role === "sales" ? { ownerId: u.id } : {}) } });

  const trend = await trendOf(u, f, 12, now);
  const out: Record<string, unknown> = { kpi, weeks, trend, tasks, overdue: overdueAll, pendingDeals: kpi.pendingCount };

  if (u.role === "sales" || u.role === "manager") {
    const staff = await db.crmStaff.findUnique({ where: { userId: u.id }, select: { monthlyTarget: true } });
    const allMine = await db.crmLead.findMany({ where: { closedById: u.id, stage: "Closed Won" }, select: { closedById: true, closedDate: true, verification: true, stage: true, estValue: true } });
    out.target = targetProgress(allMine.map((d) => ({ ...d, closedDate: d.closedDate ? d.closedDate.toISOString().slice(0, 10) : null })), u.id, today.slice(0, 7), staff?.monthlyTarget ?? 0);
  }

  if (u.role !== "sales") {
    const stageCounts = count(leads, (l) => l.stage);
    out.byStage = stageCounts;
    // Employee performance: leads they own, calls logged, demos, verified wins and revenue.
    const ownerIds = [...new Set(leads.map((l) => l.ownerId).filter((x): x is string => !!x))];
    const [nm, calls] = await Promise.all([names(ownerIds), db.crmActivity.groupBy({ by: ["actorId"], where: { type: "call", actorId: { in: ownerIds }, at: { gte: new Date(now.getTime() - 30 * dayMs) } }, _count: { _all: true } })]);
    out.people = ownerIds.map((id) => {
      const mine = leads.filter((l) => l.ownerId === id);
      const fn = funnel(mine.map(metric));
      return { id, name: nm.get(id) ?? "—", leads: mine.length, calls: calls.find((c) => c.actorId === id)?._count._all ?? 0, demos: fn.demos, won: fn.verifiedWon, revenue: fn.verifiedRevenue, conversion: fn.conversion };
    }).sort((a, b) => b.revenue - a.revenue);
    out.byProduct = ["SaaS", "Partnership"].map((p) => ({ product: p, ...funnel(leads.filter((l) => l.product === p).map(metric)) }));
    out.bySource = count(leads, (l) => l.source);
  }

  if (u.role === "marketing" || u.role === "admin") {
    const campaigns = await db.crmCampaign.findMany({ orderBy: { createdAt: "desc" } });
    out.campaigns = campaigns.map((c) => {
      const mine = leads.filter((l) => l.campaignId === c.id);
      const fn = funnel(mine.map(metric));
      return { id: c.id, name: c.name, source: c.source, spend: c.spend, leads: mine.length, cpl: costPerLead(c.spend, mine.length), won: fn.verifiedWon, revenue: fn.verifiedRevenue };
    });
    out.byState = count(leads, (l) => l.state).slice(0, 8);
    out.topCities = count(leads, (l) => l.city).slice(0, 8);
    // Open leads by age: 31+ days without closing is stale.
    const open = leads.filter((l) => !["Closed Won", "Closed Lost", "Disqualified"].includes(l.stage));
    out.ageing = [["0–7 days", 0, 7], ["8–14 days", 8, 14], ["15–30 days", 15, 30], [`${STALE_DAYS}+ days`, STALE_DAYS, Infinity]].map(([label, lo, hi]) => ({ label: label as string, stale: lo === STALE_DAYS, n: open.filter((l) => { const a = ageDays(l.createdAt, now); return a >= (lo as number) && a <= (hi as number); }).length }));
  }

  if (u.role === "admin") {
    const recent = await db.crmAudit.findMany({ orderBy: { id: "desc" }, take: 8 });
    const nm = await names([...new Set(recent.map((r) => r.actorId))]);
    out.recent = recent.map((r) => ({ id: String(r.id), text: r.text, at: r.at, actor: nm.get(r.actorId) ?? "—", leadId: r.leadId }));
  } else {
    const recent = await db.crmAudit.findMany({ where: { actorId: { in: u.teamIds } }, orderBy: { id: "desc" }, take: 8 });
    out.recent = recent.map((r) => ({ id: String(r.id), text: r.text, at: r.at, actor: "", leadId: r.leadId }));
  }
  return out as unknown as DashboardData;
}

export type DashboardData = {
  kpi: ReturnType<typeof funnel>;
  weeks: { label: string; n: number }[];
  trend: Awaited<ReturnType<typeof trendOf>>;
  tasks: { id: string; type: string; dueAt: Date; overdue: boolean; today: boolean; lead: { id: string; gymName: string } }[];
  overdue: number;
  pendingDeals: number;
  target?: { achieved: number; target: number; pct: number | null };
  byStage?: [string, number][];
  people?: { id: string; name: string; leads: number; calls: number; demos: number; won: number; revenue: number; conversion: number | null }[];
  byProduct?: ({ product: string } & ReturnType<typeof funnel>)[];
  bySource?: [string, number][];
  campaigns?: { id: string; name: string; source: string; spend: number | null; leads: number; cpl: number | null; won: number; revenue: number }[];
  byState?: [string, number][];
  topCities?: [string, number][];
  ageing?: { label: string; stale: boolean; n: number }[];
  recent: { id: string; text: string; at: Date; actor: string; leadId: string | null }[];
};
