import "server-only";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { emailReady, sendEmail } from "@/lib/integrations/email";
import { normalizePhone } from "@/lib/domain/crm";
import { isWorkEmail, passwordError, signInKey } from "@/lib/domain/crm-pay";
import { rateLimit } from "@/lib/rate-limit";
import { activeAdmins, crmAudit, nextEmpId, notify, teamOrg, teamRoleId } from "./crm-access";
import { appUrl, issueCode, issueToken, redeemCode, redeemToken, setNewPassword } from "./accounts";
import { isFitronAdmin } from "@/lib/integrations/fitron-team";
import { crmUserFor } from "./crm-people";
import { isUniqueViolation, UserError } from "./errors";
import { todayIso, fromIso } from "./time";

// Sign-in and account creation for FITRON employees, on their own page (src/app/employee-login). The accounts are the product's
// own (User, Session, password reset, email codes); only the wording, the work-email rule and the CRM checks are here.

let dummy: Promise<string> | undefined;
const dummyHash = () => (dummy ??= hashPassword("not-a-real-password"));

export type SignInResult = { ok: true; userId: string; twoStep: boolean } | { ok: false; error: string; unverified?: string };

/** Checks an email or employee ID and a password. Unknown people, wrong passwords and invited-but-not-set-up accounts take the same time and, until the password is right, say nothing about which account exists. */
export async function employeeSignIn(identifier: string, password: string, ip: string): Promise<SignInResult> {
  const key = signInKey(identifier);
  const who = "email" in key ? key.email : key.empId;
  if (!identifier.trim() || !password) return { ok: false, error: "Enter your email or employee ID and your password." };
  if (!rateLimit(`crm-login:${ip}:${who}`, 5, 60_000) || !rateLimit(`crm-login-ip:${ip}`, 30, 60_000)) return { ok: false, error: "Too many attempts. Sign-in is locked for a minute." };
  let staff = await db.crmStaff.findFirst({ where: "email" in key ? { user: { email: key.email } } : { empId: key.empId }, include: { user: true } });
  // Someone on the FITRON team (FITRON_ADMIN_EMAILS) who already has a FITRON account, such as a gym owner, becomes the first Super Admin on their first sign-in here.
  if (!staff && "email" in key && isFitronAdmin(key.email)) {
    const acct = await db.user.findFirst({ where: { email: key.email, active: true, deletedAt: null } });
    if (acct && (await verifyPassword(acct.passwordHash, password)) && (await crmUserFor(acct.id, acct.email))) staff = await db.crmStaff.findFirst({ where: { userId: acct.id }, include: { user: true } });
  }
  const ok = await verifyPassword(staff?.user.passwordHash ?? (await dummyHash()), password);
  if (!staff || !ok || staff.user.deletedAt || !staff.user.active) {
    return { ok: false, error: staff?.status === "Invited" ? "This account was invited but not set up yet. Use Create account with this email." : "Email / employee ID or password is incorrect." };
  }
  if (staff.status === "Invited") return { ok: false, error: "This account was invited but not set up yet. Use Create account with this email." };
  // An address added to FITRON_ADMIN_EMAILS after it signed up is approved by the right password.
  if (staff.status === "Pending" && isFitronAdmin(staff.user.email)) {
    staff = await db.crmStaff.update({ where: { userId: staff.userId }, data: { status: "Active", role: "admin" }, include: { user: true } });
    await crmAudit(db, { actorId: staff.userId, kind: "user", text: `${staff.user.name} approved as Super Admin (FITRON admin list)` });
  }
  if (staff.status === "Pending") return { ok: false, error: "Your account is waiting for a Super Admin to approve it. You'll be able to sign in once they do." };
  if (staff.status === "Inactive") return { ok: false, error: "This account is deactivated. Contact your Super Admin." };
  if (!staff.user.emailVerifiedAt) return { ok: false, error: "Confirm your email first: open the link we sent you, or enter the code.", unverified: staff.user.email };
  await crmAudit(db, { actorId: staff.userId, kind: "user", text: `${staff.user.name} signed in` });
  return { ok: true, userId: staff.userId, twoStep: !!staff.user.totpEnabledAt };
}

