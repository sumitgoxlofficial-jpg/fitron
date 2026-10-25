import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { istInstant, todayIso } from "../time";
import { need, type CrmUser } from "../crm-access";
import { UserError } from "../errors";
import { getAcSettings } from "./core";
import { providerStatus } from "./provider";

const ANSWERED = ["COMPLETED"];

/** Every figure is counted from the stored calls; nothing here is estimated. Cost is shown only if the provider reported one (it does not, so it is null). */
export async function callingOverview(u: CrmUser) {
  need(u, "calling.view");
  const real = { test: false } as const;
  const today = istInstant(todayIso(), "00:00");
  const [settings, eligible, total, answered, byDisp, failed, demos, won, todayCalls, running, lastCall, cost] = await Promise.all([
    getAcSettings(),
    db.acConsent.count(),
    db.acCall.count({ where: { ...real, status: { notIn: ["QUEUED", "CANCELLED"] } } }),
    db.acCall.count({ where: { ...real, status: { in: ANSWERED } } }),
    db.acCall.groupBy({ by: ["disposition"], where: { ...real, disposition: { not: null } }, _count: true }),
    db.acCall.count({ where: { ...real, status: "FAILED" } }),
    db.acDemo.count({ where: { status: "BOOKED" } }),
    db.acCall.findMany({ where: real, distinct: ["leadId"], select: { leadId: true } }).then((ids) => db.crmLead.count({ where: { id: { in: ids.map((x) => x.leadId) }, stage: "Closed Won", verification: "Verified" } })),
    db.acCall.count({ where: { ...real, dialedAt: { gte: today }, status: { not: "CANCELLED" } } }),
    db.acCampaign.count({ where: { status: "RUNNING" } }),
    db.acCall.findFirst({ where: { ...real, dialedAt: { not: null } }, orderBy: { dialedAt: "desc" }, select: { dialedAt: true } }),
    db.acCall.aggregate({ where: { costPaise: { not: null } }, _sum: { costPaise: true }, _count: true }),
  ]);
  const d = (k: string) => byDisp.find((x) => x.disposition === k)?._count ?? 0;
  return {
    settings, provider: providerStatus(), eligible, total, answered, failed, todayCalls, running, lastCall: lastCall?.dialedAt ?? null,
    successful: answered,
    interested: d("INTERESTED") + d("DEMO_REQUESTED") + d("DEMO_BOOKED"),
    demoRequested: d("DEMO_REQUESTED") + d("DEMO_BOOKED"), demoBooked: demos, optOuts: d("DO_NOT_CONTACT"), handoffs: d("HUMAN_HANDOFF"),
    salesClosed: won, failureRate: total ? Math.round((failed / total) * 1000) / 10 : null,
    costPaise: cost._count ? (cost._sum.costPaise ?? 0) : null,
    byDisposition: byDisp.map((x) => [x.disposition as string, x._count] as const).sort((a, b) => b[1] - a[1]),
  };
}

export type CallFilter = { status?: string; disposition?: string; campaignId?: string; leadId?: string; page?: number };
export const CALL_PAGE = 25;

export async function listCalls(u: CrmUser, f: CallFilter) {
  need(u, "calling.view");
  const where: Prisma.AcCallWhereInput = { ...(f.status ? { status: f.status } : {}), ...(f.disposition ? { disposition: f.disposition } : {}), ...(f.campaignId ? { campaignId: f.campaignId } : {}), ...(f.leadId ? { leadId: f.leadId } : {}) };
  const page = Math.max(1, f.page ?? 1);
  const [total, rows] = await Promise.all([db.acCall.count({ where }), db.acCall.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * CALL_PAGE, take: CALL_PAGE, select: { id: true, leadId: true, phone: true, status: true, disposition: true, summary: true, durationSec: true, dialedAt: true, createdAt: true, attempt: true, test: true, error: true, campaignId: true } })]);
  const leads = await db.crmLead.findMany({ where: { id: { in: rows.map((r) => r.leadId) } }, select: { id: true, gymName: true, city: true, ownerId: true } });
  const owners = await db.user.findMany({ where: { id: { in: leads.map((l) => l.ownerId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  return { total, page, rows: rows.map((r) => { const l = leads.find((x) => x.id === r.leadId); return { ...r, phone: `${r.phone.slice(0, 2)}••••••${r.phone.slice(-2)}`, gymName: l?.gymName ?? r.leadId, city: l?.city ?? null, owner: owners.find((o) => o.id === l?.ownerId)?.name ?? null }; }) };
}

export async function callDetail(u: CrmUser, id: string) {
  need(u, "calling.view");
  const c = await db.acCall.findUnique({ where: { id }, omit: { tokenHash: true } });
  if (!c) throw new UserError("That call doesn't exist.");
  const [lead, demo, campaign] = await Promise.all([db.crmLead.findUnique({ where: { id: c.leadId }, select: { id: true, gymName: true, contactName: true, city: true, state: true, stage: true, ownerId: true } }), db.acDemo.findFirst({ where: { callId: id } }), c.campaignId ? db.acCampaign.findUnique({ where: { id: c.campaignId }, select: { id: true, name: true } }) : null]);
  const owner = lead?.ownerId ? await db.user.findUnique({ where: { id: lead.ownerId }, select: { name: true } }) : null;
  return { call: { ...c, phone: `${c.phone.slice(0, 2)}••••••${c.phone.slice(-2)}` }, lead, demo, campaign, owner: owner?.name ?? null, transcript: (c.transcript ?? null) as { role: string; text: string; at: number | null }[] | null };
}
