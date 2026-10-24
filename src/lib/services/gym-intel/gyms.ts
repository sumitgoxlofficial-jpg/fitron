import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { maskPhone } from "@/lib/domain/crm";
import { PHONE_STATUSES, PROMOTION_STATES } from "@/lib/domain/gym-intel/constants";
import { need, type CrmUser } from "../crm-access";
import { UserError } from "../errors";
import { intelAudit } from "./core";
import { getSettings } from "./core";
import { refreshGym } from "./persist";
import { seedStates } from "./geo";

export type GymFilter = { q?: string; state?: string; district?: string; city?: string; pin?: string; phoneStatus?: string; promotion?: string; source?: string; hasPhone?: "yes" | "no"; review?: string; page?: number };
export const PAGE = 50;

export function gymWhere(f: GymFilter): Prisma.GiGymWhereInput {
  const and: Prisma.GiGymWhereInput[] = [];
  const q = f.q?.trim();
  if (q) {
    // Digits are a phone search only when the text is mostly digits; otherwise "gym 24" would match every number containing 24.
    const digits = q.replace(/\D/g, "");
    const numeric = digits.length >= 4 && digits.length >= q.replace(/[\s+()-]/g, "").length * 0.8;
    and.push({ OR: [{ name: { contains: q, mode: "insensitive" } }, ...(numeric ? [{ phoneNorm: { contains: digits } }] : []), { id: { equals: q.toUpperCase() } }, { domain: { contains: q.toLowerCase() } }] });
  }
  if (f.state) and.push({ state: f.state });
  if (f.district) and.push({ district: f.district });
  if (f.city) and.push({ city: { equals: f.city, mode: "insensitive" } });
  if (f.pin && /^\d{6}$/.test(f.pin)) and.push({ pin: f.pin });
  if (f.phoneStatus && (PHONE_STATUSES as readonly string[]).includes(f.phoneStatus)) and.push({ phoneStatus: f.phoneStatus });
  if (f.promotion && (PROMOTION_STATES as readonly string[]).includes(f.promotion)) and.push({ promotion: f.promotion });
  if (f.source) and.push({ sources: { some: { source: f.source } } });
  if (f.hasPhone === "yes") and.push({ phoneNorm: { not: null } });
  if (f.hasPhone === "no") and.push({ phoneNorm: null });
  if (f.review) and.push({ reviewStatus: f.review });
  return and.length ? { AND: and } : {};
}

/** Phone numbers are masked for anyone without the full-number permission (the Marketing Head sees the gym, not the number). */
export const showNumber = (u: CrmUser, e164: string | null) => (!e164 ? "" : u.can("phone.full") ? e164 : maskPhone(e164.replace(/\D/g, "").slice(-10)));

export async function listGyms(u: CrmUser, f: GymFilter) {
  need(u, "intel.view");
  const where = gymWhere(f);
  const page = Math.max(1, f.page ?? 1);
  const [rows, total] = await Promise.all([db.giGym.findMany({ where, orderBy: [{ lastSeen: "desc" }, { id: "asc" }], skip: (page - 1) * PAGE, take: PAGE, include: { _count: { select: { sources: true } } } }), db.giGym.count({ where })]);
  return { rows: rows.map((g) => ({ ...g, phoneShown: showNumber(u, g.phoneNorm) })), total, page, pages: Math.max(1, Math.ceil(total / PAGE)) };
}

export async function gymDetail(u: CrmUser, id: string) {
  need(u, "intel.view");
  const g = await db.giGym.findUnique({ where: { id }, include: { sources: { orderBy: { collectedAt: "asc" } }, lead: { select: { id: true, stage: true, ownerId: true } } } });
  if (!g) return null;
  const dups = await db.giDup.findMany({ where: { status: "OPEN", OR: [{ aId: id }, { bId: id }] }, include: { a: true, b: true } });
  return { gym: { ...g, phoneShown: showNumber(u, g.phoneNorm), sources: g.sources.map((s) => ({ ...s, phonesShown: s.phonesNorm.map((p) => showNumber(u, p)) })) }, dups };
}

export async function filterOptions(u: CrmUser) {
  need(u, "intel.view");
  const [states, sources] = await Promise.all([db.giGym.findMany({ distinct: ["state"], where: { state: { not: null } }, select: { state: true }, orderBy: { state: "asc" } }), db.giGymSource.findMany({ distinct: ["source"], select: { source: true } })]);
  return { states: states.map((s) => s.state!), sources: sources.map((s) => s.source) };
}

