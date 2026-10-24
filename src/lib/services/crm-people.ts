import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { isFitronAdmin } from "@/lib/integrations/fitron-team";
import { sendEmail } from "@/lib/integrations/email";
import { FIRST_DAYS, INCENTIVE_MAX, firstMonthEnds, needsSetup, payToText, type Profile } from "@/lib/domain/crm-pay";
import { openPayout } from "./crm-profile";
import { CRM_ROLE_LABEL, SOURCES, isCrmRole, type CrmRole } from "@/lib/domain/crm";
import { crmAudit, loadCrmUser, need, nextEmpId, teamOrg, teamRoleId, type CrmUser } from "./crm-access";
import { appUrl } from "./accounts";
import { isUniqueViolation, UserError } from "./errors";

// Employees, campaigns, notifications and the audit trail. Employees are ordinary sign-in accounts (src/lib/services/accounts.ts)
// in the internal FITRON Team organisation; CrmStaff adds the CRM role, manager and target.

/** The CRM user for a signed-in account, or null if they aren't an employee. A person on the FITRON team (FITRON_ADMIN_EMAILS) with no CRM record yet becomes its first Super Admin. */
export async function crmUserFor(userId: string, email: string): Promise<CrmUser | null> {
  const u = await loadCrmUser(userId);
  if (u) return u;
  if (!isFitronAdmin(email)) return null;
  const exists = await db.crmStaff.findUnique({ where: { userId }, select: { status: true } });
  if (exists) return null; // deactivated: not reinstated just because they are on the list
  try {
    await db.crmStaff.create({ data: { userId, empId: await nextEmpId(), role: "admin" } });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e; // two first visits at once: the other one made the record
  }
  return loadCrmUser(userId);
}

export async function listEmployees(u: CrmUser) {
  need(u, "employees.manage");
  const rows = await db.crmStaff.findMany({ include: { user: { select: { name: true, email: true, lastLoginAt: true, phone: true, photoKey: true } }, manager: { include: { user: { select: { name: true } } } } }, orderBy: { empId: "asc" } });
  return rows.map((r) => ({
    userId: r.userId, empId: r.empId, name: r.user.name, email: r.user.email, role: r.role as CrmRole, status: r.status, managerId: r.managerId, managerName: r.manager?.user.name ?? null, monthlyTarget: r.monthlyTarget, lastLoginAt: r.user.lastLoginAt,
    joinedAt: r.joinedAt.toISOString().slice(0, 10), salary: r.salary, incentive: r.incentive, inFirstMonth: Date.now() < new Date(`${r.joinedAt.toISOString().slice(0, 10)}T00:00:00+05:30`).getTime() + FIRST_DAYS * 86_400_000, firstMonthEnds: firstMonthEnds(r.joinedAt.toISOString().slice(0, 10)),
    profileComplete: !needsSetup(r, r.profile as Partial<Profile> | null, !!r.payout), termsAcceptedAt: r.termsAcceptedAt, hasPhoto: !!r.user.photoKey,
    account: r.payout ? payToText(openPayout(r.payout)) : "No payout account", hasAccount: !!r.payout,
  }));
}

