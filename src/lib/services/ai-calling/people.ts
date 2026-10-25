import "server-only";
import { db } from "@/lib/db";
import { CONSENT_BASES, type ConsentBasis } from "@/lib/domain/ai-calling/constants";
import { need, type CrmUser } from "../crm-access";
import { UserError } from "../errors";
import { AI_ACTOR, callAudit } from "./core";

const phone10 = /^[6-9]\d{9}$/;

/** Adds a number to the do-not-call list. It stays there; removing one is a separate, audited step. Also blocks the same number in Gym Intelligence. */
export async function addSuppression(phone: string, reason: string, source: "call" | "admin", actorId: string, callId?: string) {
  const p = phone.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
  if (!phone10.test(p)) throw new UserError("Enter a 10-digit mobile number.", "phone");
  await db.$transaction(async (tx) => {
    await tx.acSuppression.upsert({ where: { phoneNorm: p }, create: { phoneNorm: p, reason: reason.slice(0, 200), source, callId }, update: {} });
    await tx.giSuppression.upsert({ where: { phoneNorm: `+91${p}` }, create: { phoneNorm: `+91${p}`, reason: `AI calling: ${reason}`.slice(0, 200), addedById: actorId }, update: {} });
    await tx.acCall.updateMany({ where: { phone: p, status: "QUEUED" }, data: { status: "CANCELLED", error: "Opted out" } });
    await callAudit(tx, actorId, `Number added to the do-not-call list (${source})`, { source });
  });
}

export async function addSuppressionByAdmin(u: CrmUser, phone: string, reason: string) {
  need(u, "calling.manage");
  if (reason.trim().length < 3) throw new UserError("Say why.", "reason");
  await addSuppression(phone, reason.trim(), "admin", u.id);
}

export async function removeSuppression(u: CrmUser, phone: string, reason: string) {
  need(u, "calling.manage");
  if (reason.trim().length < 10) throw new UserError("Removing a number from the do-not-call list needs a reason of at least 10 characters (for example, that the owner asked in writing to be called).", "reason");
  await db.$transaction(async (tx) => {
    const r = await tx.acSuppression.deleteMany({ where: { phoneNorm: phone } });
    if (!r.count) throw new UserError("That number isn't on the list.");
    await callAudit(tx, u.id, `Number removed from the do-not-call list · ${reason.trim().slice(0, 150)}`);
  });
}

export async function listSuppressions(u: CrmUser) {
  need(u, "calling.view");
  const rows = await db.acSuppression.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
  return rows.map((r) => ({ ...r, masked: `${r.phoneNorm.slice(0, 2)}••••••${r.phoneNorm.slice(-2)}` }));
}

/** Records why a lead's number may be called with a sales message. Needs the person to say what the basis is; a public listing isn't one. */
export async function recordConsent(u: CrmUser, leadIds: string[], basis: string, note: string) {
  need(u, "calling.manage");
  if (!(CONSENT_BASES as readonly string[]).includes(basis) || basis === "TEST") throw new UserError("Choose the basis.", "basis");
  if (note.trim().length < 8) throw new UserError("Say where the permission came from (for example, the enquiry form date, or the customer record).", "note");
  const leads = await db.crmLead.findMany({ where: { id: { in: leadIds.slice(0, 500) } }, select: { id: true, phone: true } });
  if (!leads.length) throw new UserError("Choose at least one lead.");
  await db.$transaction(async (tx) => {
    for (const l of leads) await tx.acConsent.upsert({ where: { phoneNorm: l.phone }, create: { phoneNorm: l.phone, basis, note: note.trim().slice(0, 300), recordedById: u.id }, update: { basis: basis as ConsentBasis, note: note.trim().slice(0, 300), recordedById: u.id } });
    await callAudit(tx, u.id, `Calling permission recorded for ${leads.length} lead${leads.length === 1 ? "" : "s"} · ${basis}`, { basis, count: leads.length });
  });
  return leads.length;
}

/** The numbers allowed in test mode need a TEST record so the rest of the system treats them like any other. */
export const ensureTestConsent = (phone: string) => db.acConsent.upsert({ where: { phoneNorm: phone }, create: { phoneNorm: phone, basis: "TEST", recordedById: AI_ACTOR }, update: {} });