/** Every figure comes from the stored records; nothing here is a fixed number. */
export async function overview(u: CrmUser) {
  need(u, "intel.view");
  await seedStates();
  const [total, withPhone, formatValid, confirmed, awaiting, conflicting, openDups, statesDone, pinTotal, pinDone, jobsRunning, jobsFailed, lastOk, bySource, geoStates, recent] = await Promise.all([
    db.giGym.count(),
    db.giGym.count({ where: { phoneNorm: { not: null } } }),
    db.giGym.count({ where: { phoneStatus: { in: ["FORMAT_VALID", "SOURCE_CONFIRMED", "REACHABILITY_CONFIRMED", "STALE"] } } }),
    db.giGym.count({ where: { phoneStatus: { in: ["SOURCE_CONFIRMED", "REACHABILITY_CONFIRMED"] } } }),
    db.giGym.count({ where: { phoneNorm: { not: null }, reachability: "NOT_TESTED" } }),
    db.giGym.count({ where: { phoneStatus: "CONFLICTING_SOURCES" } }),
    db.giDup.count({ where: { status: "OPEN" } }),
    db.giGeo.count({ where: { level: "STATE", status: { in: ["COMPLETED_WITH_RESULTS", "COMPLETED_NO_RESULTS"] } } }),
    db.giGeo.count({ where: { level: "PIN" } }),
    db.$queryRaw<{ n: bigint; d: bigint }[]>`SELECT count(*) AS n, count(DISTINCT p."district") AS d FROM "GiGeo" p JOIN "GiGeo" s ON s."level" = 'STATE' AND s."name" = p."state" WHERE p."level" = 'PIN' AND s."status" IN ('COMPLETED_WITH_RESULTS','COMPLETED_NO_RESULTS')`,
    db.giJob.count({ where: { status: "RUNNING" } }),
    db.giJob.count({ where: { status: "FAILED" } }),
    db.giJob.findFirst({ where: { status: "COMPLETED" }, orderBy: { completedAt: "desc" }, select: { completedAt: true, source: true } }),
    db.giGymSource.groupBy({ by: ["source"], _count: { _all: true } }),
    db.giGeo.count({ where: { level: "STATE" } }),
    db.crmAudit.findMany({ where: { kind: "intel" }, orderBy: { id: "desc" }, take: 12 }),
  ]);
  const uniquePhones = Number((await db.$queryRaw<{ n: bigint }[]>`SELECT count(DISTINCT "phoneNorm") AS n FROM "GiGym" WHERE "phoneNorm" IS NOT NULL`)[0]?.n ?? 0);
  const pinsProcessed = Number(pinDone[0]?.n ?? 0);
  const total_ = pinTotal > 0 ? pinTotal : geoStates;
  const done_ = pinTotal > 0 ? pinsProcessed : statesDone;
  return {
    total, uniquePhones, withPhone, formatValid, confirmed, awaiting, conflicting, openDups,
    statesProcessed: statesDone, statesTotal: geoStates,
    districtsProcessed: pinTotal > 0 ? Number(pinDone[0]?.d ?? 0) : null,
    pinsProcessed: pinTotal > 0 ? pinsProcessed : null, pinsRemaining: pinTotal > 0 ? pinTotal - pinsProcessed : null, pinTotal: pinTotal || null,
    jobsRunning, jobsFailed, lastSuccess: lastOk,
    sources: bySource.map((s) => ({ source: s.source, gyms: s._count._all })),
    coveragePct: total_ ? Math.round((done_ / total_) * 1000) / 10 : 0, coverageBasis: pinTotal > 0 ? "PIN codes" : "states and union territories",
    recent: recent.map((r) => ({ id: String(r.id), text: r.text, at: r.at })),
  };
}

// ── Review ────────────────────────────────────────────────────────────────

