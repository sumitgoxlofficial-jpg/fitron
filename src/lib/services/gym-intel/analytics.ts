import "server-only";
import { db } from "@/lib/db";
import { need, type CrmUser } from "../crm-access";
import { UserError } from "../errors";
import { intelAudit } from "./core";
import { gymWhere, type GymFilter } from "./gyms";
import { promoteGym } from "./promote";

// What came of the gyms found: how many became leads, were assigned, contacted, reached a demo, and closed. A discovered
// phone number is never counted as a sale: "closed" is a deal a manager or the Super Admin verified in the CRM.

export type FunnelRow = { key: string; label: string; gyms: number; leads: number; assigned: number; contacted: number; demos: number; closed: number };

type Raw = { key: string | null; label: string | null; gyms: bigint; leads: bigint; assigned: bigint; contacted: bigint; demos: bigint; closed: bigint };
const toRow = (r: Raw): FunnelRow => ({ key: r.key ?? "—", label: r.label ?? r.key ?? "—", gyms: Number(r.gyms), leads: Number(r.leads), assigned: Number(r.assigned), contacted: Number(r.contacted), demos: Number(r.demos), closed: Number(r.closed) });

export async function analytics(u: CrmUser) {
  need(u, "intel.view");
  const [gyms, leads, bySource, byState, byOwner, unassignedByState] = await Promise.all([
    db.giGym.count(),
    db.crmLead.findMany({ where: { gym: { isNot: null } }, select: { stage: true, ownerId: true, verification: true, demoDone: true, lastContactAt: true } }),
    db.$queryRaw<Raw[]>`
      SELECT s."source" AS key, s."source" AS label, count(DISTINCT g.id) AS gyms, count(DISTINCT l.id) AS leads,
        count(DISTINCT l.id) FILTER (WHERE l."ownerId" IS NOT NULL) AS assigned,
        count(DISTINCT l.id) FILTER (WHERE l."stage" <> 'New Lead' OR l."lastContactAt" IS NOT NULL) AS contacted,
        count(DISTINCT l.id) FILTER (WHERE l."demoDone" OR l."stage" IN ('Demo Scheduled','Demo Completed','Negotiation','Closed Won')) AS demos,
        count(DISTINCT l.id) FILTER (WHERE l."stage" = 'Closed Won' AND l."verification" = 'Verified') AS closed
      FROM "GiGym" g JOIN "GiGymSource" s ON s."gymId" = g.id LEFT JOIN "CrmLead" l ON l.id = g."leadId"
      GROUP BY s."source" ORDER BY count(DISTINCT g.id) DESC`,
    db.$queryRaw<Raw[]>`
      SELECT coalesce(g."state", '(state not known)') AS key, coalesce(g."state", '(state not known)') AS label, count(DISTINCT g.id) AS gyms, count(DISTINCT l.id) AS leads,
        count(DISTINCT l.id) FILTER (WHERE l."ownerId" IS NOT NULL) AS assigned,
        count(DISTINCT l.id) FILTER (WHERE l."stage" <> 'New Lead' OR l."lastContactAt" IS NOT NULL) AS contacted,
        count(DISTINCT l.id) FILTER (WHERE l."demoDone" OR l."stage" IN ('Demo Scheduled','Demo Completed','Negotiation','Closed Won')) AS demos,
        count(DISTINCT l.id) FILTER (WHERE l."stage" = 'Closed Won' AND l."verification" = 'Verified') AS closed
      FROM "GiGym" g LEFT JOIN "CrmLead" l ON l.id = g."leadId"
      GROUP BY g."state" ORDER BY count(DISTINCT g.id) DESC LIMIT 60`,
    db.$queryRaw<Raw[]>`
      SELECT l."ownerId" AS key, coalesce(u."name", 'Unassigned') AS label, 0::bigint AS gyms, count(DISTINCT l.id) AS leads,
        count(DISTINCT l.id) FILTER (WHERE l."ownerId" IS NOT NULL) AS assigned,
        count(DISTINCT l.id) FILTER (WHERE l."stage" <> 'New Lead' OR l."lastContactAt" IS NOT NULL) AS contacted,
        count(DISTINCT l.id) FILTER (WHERE l."demoDone" OR l."stage" IN ('Demo Scheduled','Demo Completed','Negotiation','Closed Won')) AS demos,
        count(DISTINCT l.id) FILTER (WHERE l."stage" = 'Closed Won' AND l."verification" = 'Verified') AS closed
      FROM "CrmLead" l JOIN "GiGym" g ON g."leadId" = l.id LEFT JOIN "User" u ON u.id = l."ownerId"
      GROUP BY l."ownerId", u."name" ORDER BY count(DISTINCT l.id) DESC LIMIT 100`,
    db.$queryRaw<{ state: string | null; n: bigint }[]>`SELECT l."state" AS state, count(*) AS n FROM "CrmLead" l JOIN "GiGym" g ON g."leadId" = l.id WHERE l."ownerId" IS NULL GROUP BY l."state" ORDER BY count(*) DESC LIMIT 60`,
  ]);
  const contacted = leads.filter((l) => l.stage !== "New Lead" || l.lastContactAt).length;
  const demos = leads.filter((l) => l.demoDone || ["Demo Scheduled", "Demo Completed", "Negotiation", "Closed Won"].includes(l.stage)).length;
  const closed = leads.filter((l) => l.stage === "Closed Won" && l.verification === "Verified").length;
  const [flagged, skipped, withPhone] = await Promise.all([db.giGym.count({ where: { promotion: "DUPLICATE_FLAGGED" } }), db.giGym.count({ where: { promotion: "SKIPPED" } }), db.giGym.count({ where: { phoneNorm: { not: null } } })]);
  return {
    totals: { discovered: gyms, withPhone, promoted: leads.length, assigned: leads.filter((l) => l.ownerId).length, contacted, demos, closed, flagged, skipped },
    bySource: bySource.map(toRow), byState: byState.map(toRow), byOwner: byOwner.map(toRow),
    unassignedByState: unassignedByState.map((r) => ({ state: r.state ?? "(state not known)", n: Number(r.n) })),
  };
}

