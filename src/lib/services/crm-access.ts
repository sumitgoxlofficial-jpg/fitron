import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { crmCan, isCrmRole, type CrmPermission, type CrmRole } from "@/lib/domain/crm";
import { needsSetup, type Profile } from "@/lib/domain/crm-pay";
import { UserError } from "./errors";

type Tx = Prisma.TransactionClient;

/**
 * Who is using the CRM, and everything the services need to decide what they may see and do. Built on the server from the
 * database, never from anything the browser sends.
 */
export type CrmUser = {
  id: string;
  name: string;
  email: string;
  empId: string;
  role: CrmRole;
  managerId: string | null;
  /** This person plus, for a manager, everyone who reports to them. */
  teamIds: string[];
  /** The day they joined (India date): the first 30 days earn the first-month commission. */
  joinedAt: string;
  /** Incentive percentage after the first month, and the monthly salary in paise (null = not set). */
  incentive: number;
  salary: number | null;
  /** Until the profile, a payout account and the accepted terms are in, they can only open their profile. */
  setupNeeded: boolean;
  /** The profile photo's address (changes when a new one is uploaded), or null. */
  photo: string | null;
  can: (p: CrmPermission) => boolean;
};

/** A request for something the person's role doesn't allow. Shown as "Access denied" and written to the audit trail. */
export class CrmDenied extends UserError {}

export const TEAM_ORG_NAME = "FITRON Team";
export const TEAM_ROLE_NAME = "CRM Staff";

type StaffRow = { userId: string; empId: string; role: string; managerId: string | null; joinedAt: Date; incentive: number; salary: number | null; profile: unknown; payout: Uint8Array | null; termsVersion: string | null; termsAcceptedAt: Date | null; user: { name: string; email: string; photoKey?: string | null } };

export const crmUserOf = (s: StaffRow, reports: string[]): CrmUser => {
  const role: CrmRole = isCrmRole(s.role) ? s.role : "sales";
  return {
    id: s.userId,
    name: s.user.name,
    email: s.user.email,
    empId: s.empId,
    role,
    managerId: s.managerId,
    teamIds: role === "manager" ? [s.userId, ...reports] : [s.userId],
    joinedAt: s.joinedAt.toISOString().slice(0, 10),
    incentive: s.incentive,
    salary: s.salary,
    photo: s.user.photoKey ? `/api/crm/photo/${s.userId}?v=${s.user.photoKey.split("/").pop()?.split(".")[0] ?? ""}` : null,
    setupNeeded: role !== "admin" && needsSetup(s, s.profile as Partial<Profile> | null, !!s.payout), // the Super Admin earns no commission, so has no payout or terms to set up
    can: (p) => crmCan(role, p),
  };
};

/** Loads an active employee as a CrmUser, or null if they aren't one. */
export async function loadCrmUser(userId: string): Promise<CrmUser | null> {
  const s = await db.crmStaff.findFirst({
    where: { userId, status: "Active", user: { active: true, deletedAt: null } },
    include: { user: { select: { name: true, email: true, photoKey: true } } },
  });
  if (!s) return null;
  const reports = s.role === "manager" ? (await db.crmStaff.findMany({ where: { managerId: userId, status: "Active" }, select: { userId: true } })).map((r) => r.userId) : [];
  return crmUserOf(s, reports);
}

/** The next FIT-EMP-0001. */
export async function nextEmpId(tx: Tx | typeof db = db) {
  const last = await tx.crmStaff.findFirst({ orderBy: { empId: "desc" }, select: { empId: true } });
  const n = last ? Number(last.empId.replace(/\D/g, "")) : 0;
  return `FIT-EMP-${String(n + 1).padStart(4, "0")}`;
}

/** The internal organisation employees' sign-in accounts live in, created on first use. It counts as a demo organisation so FITRON admin's gym and user totals leave it out. */
export async function teamOrg() {
  const found = await db.organization.findFirst({ where: { name: TEAM_ORG_NAME, demo: true }, select: { id: true } });
  if (found) return found.id;
  return (await db.organization.create({ data: { name: TEAM_ORG_NAME, demo: true, plan: "starter" }, select: { id: true } })).id;
}

export async function teamRoleId() {
  return (await db.role.upsert({ where: { name: TEAM_ROLE_NAME }, create: { name: TEAM_ROLE_NAME }, update: {} })).id;
}

// ── What a person may see ──────────────────────────────────────────────────

/** The leads this person may open: everyone's for the Super Admin and Marketing Head; a manager's team's and the unassigned; a salesperson's own. */
export function leadScope(u: CrmUser): Prisma.CrmLeadWhereInput {
  if (u.can("leads.all")) return {};
  if (u.can("leads.team")) return { OR: [{ ownerId: { in: u.teamIds } }, { ownerId: null }] };
  return { ownerId: u.id };
}

export function inScope(u: CrmUser, l: { ownerId: string | null }) {
  if (u.can("leads.all")) return true;
  if (u.can("leads.team")) return l.ownerId === null || u.teamIds.includes(l.ownerId);
  return l.ownerId === u.id;
}

/** Whether this person is the Super Admin, or the closer's or owner's manager, for approving a deal. */
export const mayVerify = (u: CrmUser, l: { ownerId: string | null; closedById: string | null }) => {
  if (!u.can("deal.verify")) return false;
  if (u.role === "admin") return true;
  // A manager approves their own team's deals, never one they closed themselves.
  if (l.closedById === u.id) return false;
  return (l.ownerId !== null && u.teamIds.includes(l.ownerId)) || (l.closedById !== null && u.teamIds.includes(l.closedById));
};

export function need(u: CrmUser, p: CrmPermission) {
  if (!u.can(p)) throw new CrmDenied("Your role can't do this.");
}

// ── Audit and notifications ────────────────────────────────────────────────

/** Phone numbers and email addresses never go in the audit trail; if one slips into a message it is removed. */
export const scrub = (s: string) => s.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[email removed]").replace(/(?:\+?\d[\s-]?){10,}/g, "[number removed]");

export async function crmAudit(tx: Tx | typeof db, a: { actorId: string; leadId?: string | null; kind: "create" | "assign" | "stage" | "call" | "task" | "verify" | "export" | "import" | "user" | "denied" | "intel"; text: string; meta?: Prisma.InputJsonValue }) {
  await tx.crmAudit.create({ data: { actorId: a.actorId, leadId: a.leadId ?? null, kind: a.kind, text: scrub(a.text).slice(0, 400), meta: a.meta } });
}

export async function notify(tx: Tx, to: (string | null | undefined)[], text: string, leadId?: string | null, except?: string) {
  const ids = [...new Set(to.filter((x): x is string => !!x && x !== except))];
  if (!ids.length) return;
  await tx.crmNotification.createMany({ data: ids.map((userId) => ({ userId, text: scrub(text).slice(0, 300), leadId: leadId ?? null })) });
}

export const activeAdmins = async (tx: Tx | typeof db = db) => (await tx.crmStaff.findMany({ where: { role: "admin", status: "Active" }, select: { userId: true } })).map((a) => a.userId);

/** Records a refused request (an out-of-scope lead, an action the role lacks) without anything personal in it. */
export async function noteDenied(u: CrmUser, what: string, leadId?: string | null) {
  await crmAudit(db, { actorId: u.id, leadId, kind: "denied", text: `Refused: ${what}` });
}
