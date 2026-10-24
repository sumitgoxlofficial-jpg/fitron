import "server-only";
import type { CrmLead, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import {
  CALL_OUTCOMES, MIN_REJECT_REASON, PRIORITIES, PRODUCTS, TASK_TYPES, checkStageChange, isLocked, isOverdue, maskEmail, normalizePhone, showPhone,
  type StageChange,
} from "@/lib/domain/crm";
import { ADD_ON_LABEL, cleanAddons, dealValue, isBilling, isPlanKey, planOf, planText } from "@/lib/domain/crm-plans";
import { formatRupees } from "@/lib/format";
import { activeAdmins, CrmDenied, crmAudit, inScope, leadScope, mayVerify, need, noteDenied, notify, type CrmUser } from "./crm-access";
import { isUniqueViolation, UserError } from "./errors";
import { fromIso, todayIso } from "./time";

type Tx = Prisma.TransactionClient;

/** A lead as a given person is allowed to see it: the phone and email are masked unless their role may see them in full. The raw columns never leave the server for a role that can't see them. */
export type LeadView = Omit<CrmLead, "phone" | "altPhone" | "email"> & { phone: string; altPhone: string; email: string; ownerName: string | null; closedByName: string | null; verifiedByName: string | null; campaignName: string | null; locked: boolean };

const names = async (ids: (string | null)[]) => {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  const rows = list.length ? await db.user.findMany({ where: { id: { in: list } }, select: { id: true, name: true } }) : [];
  return new Map(rows.map((r) => [r.id, r.name]));
};

export async function viewLeads(u: CrmUser, leads: (CrmLead & { campaign?: { name: string } | null })[]): Promise<LeadView[]> {
  const nm = await names(leads.flatMap((l) => [l.ownerId, l.closedById, l.verifiedById]));
  const full = u.can("phone.full");
  return leads.map((l) => ({
    ...l,
    phone: showPhone(l.phone, full),
    altPhone: l.altPhone ? showPhone(l.altPhone, full) : "",
    email: l.email ? (full ? l.email : maskEmail(l.email)) : "",
    ownerName: l.ownerId ? (nm.get(l.ownerId) ?? null) : null,
    closedByName: l.closedById ? (nm.get(l.closedById) ?? null) : null,
    verifiedByName: l.verifiedById ? (nm.get(l.verifiedById) ?? null) : null,
    campaignName: l.campaign?.name ?? null,
    locked: isLocked(l, u.role),
  }));
}

// ── Reading ────────────────────────────────────────────────────────────────

export type LeadFilter = { q?: string; stage?: string; product?: string; ownerId?: string; campaignId?: string; verification?: string; page?: number; pageSize?: number };
export const PAGE_SIZE = 10;

/** The `where` for a list: the person's scope AND the filters, so a filter can never widen what they may see. */
export function leadWhere(u: CrmUser, f: LeadFilter): Prisma.CrmLeadWhereInput {
  const q = f.q?.trim();
  const digits = q?.replace(/\D/g, "") ?? "";
  const and: Prisma.CrmLeadWhereInput[] = [leadScope(u)];
  if (q) {
    const or: Prisma.CrmLeadWhereInput[] = [
      { gymName: { contains: q, mode: "insensitive" } },
      { contactName: { contains: q, mode: "insensitive" } },
      { id: { contains: q, mode: "insensitive" } },
      { city: { contains: q, mode: "insensitive" } },
    ];
    // Searching by number would let a role that sees numbers masked find out which number belongs to which lead.
    if (digits.length >= 4 && u.can("phone.full")) or.push({ phone: { contains: digits } });
    and.push({ OR: or });
  }
  if (f.stage) and.push({ stage: f.stage });
  if (f.product) and.push({ product: f.product });
  if (f.campaignId) and.push({ campaignId: f.campaignId });
  if (f.verification) and.push({ verification: f.verification });
  if (f.ownerId) and.push(f.ownerId === "none" ? { ownerId: null } : { ownerId: f.ownerId });
  return { AND: and };
}

export async function listLeads(u: CrmUser, f: LeadFilter) {
  const where = leadWhere(u, f);
  const size = f.pageSize ?? PAGE_SIZE;
  const [rows, total] = await Promise.all([
    db.crmLead.findMany({ where, include: { campaign: { select: { name: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: ((f.page ?? 1) - 1) * size, take: size }),
    db.crmLead.count({ where }),
  ]);
  return { leads: await viewLeads(u, rows), total, pageSize: size };
}

/** One lead, or null when it doesn't exist or is outside the person's scope: the two look the same on purpose. */
export async function getLead(u: CrmUser, id: string) {
  const l = await db.crmLead.findFirst({ where: { AND: [{ id }, leadScope(u)] }, include: { campaign: { select: { name: true } } } });
  return l;
}

/** For a page: the lead, and what to show beside it. A lead outside the scope is a refusal, which is written to the audit trail. */
export async function leadDetail(u: CrmUser, id: string) {
  const l = await getLead(u, id);
  if (!l) {
    const exists = await db.crmLead.count({ where: { id } });
    if (exists) await noteDenied(u, `opened a lead outside their scope`, id);
    return exists ? ("denied" as const) : null;
  }
  const [view] = await viewLeads(u, [l]);
  const [timeline, tasks, assignments] = await Promise.all([
    db.crmAudit.findMany({ where: { leadId: id }, orderBy: { id: "desc" }, take: 100 }),
    db.crmTask.findMany({ where: { leadId: id }, orderBy: [{ done: "asc" }, { dueAt: "asc" }] }),
    db.crmAssignment.findMany({ where: { leadId: id }, orderBy: { at: "desc" } }),
  ]);
  const nm = await names([...timeline.map((t) => t.actorId), ...assignments.flatMap((a) => [a.fromOwner, a.toOwner, a.actorId]), ...tasks.map((t) => t.ownerId)]);
  return {
    lead: view,
    timeline: timeline.map((t) => ({ id: String(t.id), kind: t.kind, text: t.text, at: t.at, actor: nm.get(t.actorId) ?? "—" })),
    tasks: tasks.map((t) => ({ ...t, ownerName: nm.get(t.ownerId) ?? "—", overdue: isOverdue(t) })),
    assignments: assignments.map((a) => ({ at: a.at, from: a.fromOwner ? (nm.get(a.fromOwner) ?? "—") : "Unassigned", to: a.toOwner ? (nm.get(a.toOwner) ?? "—") : "Unassigned", by: nm.get(a.actorId) ?? "—" })),
    activities: await db.crmActivity.findMany({ where: { leadId: id }, orderBy: { at: "desc" }, take: 50 }).then((rows) => rows.map((r) => ({ ...r, actor: nm.get(r.actorId) ?? "—" }))),
    canEdit: !view.locked,
  };
}

// ── Writing ────────────────────────────────────────────────────────────────

/** Loads a lead the person may change, or refuses (and records the refusal). */
async function mine(u: CrmUser, tx: Tx, id: string) {
  const l = await tx.crmLead.findUnique({ where: { id } });
  if (!l || !inScope(u, l)) {
    if (l) await noteDenied(u, "changed a lead outside their scope", id);
    throw new CrmDenied(l ? "You don't have access to this lead." : "Lead not found.");
  }
  return l;
}

/** Applies a change if the lead is still the version the person was looking at; bumps the version. */
async function change(tx: Tx, l: CrmLead, expected: number | undefined, data: Prisma.CrmLeadUncheckedUpdateManyInput) {
  const r = await tx.crmLead.updateMany({ where: { id: l.id, version: expected ?? l.version }, data: { ...data, version: { increment: 1 } } });
  if (r.count !== 1) throw new UserError("Someone else changed this lead while you were editing it. Reload and try again.");
}

const clean = (v: string | null | undefined, max: number) => (v ?? "").trim().slice(0, max);

export type NewLead = { contactName: string; gymName: string; phone: string; altPhone?: string; email?: string; city?: string; district?: string; state?: string; pin?: string; address?: string; product?: string; plan?: string; billing?: string; campaignId?: string; source?: string; estValue?: number; priority?: string };

/** Anyone in the CRM can add a lead. A salesperson's or manager's own lead is theirs to work; one from marketing or the Super Admin starts unassigned. */
export async function createLead(u: CrmUser, i: NewLead) {
  if (!i.contactName.trim()) throw new UserError("Enter the contact's name.", "contactName");
  if (!i.gymName.trim()) throw new UserError("Enter the gym's name.", "gymName");
  const phone = normalizePhone(i.phone);
  if (!phone) throw new UserError("Enter a valid 10-digit mobile number.", "phone");
  const alt = i.altPhone?.trim() ? normalizePhone(i.altPhone) : null;
  if (i.altPhone?.trim() && !alt) throw new UserError("The alternate number isn't a valid mobile number.", "altPhone");
  // The plan being pitched decides the product and the estimated value; without one, the product is chosen directly.
  const plan = i.plan && isPlanKey(i.plan) ? i.plan : null;
  const billing = isBilling(i.billing) ? i.billing : "MONTHLY";
  const product = plan ? planOf(plan).product : i.product;
  if (!product || !(PRODUCTS as readonly string[]).includes(product)) throw new UserError("Choose a plan or a product.", "plan");
  if (i.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.email.trim())) throw new UserError("That email address isn't valid.", "email");
  const priority = (PRIORITIES as readonly string[]).includes(i.priority ?? "") ? i.priority! : "Medium";
  const campaign = i.campaignId ? await db.crmCampaign.findUnique({ where: { id: i.campaignId } }) : null;
  if (i.campaignId && !campaign) throw new UserError("That campaign doesn't exist.", "campaignId");
  const owner = u.role === "sales" || u.role === "manager" ? u.id : null;
  try {
    return await db.$transaction(async (tx) => {
      const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('"CrmLeadSeq"') AS n`;
      const l = await tx.crmLead.create({
        data: {
          id: `FL-${n}`, contactName: clean(i.contactName, 120), gymName: clean(i.gymName, 160), phone, altPhone: alt, email: clean(i.email, 160) || null,
          city: clean(i.city, 80) || null, district: clean(i.district, 80) || null, state: clean(i.state, 80) || null, pin: clean(i.pin, 6).replace(/\D/g, "") || null, address: clean(i.address, 300) || null,
          campaignId: campaign?.id ?? null, source: campaign?.source ?? ((i.source ?? "").trim() || "Other"), product, priority, plan: plan ?? "starter", billing, estValue: plan ? dealValue({ plan, billing }) : Math.max(0, Math.round(i.estValue ?? 0)),
          ownerId: owner, assignedAt: owner ? new Date() : null, createdById: u.id,
        },
      });
      if (owner) await tx.crmAssignment.create({ data: { leadId: l.id, fromOwner: null, toOwner: owner, actorId: u.id } });
      await crmAudit(tx, { actorId: u.id, leadId: l.id, kind: "create", text: `Lead created · ${l.gymName} (${l.source})` });
      return l;
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const dup = await db.crmLead.findUnique({ where: { phone }, select: { id: true } });
      throw new UserError(`A lead with this phone number already exists${dup ? ` (${dup.id})` : ""}.`, "phone");
    }
    throw e;
  }
}

export type LeadEdit = { plan?: string; billing?: string; priority?: string; product?: string; contactName?: string; gymName?: string; city?: string; district?: string; state?: string; pin?: string; address?: string; phone?: string; altPhone?: string; email?: string; estValue?: number; campaignId?: string };

/** Edits the lead's details. The source, the creator and (for anyone but the Super Admin, once verified) the deal are never changed here. Contact numbers can only be changed by a role that sees them in full. */
export async function updateLead(u: CrmUser, id: string, e: LeadEdit, expectedVersion?: number) {
  await db.$transaction(async (tx) => {
    const l = await mine(u, tx, id);
    if (isLocked(l, u.role)) throw new UserError("This deal is verified, so it is locked. Only a Super Admin can correct it.");
    const data: Prisma.CrmLeadUncheckedUpdateManyInput = {};
    const notes: string[] = [];
    if (e.priority !== undefined && e.priority !== l.priority) {
      if (!(PRIORITIES as readonly string[]).includes(e.priority)) throw new UserError("Choose a priority.");
      data.priority = e.priority;
      notes.push(`Priority: ${l.priority} → ${e.priority}`);
    }
    if (e.product !== undefined && e.product !== l.product) {
      if (!(PRODUCTS as readonly string[]).includes(e.product)) throw new UserError("Choose a product.");
      data.product = e.product;
      notes.push(`Product: ${l.product} → ${e.product}`);
    }
    for (const k of ["contactName", "gymName", "city", "district", "state", "address"] as const) {
      if (e[k] !== undefined && clean(e[k], 300) !== (l[k] ?? "")) {
        const v = clean(e[k], k === "address" ? 300 : 160);
        if (k === "contactName" || k === "gymName") {
          if (!v) throw new UserError("That can't be empty.", k);
          data[k] = v;
        } else data[k] = v || null;
        notes.push(`${k === "gymName" ? "Gym name" : k === "contactName" ? "Contact name" : k[0]!.toUpperCase() + k.slice(1)} updated`);
      }
    }
    if (e.pin !== undefined) data.pin = clean(e.pin, 6).replace(/\D/g, "") || null;
    if ((e.plan !== undefined && e.plan !== l.plan) || (e.billing !== undefined && e.billing !== l.billing)) {
      const plan = e.plan ?? l.plan;
      const billing = e.billing ?? l.billing;
      if (!isPlanKey(plan)) throw new UserError("Choose a plan.", "plan");
      if (!isBilling(billing)) throw new UserError("Choose monthly or yearly billing.", "billing");
      if (l.verification === "Pending") throw new UserError("The plan is fixed while the deal waits for approval.");
      const value = dealValue({ plan, billing, addons: l.addons });
      data.plan = plan;
      data.billing = billing;
      data.product = planOf(plan).product;
      data.estValue = value;
      notes.push(`Plan: ${planText(l.plan, l.billing)} → ${planText(plan, billing)} (${formatRupees(value)})`);
    }
    if (e.estValue !== undefined && e.plan === undefined && Math.round(e.estValue) !== l.estValue) {
      if (l.verification === "Pending") throw new UserError("The deal value is fixed while it waits for approval.");
      data.estValue = Math.max(0, Math.round(e.estValue));
      notes.push("Estimated value updated");
    }
    if (e.campaignId !== undefined && (e.campaignId || null) !== l.campaignId) {
      // The lead's source stays as it was: attribution is copied once and never rewritten.
      if (e.campaignId && !(await tx.crmCampaign.findUnique({ where: { id: e.campaignId } }))) throw new UserError("That campaign doesn't exist.");
      data.campaignId = e.campaignId || null;
      notes.push("Campaign updated");
    }
    const touchesContact = e.phone !== undefined || e.altPhone !== undefined || e.email !== undefined;
    if (touchesContact) {
      need(u, "phone.full");
      if (e.phone !== undefined) {
        const p = normalizePhone(e.phone);
        if (!p) throw new UserError("Enter a valid 10-digit mobile number.", "phone");
        if (p !== l.phone) {
          data.phone = p;
          notes.push("Phone number updated");
        }
      }
      if (e.altPhone !== undefined) {
        const a = e.altPhone.trim() ? normalizePhone(e.altPhone) : null;
        if (e.altPhone.trim() && !a) throw new UserError("The alternate number isn't a valid mobile number.", "altPhone");
        if (a !== l.altPhone) {
          data.altPhone = a;
          notes.push("Alternate number updated");
        }
      }
      if (e.email !== undefined) {
        const m = e.email.trim();
        if (m && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m)) throw new UserError("That email address isn't valid.", "email");
        if ((m || null) !== l.email) {
          data.email = m || null;
          notes.push("Email updated");
        }
      }
    }
    if (!notes.length) return;
    try {
      await change(tx, l, expectedVersion, data);
    } catch (err) {
      if (isUniqueViolation(err)) throw new UserError("Another lead already has this phone number.", "phone");
      throw err;
    }
    await crmAudit(tx, { actorId: u.id, leadId: id, kind: "stage", text: notes.join(" · ") });
  });
}

/** Everyone a lead may be given to: active salespeople and managers (and the Super Admin). A manager may only choose their own team. */
export async function assignees(u: CrmUser) {
  const staff = await db.crmStaff.findMany({ where: { status: "Active", role: { in: ["sales", "manager", "admin"] } }, include: { user: { select: { name: true } } }, orderBy: { empId: "asc" } });
  return staff.filter((s) => u.can("leads.all") || u.role === "marketing" || u.role === "admin" || u.teamIds.includes(s.userId)).map((s) => ({ id: s.userId, name: s.user.name, role: s.role, empId: s.empId }));
}

export async function assignLead(u: CrmUser, id: string, toOwner: string | null, expectedVersion?: number) {
  need(u, "leads.assign");
  await db.$transaction(async (tx) => {
    const l = await mine(u, tx, id);
    if (l.verification === "Verified" && u.role !== "admin") throw new UserError("This deal is verified, so its owner is locked.");
    if (l.ownerId === toOwner) return;
    if (toOwner) {
      const t = await tx.crmStaff.findFirst({ where: { userId: toOwner, status: "Active", role: { in: ["sales", "manager", "admin"] } } });
      if (!t) throw new UserError("Choose an active salesperson or manager.");
      // A manager can only hand leads to people on their own team.
      if (u.role === "manager" && !u.teamIds.includes(toOwner)) throw new CrmDenied("You can only assign leads to your own team.");
    } else if (u.role === "manager" && l.ownerId && !u.teamIds.includes(l.ownerId)) {
      throw new CrmDenied("You can only change your own team's leads.");
    }
    await change(tx, l, expectedVersion, { ownerId: toOwner, assignedAt: toOwner ? new Date() : null });
    await tx.crmAssignment.create({ data: { leadId: id, fromOwner: l.ownerId, toOwner, actorId: u.id } });
    // The open tasks follow the lead to its new owner.
    if (toOwner) await tx.crmTask.updateMany({ where: { leadId: id, done: false }, data: { ownerId: toOwner } });
    const nm = await names([l.ownerId, toOwner]);
    await crmAudit(tx, { actorId: u.id, leadId: id, kind: "assign", text: `Reassigned: ${l.ownerId ? nm.get(l.ownerId) : "Unassigned"} → ${toOwner ? nm.get(toOwner) : "Unassigned"}`, meta: { from: l.ownerId, to: toOwner } });
    await notify(tx, [toOwner], `New lead assigned: ${l.gymName} (${l.id})`, id, u.id);
    await notify(tx, [l.ownerId], `${l.gymName} (${l.id}) was reassigned${toOwner ? ` to ${nm.get(toOwner)}` : ""}`, id, u.id);
  });
}

// ── Stage changes, deals and verification ─────────────────────────────────

export async function changeStage(u: CrmUser, id: string, change0: StageChange, expectedVersion?: number) {
  let c = change0;
  need(u, "activity.log");
  if (c.to === "Closed Won") need(u, "deal.submit");
  await db.$transaction(async (tx) => {
    const l = await mine(u, tx, id);
    // What a Closed Won deal is worth comes from the plan and add-ons chosen, worked out here.
    let sold: { plan: string; billing: string; addons: string[]; value: number } | null = null;
    if (c.to === "Closed Won") {
      if (!isPlanKey(c.plan)) throw new UserError("Choose the plan that was sold.", "plan");
      if (!isBilling(c.billing)) throw new UserError("Choose monthly or yearly billing.", "billing");
      const addons = cleanAddons(c.addons);
      sold = { plan: c.plan, billing: c.billing, addons, value: dealValue({ plan: c.plan, billing: c.billing, addons }) };
      c = { ...c, value: sold.value };
    }
    const chk = checkStageChange(l, c, u.role, todayIso());
    if (!chk.ok) throw new UserError(chk.error, chk.field);
    const data: Prisma.CrmLeadUncheckedUpdateManyInput = { stage: c.to };
    const wasVerified = l.verification === "Verified";
    if (c.to === "Closed Won" && sold) {
      Object.assign(data, { verification: "Pending", proofType: c.proofType, proofRef: c.proofRef!.trim(), estValue: sold.value, plan: sold.plan, billing: sold.billing, addons: sold.addons, product: planOf(sold.plan).product, closedDate: fromIso(c.closedDate!), closedById: u.id, lossReason: null, rejectReason: null, verifiedById: null, verifiedAt: null });
    } else {
      // Leaving Closed Won takes the submission back (or, for a Super Admin, corrects an approved deal).
      if (l.stage === "Closed Won") Object.assign(data, { verification: null, proofType: null, proofRef: null, closedDate: null, closedById: null, verifiedById: null, verifiedAt: null });
      if (c.to === "Closed Lost" || c.to === "Disqualified") Object.assign(data, { lossReason: c.lossReason, rejectReason: null });
      else data.lossReason = null;
    }
    if (c.to === "Demo Completed") data.demoDone = true;
    await change(tx, l, expectedVersion, data);
    const base = `Stage: ${l.stage} → ${c.to}`;
    await crmAudit(tx, {
      actorId: u.id, leadId: id, kind: "stage", meta: { from: l.stage, to: c.to },
      text: wasVerified ? `Correction by Super Admin · ${base}` : c.to === "Closed Won" && sold ? `${base} (pending verification) · ${planText(sold.plan, sold.billing)}${sold.addons.length ? ` + ${sold.addons.map((a) => ADD_ON_LABEL[a as keyof typeof ADD_ON_LABEL]).join(", ")}` : ""} · ${formatRupees(sold.value)} · ${c.proofType}: ${c.proofRef!.trim()}` : c.to === "Closed Lost" || c.to === "Disqualified" ? `${base} · ${c.lossReason}` : chk.withdraws ? `${base} · submission withdrawn` : base,
    });
    if (c.to === "Closed Won") {
      const mgr = l.ownerId ? await tx.crmStaff.findUnique({ where: { userId: l.ownerId }, select: { managerId: true } }) : await tx.crmStaff.findUnique({ where: { userId: u.id }, select: { managerId: true } });
      await notify(tx, [mgr?.managerId, ...(await activeAdmins(tx))], `Deal waiting for approval: ${l.gymName} (${l.id})`, id, u.id);
    }
  });
}

export async function approveDeal(u: CrmUser, id: string) {
  need(u, "deal.verify");
  await db.$transaction(async (tx) => {
    const l = await mine(u, tx, id);
    if (l.verification !== "Pending") throw new UserError("This deal isn't waiting for approval.");
    if (!mayVerify(u, l)) {
      await noteDenied(u, "approved a deal they may not approve", id);
      throw new CrmDenied(l.closedById === u.id ? "You can't approve a deal you closed yourself. Ask a Super Admin." : "You can only approve your own team's deals.");
    }
    await change(tx, l, undefined, { verification: "Verified", verifiedById: u.id, verifiedAt: new Date(), rejectReason: null });
    await crmAudit(tx, { actorId: u.id, leadId: id, kind: "verify", text: "Deal verified · counted toward revenue" });
    await notify(tx, [l.closedById], `Your deal was verified: ${l.gymName} (${l.id})`, id, u.id);
  });
}

export async function rejectDeal(u: CrmUser, id: string, reason: string) {
  need(u, "deal.verify");
  const why = reason.trim();
  if (why.length < MIN_REJECT_REASON) throw new UserError(`Give a reason of at least ${MIN_REJECT_REASON} characters.`, "reason");
  await db.$transaction(async (tx) => {
    const l = await mine(u, tx, id);
    if (l.verification !== "Pending") throw new UserError("This deal isn't waiting for approval.");
    if (!mayVerify(u, l)) {
      await noteDenied(u, "rejected a deal they may not decide", id);
      throw new CrmDenied(l.closedById === u.id ? "You can't decide a deal you closed yourself. Ask a Super Admin." : "You can only decide your own team's deals.");
    }
    await change(tx, l, undefined, { verification: "Rejected", verifiedById: u.id, rejectReason: why.slice(0, 300), stage: "Negotiation" });
    await crmAudit(tx, { actorId: u.id, leadId: id, kind: "verify", text: `Deal rejected · ${why.slice(0, 200)}` });
    await notify(tx, [l.closedById], `Your deal was rejected: ${l.gymName} (${l.id}) — ${why.slice(0, 120)}`, id, u.id);
  });
}

/** Deals waiting for a decision that this person may decide, newest first, and the last few decisions. */
export async function verificationQueue(u: CrmUser) {
  need(u, "deal.verify");
  const scoped: Prisma.CrmLeadWhereInput = u.role === "admin" ? {} : { OR: [{ ownerId: { in: u.teamIds } }, { closedById: { in: u.teamIds } }], NOT: { closedById: u.id } };
  const [pending, decided] = await Promise.all([
    db.crmLead.findMany({ where: { AND: [scoped, { verification: "Pending" }] }, include: { campaign: { select: { name: true } } }, orderBy: { updatedAt: "desc" } }),
    db.crmAudit.findMany({ where: { kind: "verify" }, orderBy: { id: "desc" }, take: 8 }),
  ]);
  const nm = await names(decided.map((d) => d.actorId));
  return { pending: await viewLeads(u, pending), decisions: decided.map((d) => ({ id: String(d.id), text: d.text, at: d.at, by: nm.get(d.actorId) ?? "—", leadId: d.leadId })) };
}

// ── Calls, notes and tasks ─────────────────────────────────────────────────

export type CallInput = { outcome: string; notes?: string; objection?: string; nextAction?: string; followUpAt?: Date | null; taskType?: string };

/** Logs a call. There is no calling integration, so nothing here is measured: the person says how it went. A "Connected" call on a New Lead moves it to Contacted. A follow-up must be in the future and becomes a task. */
export async function logCall(u: CrmUser, id: string, c: CallInput) {
  need(u, "activity.log");
  if (!(CALL_OUTCOMES as readonly string[]).includes(c.outcome)) throw new UserError("Choose how the call went.", "outcome");
  if (c.followUpAt && c.followUpAt.getTime() <= Date.now()) throw new UserError("The follow-up must be in the future.", "followUpAt");
  await db.$transaction(async (tx) => {
    const l = await mine(u, tx, id);
    const now = new Date();
    await tx.crmActivity.create({ data: { leadId: id, actorId: u.id, type: "call", outcome: c.outcome, notes: clean(c.notes, 1000) || null, objection: clean(c.objection, 300) || null, nextAction: clean(c.nextAction, 300) || null, at: now } });
    const data: Prisma.CrmLeadUncheckedUpdateManyInput = { lastContactAt: now };
    let moved = false;
    if (c.outcome === "Connected" && l.stage === "New Lead") {
      data.stage = "Contacted";
      moved = true;
    }
    await change(tx, l, undefined, data);
    await crmAudit(tx, { actorId: u.id, leadId: id, kind: "call", text: `Call logged · ${c.outcome}${c.notes?.trim() ? ` — ${clean(c.notes, 140)}` : ""}` });
    if (moved) await crmAudit(tx, { actorId: u.id, leadId: id, kind: "stage", text: "Stage: New Lead → Contacted", meta: { from: "New Lead", to: "Contacted" } });
    if (c.followUpAt) {
      const type = (TASK_TYPES as readonly string[]).includes(c.taskType ?? "") ? c.taskType! : "Follow-up";
      await tx.crmTask.create({ data: { leadId: id, ownerId: l.ownerId ?? u.id, type, dueAt: c.followUpAt, priority: l.priority } });
      await crmAudit(tx, { actorId: u.id, leadId: id, kind: "task", text: `${type} scheduled` });
    }
  });
}

export async function addNote(u: CrmUser, id: string, text: string) {
  need(u, "activity.log");
  const t = clean(text, 1000);
  if (!t) throw new UserError("Write a note first.", "notes");
  await db.$transaction(async (tx) => {
    await mine(u, tx, id);
    await tx.crmActivity.create({ data: { leadId: id, actorId: u.id, type: "note", notes: t } });
    await crmAudit(tx, { actorId: u.id, leadId: id, kind: "call", text: `Note added — ${t.slice(0, 140)}` });
  });
}

export async function addTask(u: CrmUser, id: string, t: { type: string; dueAt: Date; priority?: string }) {
  need(u, "activity.log");
  if (!(TASK_TYPES as readonly string[]).includes(t.type)) throw new UserError("Choose a task type.", "type");
  if (t.dueAt.getTime() <= Date.now()) throw new UserError("The due time must be in the future.", "dueAt");
  await db.$transaction(async (tx) => {
    const l = await mine(u, tx, id);
    await tx.crmTask.create({ data: { leadId: id, ownerId: l.ownerId ?? u.id, type: t.type, dueAt: t.dueAt, priority: (PRIORITIES as readonly string[]).includes(t.priority ?? "") ? t.priority! : l.priority } });
    await crmAudit(tx, { actorId: u.id, leadId: id, kind: "task", text: `${t.type} scheduled` });
  });
}

export async function completeTask(u: CrmUser, taskId: string) {
  need(u, "activity.log");
  await db.$transaction(async (tx) => {
    const t = await tx.crmTask.findUnique({ where: { id: taskId }, include: { lead: true } });
    if (!t || !inScope(u, t.lead) || (u.role === "sales" && t.ownerId !== u.id)) {
      if (t) await noteDenied(u, "completed a task that isn't theirs", t.leadId);
      throw new CrmDenied(t ? "You don't have access to this task." : "Task not found.");
    }
    if (t.done) return;
    await tx.crmTask.update({ where: { id: taskId }, data: { done: true, doneAt: new Date() } });
    await crmAudit(tx, { actorId: u.id, leadId: t.leadId, kind: "task", text: `${t.type} done` });
  });
}

/** Tasks for the Tasks page, in the groups it shows. Salespeople only ever see their own; "team" is for managers and admins. */
export async function listTasks(u: CrmUser, scope: "mine" | "team") {
  const where: Prisma.CrmTaskWhereInput = scope === "team" && u.role !== "sales" ? { lead: leadScope(u) } : { ownerId: u.id, lead: leadScope(u) };
  const rows = await db.crmTask.findMany({ where, include: { lead: { select: { gymName: true, contactName: true, id: true } } }, orderBy: { dueAt: "asc" }, take: 300 });
  const nm = await names(rows.map((r) => r.ownerId));
  return rows.map((r) => ({ ...r, ownerName: nm.get(r.ownerId) ?? "—", overdue: isOverdue(r) }));
}

// ── Bulk changes from the leads list ───────────────────────────────────────

export type BulkOp = { kind: "owner"; ownerId: string | null } | { kind: "priority"; value: string } | { kind: "stage"; to: string };
export const MAX_BULK = 100;

/** Applies one change to many leads, each through the same checks as a single change: what a person may not do is refused lead by lead, and the rest still go through. */
export async function bulkUpdate(u: CrmUser, ids: string[], op: BulkOp) {
  const list = [...new Set(ids)].slice(0, MAX_BULK);
  if (!list.length) throw new UserError("Select some leads first.");
  if (op.kind === "owner") need(u, "leads.assign");
  if (op.kind === "stage") {
    need(u, "activity.log");
    // Closing needs a reason or proof, which only the lead's own page can ask for.
    if (["Closed Won", "Closed Lost", "Disqualified"].includes(op.to)) throw new UserError("Closing a lead needs its details: open the lead.");
  }
  let done = 0;
  const failed: { id: string; reason: string }[] = [];
  for (const id of list) {
    try {
      if (op.kind === "owner") await assignLead(u, id, op.ownerId);
      else if (op.kind === "priority") await updateLead(u, id, { priority: op.value });
      else await changeStage(u, id, { to: op.to as StageChange["to"] });
      done += 1;
    } catch (e) {
      if (e instanceof UserError) failed.push({ id, reason: e.message });
      else throw e;
    }
  }
  return { done, failed };
}