/** Promotes the gyms matching a filter that are ready: a mobile number a source printed, not yet a lead, not do-not-contact. At most 200 a time. */
export async function promoteMany(u: CrmUser, f: GymFilter, limit = 200) {
  need(u, "intel.manage");
  const take = Math.min(Math.max(1, limit), 200);
  const where = { AND: [gymWhere(f), { promotion: "NOT_PROMOTED", leadId: null, phoneKind: "MOBILE", phoneStatus: { in: ["SOURCE_CONFIRMED", "REACHABILITY_CONFIRMED"] } }] };
  const gyms = await db.giGym.findMany({ where, orderBy: { id: "asc" }, take, select: { id: true } });
  if (!gyms.length) throw new UserError("No gym in this selection is ready: it needs a mobile number a source printed, and not already be a lead.");
  const out = { tried: gyms.length, created: 0, linked: 0, flagged: 0, failed: 0 };
  for (const g of gyms) {
    try {
      const r = await promoteGym(u, g.id, { action: "PROMOTE" });
      if (r.result === "CREATED") out.created++;
      else if (r.result === "LINKED" || r.result === "ALREADY_PROMOTED") out.linked++;
      else out.flagged++;
    } catch {
      out.failed++;
    }
  }
  await intelAudit(db, u, `Promoted gyms in bulk: ${out.created} new leads, ${out.linked} linked, ${out.flagged} flagged, ${out.failed} not possible`, out);
  return out;
}

/** Unowned leads that came from gyms, by state: what is waiting for an owner. */
export async function assignmentOverview(u: CrmUser) {
  need(u, "intel.view");
  const [unowned, owners, history] = await Promise.all([
    db.$queryRaw<{ state: string | null; district: string | null; n: bigint }[]>`SELECT l."state" AS state, l."district" AS district, count(*) AS n FROM "CrmLead" l JOIN "GiGym" g ON g."leadId" = l.id WHERE l."ownerId" IS NULL GROUP BY l."state", l."district" ORDER BY count(*) DESC LIMIT 100`,
    db.crmStaff.findMany({ where: { status: "Active", role: { in: ["sales", "manager"] } }, include: { user: { select: { name: true } } }, orderBy: { empId: "asc" } }),
    db.crmAssignment.findMany({ where: { lead: { gym: { isNot: null } } }, orderBy: { at: "desc" }, take: 30, include: { lead: { select: { id: true, gymName: true } } } }),
  ]);
  const counts = await db.crmLead.groupBy({ by: ["ownerId"], where: { gym: { isNot: null }, ownerId: { not: null } }, _count: { _all: true } });
  const nm = new Map((await db.user.findMany({ where: { id: { in: [...new Set(history.flatMap((h) => [h.actorId, h.toOwner, h.fromOwner].filter(Boolean) as string[]))] } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]));
  return {
    unowned: unowned.map((r) => ({ state: r.state ?? "", district: r.district ?? "", n: Number(r.n) })),
    owners: owners.map((o) => ({ id: o.userId, name: o.user.name, role: o.role, empId: o.empId, leads: counts.find((c) => c.ownerId === o.userId)?._count._all ?? 0 })),
    history: history.map((h) => ({ id: h.id, at: h.at, leadId: h.lead.id, gym: h.lead.gymName, by: nm.get(h.actorId) ?? "—", from: h.fromOwner ? (nm.get(h.fromOwner) ?? "—") : "unassigned", to: h.toOwner ? (nm.get(h.toOwner) ?? "—") : "unassigned" })),
  };
}