export type SignUp = { name: string; email: string; phone: string; password: string; confirm: string };

/**
 * Creates an employee account. Only a work address can register, and the address is confirmed by an emailed link or code before
 * the first sign-in. An address an admin invited finishes its invite; any other address makes a Sales Employee, and the Super
 * Admins are told.
 */
export async function employeeSignUp(d: SignUp, ip: string): Promise<{ email: string; verified: boolean }> {
  if (!rateLimit(`crm-signup:${ip}`, 5, 10 * 60_000)) throw new UserError("Too many attempts. Wait a few minutes and try again.");
  const email = d.email.trim().toLowerCase();
  const name = d.name.trim();
  if (name.length < 3) throw new UserError("Enter your full name.", "name");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError("Enter a valid email address.", "email");
  const phone = normalizePhone(d.phone);
  if (!phone) throw new UserError("Enter a valid 10-digit mobile number.", "phone");
  const pe = passwordError(d.password, email);
  if (pe) throw new UserError(pe, "password");
  if (d.password !== d.confirm) throw new UserError("Passwords do not match.", "confirm");
  const [orgId, roleId, passwordHash] = await Promise.all([teamOrg(), teamRoleId(), hashPassword(d.password)]);
  const verifyNow = !emailReady();
  const today = todayIso();
  try {
    const out = await db.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email }, include: { crmStaff: true } });
      if (existing && existing.crmStaff?.status !== "Invited") throw new UserError(isFitronAdmin(email) && !existing.crmStaff ? "This email already has a FITRON account. Sign in with that account's password and you'll be the Super Admin." : "An account with this email already exists. Sign in instead.", "email");
      const user = existing
        ? await tx.user.update({ where: { id: existing.id }, data: { name, phone, passwordHash, emailVerifiedAt: verifyNow ? new Date() : null, active: true } })
        : await tx.user.create({ data: { orgId, roleId, name, email, phone, passwordHash, emailVerifiedAt: verifyNow ? new Date() : null } });
      const empId = existing?.crmStaff?.empId ?? (await nextEmpId(tx));
      const profile = { fullName: name, phone };
      // @fitron.in addresses and invited people are trusted; anyone else waits for a Super Admin, because the CRM holds customers' phone numbers.
      const owner = isFitronAdmin(email); // on FITRON_ADMIN_EMAILS: the first Super Admin
      const status = existing?.crmStaff || isWorkEmail(email) || owner ? "Active" : "Pending";
      const staff = existing?.crmStaff
        ? await tx.crmStaff.update({ where: { userId: user.id }, data: { status, joinedAt: fromIso(today), profile: { ...((existing.crmStaff.profile as object | null) ?? {}), ...profile } } })
        : await tx.crmStaff.create({ data: { userId: user.id, empId, role: owner ? "admin" : "sales", status, joinedAt: fromIso(today), profile } });
      await crmAudit(tx, { actorId: user.id, kind: "user", text: `${name} created an account as Sales Employee${existing ? " (from invite)" : ""} · employee ID ${staff.empId}`, meta: { userId: user.id } });
      await notify(tx, await activeAdmins(tx), status === "Pending" ? `${name} signed up and needs your approval (Employees page)` : `New account: ${name} (${staff.role === "sales" ? "Sales Employee" : staff.role})`);
      return user;
    });
    if (!verifyNow) await sendEmployeeVerification(out.id);
    return { email, verified: verifyNow };
  } catch (e) {
    if (isUniqueViolation(e)) throw new UserError("An account with this email already exists. Sign in instead.", "email");
    throw e;
  }
}