export async function decideDup(u: CrmUser, dupId: string, action: "MERGE" | "KEEP_SEPARATE" | "DISMISS", survivorId?: string) {
  need(u, "intel.manage");
  const settings = await getSettings();
  await db.$transaction(async (tx) => {
    const d = await tx.giDup.findUnique({ where: { id: dupId }, include: { a: { include: { sources: true } }, b: { include: { sources: true } } } });
    if (!d || d.status !== "OPEN") throw new UserError("That match has already been decided.");
    if (action !== "MERGE") {
      await tx.giDup.update({ where: { id: dupId }, data: { status: action === "KEEP_SEPARATE" ? "KEPT_SEPARATE" : "DISMISSED", decidedById: u.id, decidedAt: new Date() } });
      await intelAudit(tx, u, `Possible duplicate ${action === "KEEP_SEPARATE" ? "kept as separate gyms" : "dismissed"}: ${d.aId} and ${d.bId}`, { dupId });
      return;
    }
    const keep = survivorId === d.bId ? d.b : d.a;
    const lose = keep.id === d.aId ? d.b : d.a;
    if (keep.leadId && lose.leadId) throw new UserError("Both gyms already became CRM leads. Resolve the two leads in the CRM first.");
    // Everything the losing record knew moves to the one that stays; the evidence is kept, none of it is dropped.
    await tx.giGymSource.updateMany({ where: { gymId: lose.id }, data: { gymId: keep.id } });
    if (lose.leadId) {
      await tx.giGym.update({ where: { id: lose.id }, data: { leadId: null } });
      await tx.giGym.update({ where: { id: keep.id }, data: { leadId: lose.leadId, promotion: lose.promotion } });
    }
    await tx.giDup.update({ where: { id: dupId }, data: { status: "MERGED", decidedById: u.id, decidedAt: new Date() } });
    await tx.giGym.delete({ where: { id: lose.id } });
    await refreshGym(tx, keep.id, settings);
    await intelAudit(tx, u, `Merged duplicate gyms: ${lose.id} into ${keep.id}`, { dupId, kept: keep.id, removed: lose.id });
  });
}

export async function openDups(u: CrmUser, page = 1) {
  need(u, "intel.view");
  const where = { status: "OPEN" } as const;
  const [rows, total] = await Promise.all([db.giDup.findMany({ where, orderBy: { score: "desc" }, skip: (page - 1) * 25, take: 25, include: { a: true, b: true } }), db.giDup.count({ where })]);
  return { rows: rows.map((r) => ({ ...r, a: { ...r.a, phoneShown: showNumber(u, r.a.phoneNorm) }, b: { ...r.b, phoneShown: showNumber(u, r.b.phoneNorm) } })), total };
}

export async function setReview(u: CrmUser, id: string, status: "REVIEWED" | "REJECTED" | "NEW") {
  need(u, "intel.manage");
  await db.giGym.update({ where: { id }, data: { reviewStatus: status } });
  await intelAudit(db, u, `Gym ${id} marked ${status.toLowerCase()}`);
}

/** Records lawful verification evidence for a number. Only this can make a number REACHABILITY_CONFIRMED. */
export async function recordReachability(u: CrmUser, id: string, result: "CONFIRMED" | "UNREACHABLE" | "NOT_TESTED", evidence: string) {
  need(u, "intel.manage");
  if (result !== "NOT_TESTED" && evidence.trim().length < 10) throw new UserError("Say how you checked (who you spoke to, or what you saw), at least a sentence.");
  const settings = await getSettings();
  await db.$transaction(async (tx) => {
    await tx.giGym.update({ where: { id }, data: { reachability: result, lastChecked: new Date() } });
    await refreshGym(tx, id, settings);
    await intelAudit(tx, u, `Reachability of ${id} recorded as ${result}: ${evidence.trim().slice(0, 160)}`);
  });
}

export async function suppressNumber(u: CrmUser, gymId: string, reason: string) {
  need(u, "intel.manage");
  const g = await db.giGym.findUnique({ where: { id: gymId } });
  if (!g?.phoneNorm) throw new UserError("This gym has no number to suppress.");
  await db.$transaction(async (tx) => {
    await tx.giSuppression.upsert({ where: { phoneNorm: g.phoneNorm! }, create: { phoneNorm: g.phoneNorm!, reason: reason.slice(0, 200) || "Do not contact", addedById: u.id }, update: {} });
    await tx.giGym.updateMany({ where: { phoneNorm: g.phoneNorm! }, data: { promotion: "DO_NOT_CONTACT" } });
    await intelAudit(tx, u, `Number on ${gymId} added to the do-not-contact list`);
  });
}