/** People a lead can be handed to, and managers to report to: for forms. */
export async function managers() {
  return (await db.crmStaff.findMany({ where: { role: "manager", status: "Active" }, include: { user: { select: { name: true } } }, orderBy: { empId: "asc" } })).map((m) => ({ id: m.userId, name: m.user.name }));
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function inviteEmployee(u: CrmUser, i: { name: string; email: string; role: string; managerId?: string; target?: number }) {
  need(u, "employees.manage");
  const name = i.name.trim();
  const email = i.email.trim().toLowerCase();
  if (name.length < 2) throw new UserError("Enter the employee's name.", "name");
  if (!EMAIL.test(email)) throw new UserError("Enter a valid email address.", "email");
  if (!isCrmRole(i.role)) throw new UserError("Choose a role.", "role");
  if (i.managerId) {
    const m = await db.crmStaff.findFirst({ where: { userId: i.managerId, role: "manager", status: "Active" } });
    if (!m) throw new UserError("Choose an active Sales Manager.", "managerId");
  }
  const [orgId, roleId, passwordHash] = await Promise.all([teamOrg(), teamRoleId(), hashPassword(randomBytes(24).toString("base64url"))]);
  try {
    const staff = await db.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { orgId, name, email, phone: "", passwordHash, roleId } });
      const s = await tx.crmStaff.create({ data: { userId: user.id, empId: await nextEmpId(tx), status: "Invited", role: i.role, managerId: i.role === "sales" ? i.managerId || null : null, monthlyTarget: Math.max(0, Math.round((i.target ?? 0) * 100)) } });
      await crmAudit(tx, { actorId: u.id, kind: "user", text: `Invited ${name} (${s.empId}) as ${CRM_ROLE_LABEL[i.role as CrmRole]}`, meta: { userId: user.id } });
      return s;
    });
    await sendEmail({
      to: email,
      subject: "Your FITRON CRM account",
      text: `Hi ${name},\n\nYou've been added to the FITRON sales CRM as ${CRM_ROLE_LABEL[i.role as CrmRole]}. Your employee ID is ${staff.empId}.\n\nCreate your account: open ${appUrl()}/employee-login, choose Create account and use this email address (${email}). Then sign in with it or your employee ID.\n\nFITRON`,
    }).catch(() => undefined);
    return staff;
  } catch (e) {
    if (isUniqueViolation(e)) throw new UserError("Someone already has this email address.", "email");
    throw e;
  }
}

/** Another active Super Admin must remain: the last one can't be deactivated or demoted. */
async function keepAnAdmin(exceptUserId: string) {
  const others = await db.crmStaff.count({ where: { role: "admin", status: "Active", userId: { not: exceptUserId } } });
  if (!others) throw new UserError("There must be at least one active Super Admin.");
}

export async function updateEmployee(u: CrmUser, userId: string, p: { role?: string; managerId?: string | null; target?: number; active?: boolean; salary?: number | null; incentive?: number }) {
  need(u, "employees.manage");
  const s = await db.crmStaff.findUnique({ where: { userId }, include: { user: { select: { name: true } } } });
  if (!s) throw new UserError("Employee not found.");
  const data: { role?: string; managerId?: string | null; monthlyTarget?: number; status?: string; salary?: number | null; incentive?: number } = {};
  const notes: string[] = [];
  if (p.active !== undefined && (p.active ? "Active" : "Inactive") !== s.status) {
    if (!p.active) {
      if (userId === u.id) throw new UserError("You can't deactivate yourself.");
      if (s.role === "admin") await keepAnAdmin(userId);
    }
    data.status = p.active ? "Active" : "Inactive";
    notes.push(p.active ? "reactivated" : "deactivated");
  }
  if (p.role !== undefined && p.role !== s.role) {
    if (!isCrmRole(p.role)) throw new UserError("Choose a role.");
    if (userId === u.id) throw new UserError("You can't change your own role.");
    if (s.role === "admin") await keepAnAdmin(userId);
    data.role = p.role;
    if (p.role !== "sales") data.managerId = null;
    notes.push(`role ${CRM_ROLE_LABEL[s.role as CrmRole]} → ${CRM_ROLE_LABEL[p.role]}`);
  }
  if (p.managerId !== undefined && (data.role ?? s.role) === "sales" && (p.managerId || null) !== s.managerId) {
    if (p.managerId && !(await db.crmStaff.findFirst({ where: { userId: p.managerId, role: "manager", status: "Active" } }))) throw new UserError("Choose an active Sales Manager.");
    data.managerId = p.managerId || null;
    notes.push("manager changed");
  }
  if (p.target !== undefined && Math.round(p.target * 100) !== s.monthlyTarget) {
    data.monthlyTarget = Math.max(0, Math.round(p.target * 100));
    notes.push("monthly target changed");
  }
  if (p.salary !== undefined) {
    const paise = p.salary === null || Number.isNaN(p.salary) ? null : Math.max(0, Math.round(p.salary * 100));
    if (paise !== s.salary) {
      data.salary = paise;
      notes.push("monthly salary changed");
    }
  }
  if (p.incentive !== undefined) {
    if (!Number.isFinite(p.incentive) || p.incentive < 0 || p.incentive > INCENTIVE_MAX) throw new UserError(`The incentive is a percentage from 0 to ${INCENTIVE_MAX}.`);
    if (Math.round(p.incentive) !== s.incentive) {
      data.incentive = Math.round(p.incentive);
      notes.push("incentive changed");
    }
  }
  if (!notes.length) return;
  await db.$transaction(async (tx) => {
    await tx.crmStaff.update({ where: { userId }, data });
    // A deactivated employee is signed out everywhere at once.
    if (data.status === "Inactive") await tx.session.deleteMany({ where: { userId } });
    await crmAudit(tx, { actorId: u.id, kind: "user", text: `${s.user.name} (${s.empId}): ${notes.join(", ")}`, meta: { userId } });
  });
}