export async function sendEmployeeVerification(userId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.emailVerifiedAt) return;
  const link = `${appUrl()}/employee-login?verify=${await issueToken(user.id, "VERIFY_EMAIL")}`;
  const code = await issueCode(user.id, "VERIFY_EMAIL");
  await sendEmail({
    to: user.email,
    subject: `${code} is your FITRON CRM verification code`,
    text: `Hi ${user.name},\n\nYour code to confirm your email for the FITRON sales CRM: ${code}\nIt works for 10 minutes. Enter it on the page you signed up on.\n\nOr confirm with this link (it works for 48 hours):\n${link}\n\nIf you didn't sign up, ignore this email. Never share the code with anyone.\n\nFITRON`,
  });
}

/** Resends the confirmation to an unconfirmed employee address. Says nothing about whether the address exists. */
export async function resendEmployeeVerification(email: string, ip: string) {
  if (!rateLimit(`crm-resend:${ip}`, 5, 10 * 60_000)) return;
  const u = await db.user.findFirst({ where: { email: email.trim().toLowerCase(), emailVerifiedAt: null, active: true, crmStaff: { isNot: null } } });
  if (u) await sendEmployeeVerification(u.id);
}

export async function confirmEmployeeEmail(by: { token: string } | { email: string; code: string }) {
  if ("token" in by) {
    const id = await redeemToken(by.token, "VERIFY_EMAIL");
    if (!id) return false;
    await db.user.update({ where: { id }, data: { emailVerifiedAt: new Date() } });
    return true;
  }
  const u = await redeemCode(by.email.trim().toLowerCase(), by.code, "VERIFY_EMAIL");
  if (!u) return false;
  await db.user.update({ where: { id: u.id }, data: { emailVerifiedAt: u.emailVerifiedAt ?? new Date() } });
  return true;
}

/** Emails a reset link and code to an active employee. Always looks the same to the caller. */
export async function requestEmployeeReset(email: string, ip: string) {
  if (!rateLimit(`crm-reset:${ip}`, 5, 10 * 60_000)) return;
  const u = await db.user.findFirst({ where: { email: email.trim().toLowerCase(), active: true, deletedAt: null, crmStaff: { is: { status: "Active" } } } });
  if (!u) return;
  const link = `${appUrl()}/employee-login?reset=${await issueToken(u.id, "RESET_PASSWORD")}`;
  const code = await issueCode(u.id, "RESET_PASSWORD");
  await sendEmail({
    to: u.email,
    subject: `${code} is your FITRON CRM password reset code`,
    text: `Hi ${u.name},\n\nYour code to reset your FITRON CRM password: ${code}\nIt works for 10 minutes.\n\nOr choose a new password with this link (it works for 1 hour):\n${link}\n\nIf you didn't ask for this, ignore this email: your password stays the same. Never share the code with anyone.\n\nFITRON`,
  });
}

export async function resetEmployeePassword(by: { token: string } | { email: string; code: string }, password: string, confirm: string) {
  const email = "email" in by ? by.email.trim().toLowerCase() : "";
  if (password !== confirm) throw new UserError("Passwords do not match.", "confirm");
  // Check what can be checked before the link or code is used up, so a weak password doesn't cost a new email.
  const early = passwordError(password, email);
  if (early) throw new UserError(early, "password");
  let userId: string | null;
  if ("token" in by) {
    userId = await redeemToken(by.token, "RESET_PASSWORD");
  } else {
    userId = (await redeemCode(email, by.code, "RESET_PASSWORD"))?.id ?? null;
  }
  if (!userId) throw new UserError("That link or code has expired or was already used. Ask for a new one.");
  const u = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { crmStaff: true } });
  if (!u.crmStaff) throw new UserError("That link or code has expired or was already used. Ask for a new one.");
  const pe = passwordError(password, u.email);
  if (pe) throw new UserError(pe, "password");
  await setNewPassword(userId, password);
  await crmAudit(db, { actorId: userId, kind: "user", text: `${u.name} reset their password` });
}
