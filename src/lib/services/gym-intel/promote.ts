import "server-only";
import { db } from "@/lib/db";
import { normalizePhone } from "@/lib/domain/crm";
import { parsePhone } from "@/lib/domain/gym-intel/phone";
import { nameSimilarity } from "@/lib/domain/gym-intel/text";
import { need, type CrmUser } from "../crm-access";
import { createLead } from "../crm-leads";
import { UserError } from "../errors";
import { intelAudit } from "./core";

// Turning a discovered gym into a CRM lead. The discovery record and the sales lead stay separate: the gym keeps its evidence
// and phone status, the lead has its own pipeline stage and owner. A promotion never creates a second lead for the same gym.

export type PromoteAction = "PROMOTE" | "LINK_EXISTING" | "SKIP" | "FLAG_DUPLICATE";
export type PromoteResult = { result: "CREATED" | "LINKED" | "SKIPPED" | "FLAGGED" | "ALREADY_PROMOTED"; leadId?: string; reason?: string };

/** The mobile number a CRM lead can hold: the primary if it is a mobile, else another mobile a source printed. */
async function leadPhone(gymId: string): Promise<string | null> {
  const g = await db.giGym.findUniqueOrThrow({ where: { id: gymId }, include: { sources: true } });
  const candidates = [g.phoneNorm, ...g.sources.flatMap((s) => s.phonesNorm)].filter(Boolean) as string[];
  for (const c of candidates) {
    // A landline whose area code starts with 6–9 would pass for a mobile by its digits alone: the number's type decides.
    if (parsePhone(c)?.kind !== "MOBILE") continue;
    const n = normalizePhone(c);
    if (n) return n;
  }
  return null;
}

const noteText = (g: { id: string; sources: { sourceUrl: string; source: string }[]; phoneStatus: string; createdAt: Date; website: string | null }) =>
  `Found by Gym Intelligence (${g.id}) on ${g.createdAt.toISOString().slice(0, 10)}. Phone status: ${g.phoneStatus.toLowerCase().replace(/_/g, " ")}. This is the gym's published business number, not the owner's direct line. Source: ${g.sources[0]?.sourceUrl ?? "—"}${g.website ? ` · Website: ${g.website}` : ""}`.slice(0, 1000);