// ── Campaigns ──────────────────────────────────────────────────────────────

export async function listCampaigns() {
  const rows = await db.crmCampaign.findMany({ orderBy: { createdAt: "desc" }, include: { _count: { select: { leads: true } } } });
  return rows.map((c) => ({ id: c.id, name: c.name, source: c.source, spend: c.spend, leads: c._count.leads }));
}

export async function saveCampaign(u: CrmUser, id: string | null, i: { name: string; source: string; spend?: number | null }) {
  need(u, "campaigns.manage");
  const name = i.name.trim();
  if (name.length < 2) throw new UserError("Name the campaign.", "name");
  if (!(SOURCES as readonly string[]).includes(i.source)) throw new UserError("Choose a source.", "source");
  // Spend is only what someone recorded: empty means "not recorded", never an estimate.
  const spend = i.spend == null || Number.isNaN(i.spend) ? null : Math.max(0, Math.round(i.spend * 100));
  const c = id ? await db.crmCampaign.update({ where: { id }, data: { name, source: i.source, spend } }) : await db.crmCampaign.create({ data: { name, source: i.source, spend } });
  await crmAudit(db, { actorId: u.id, kind: "user", text: `Campaign ${id ? "updated" : "created"}: ${name}` });
  return c;
}

// ── Notifications ──────────────────────────────────────────────────────────

export const myNotifications = (u: CrmUser) => db.crmNotification.findMany({ where: { userId: u.id }, orderBy: { createdAt: "desc" }, take: 50 });
export const unreadCount = (u: CrmUser) => db.crmNotification.count({ where: { userId: u.id, read: false } });
export const markAllRead = (u: CrmUser) => db.crmNotification.updateMany({ where: { userId: u.id, read: false }, data: { read: true } });

// ── Audit log ──────────────────────────────────────────────────────────────

export async function listAudit(u: CrmUser, f: { kind?: string; page?: number }) {
  need(u, "audit.view");
  const size = 50;
  const where = f.kind ? { kind: f.kind } : {};
  const [rows, total] = await Promise.all([db.crmAudit.findMany({ where, orderBy: { id: "desc" }, skip: ((f.page ?? 1) - 1) * size, take: size }), db.crmAudit.count({ where })]);
  const users = await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actorId))] } }, select: { id: true, name: true } });
  const nm = new Map(users.map((x) => [x.id, x.name]));
  return { rows: rows.map((r) => ({ id: String(r.id), at: r.at, actor: nm.get(r.actorId) ?? "—", kind: r.kind, leadId: r.leadId, text: r.text })), total, size };
}