export async function promoteGym(u: CrmUser, gymId: string, a: { action: PromoteAction; leadId?: string; assignTo?: string | null }): Promise<PromoteResult> {
  need(u, "intel.manage");
  const g = await db.giGym.findUnique({ where: { id: gymId }, include: { sources: { orderBy: { collectedAt: "asc" } } } });
  if (!g) throw new UserError("That gym record doesn't exist.");
  if (g.leadId) return { result: "ALREADY_PROMOTED", leadId: g.leadId };

  if (a.action === "SKIP") {
    await db.giGym.update({ where: { id: gymId }, data: { promotion: "SKIPPED" } });
    await intelAudit(db, u, `Gym ${gymId} skipped for CRM promotion`);
    return { result: "SKIPPED" };
  }
  if (a.action === "FLAG_DUPLICATE") {
    await db.giGym.update({ where: { id: gymId }, data: { promotion: "DUPLICATE_FLAGGED" } });
    await intelAudit(db, u, `Gym ${gymId} flagged as a possible duplicate lead`);
    return { result: "FLAGGED" };
  }
  if (g.promotion === "DO_NOT_CONTACT") throw new UserError("This number is on the do-not-contact list.");
  if (g.phoneStatus === "INVALID_FORMAT" || g.phoneStatus === "UNAVAILABLE") throw new UserError("Its phone number isn't usable. Fix or skip it first.");
  const phone = await leadPhone(gymId);
  if (!phone) throw new UserError("CRM leads need a mobile number, and this gym has only a landline, toll-free or no number. Skip it, or add a mobile number once a source publishes one.");
  if (await db.giSuppression.findFirst({ where: { phoneNorm: { endsWith: phone } } })) throw new UserError("This number is on the do-not-contact list.");

  const byPhone = await db.crmLead.findUnique({ where: { phone }, select: { id: true, gymName: true } });
  // A different number but the same gym name in the same PIN code is probably a lead we already hold.
  const similar = byPhone ? null : g.pin ? (await db.crmLead.findMany({ where: { pin: g.pin }, select: { id: true, gymName: true }, take: 100 })).find((l) => nameSimilarity(l.gymName, g.name) >= 0.88) : null;
  const existing = byPhone ?? (a.action === "LINK_EXISTING" && a.leadId ? await db.crmLead.findUnique({ where: { id: a.leadId }, select: { id: true, gymName: true } }) : null);

  if (similar && a.action === "PROMOTE") {
    await db.giGym.update({ where: { id: gymId }, data: { promotion: "DUPLICATE_FLAGGED" } });
    await intelAudit(db, u, `Gym ${gymId} looks like existing lead ${similar.id}: not promoted, flagged for review`);
    return { result: "FLAGGED", leadId: similar.id, reason: `A lead called “${similar.gymName}” already exists in the same PIN code (${similar.id}). Link it, or flag it and decide later.` };
  }

  if (existing) {
    // Update the existing lead: fill what it is missing, add the discovery note, keep its owner and stage.
    await db.$transaction(async (tx) => {
      const l = await tx.crmLead.findUniqueOrThrow({ where: { id: existing.id } });
      await tx.crmLead.update({ where: { id: l.id }, data: { address: l.address ?? g.address, city: l.city ?? g.city, district: l.district ?? g.district, state: l.state ?? g.state, pin: l.pin ?? g.pin, version: { increment: 1 } } });
      await tx.crmActivity.create({ data: { leadId: l.id, actorId: u.id, type: "note", notes: noteText(g) } });
      await tx.giGym.update({ where: { id: gymId }, data: { leadId: l.id, promotion: "PROMOTED" } });
      await intelAudit(tx, u, `Gym ${gymId} linked to existing lead ${l.id}`, { leadId: l.id });
    });
    return { result: "LINKED", leadId: existing.id };
  }

  const lead = await createLead(u, { contactName: "Front desk", gymName: g.name, phone, address: g.address ?? undefined, city: g.city ?? undefined, district: g.district ?? undefined, state: g.state ?? undefined, pin: g.pin ?? undefined, source: "Gym Intelligence", product: "SaaS", priority: "Medium" });
  await db.$transaction(async (tx) => {
    await tx.giGym.update({ where: { id: gymId }, data: { leadId: lead.id, promotion: "PROMOTED" } });
    await tx.crmActivity.create({ data: { leadId: lead.id, actorId: u.id, type: "note", notes: noteText(g) } });
    await intelAudit(tx, u, `Gym ${gymId} promoted to CRM lead ${lead.id}`, { leadId: lead.id });
  });
  return { result: "CREATED", leadId: lead.id };
}

/** Assigns the unowned leads that came from Gym Intelligence in an area to one employee. A lead that already has an owner is never touched. */
export async function assignPromotedByArea(u: CrmUser, area: { state?: string; district?: string; city?: string }, toOwner: string) {
  need(u, "intel.manage");
  if (!area.state && !area.district && !area.city) throw new UserError("Choose a state, district or city.");
  const owner = await db.crmStaff.findFirst({ where: { userId: toOwner, status: "Active", role: { in: ["sales", "manager"] } } });
  if (!owner) throw new UserError("Choose an active sales employee or manager.");
  const leads = await db.crmLead.findMany({ where: { ownerId: null, gym: { isNot: null }, ...(area.state ? { state: area.state } : {}), ...(area.district ? { district: area.district } : {}), ...(area.city ? { city: { equals: area.city, mode: "insensitive" } } : {}) }, select: { id: true } });
  let n = 0;
  for (const l of leads) {
    // The ordinary assignment, one lead at a time: its checks, history and notifications all apply.
    const { assignLead } = await import("../crm-leads");
    await assignLead(u, l.id, toOwner);
    n++;
  }
  await intelAudit(db, u, `Assigned ${n} gym leads in ${[area.city, area.district, area.state].filter(Boolean).join(", ")} to an employee`);
  return { assigned: n };
}
