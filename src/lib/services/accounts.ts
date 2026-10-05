import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { findPlan, TRIAL_DAYS, type Cycle } from "@/lib/domain/pricing";
import { emailReady, sendEmail } from "@/lib/integrations/email";
import { putObject, sniffType } from "@/lib/integrations/storage";
import { audit } from "./audit";
import { MAX_LOGO_BYTES } from "./gym-logo";
import { ensureExpenseCategories, ensureRoles } from "../../../prisma/roles";
import { isUniqueViolation, UserError } from "./errors";
import { log } from "@/lib/log";

// Self sign-up for gyms, email verification and password reset.

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const HOUR = 3_600_000;
const LIFETIME = { VERIFY_EMAIL: 48 * HOUR, RESET_PASSWORD: 1 * HOUR } as const;
type Purpose = keyof typeof LIFETIME;

export const appUrl = () => (process.env.APP_URL?.trim() || (process.env.NODE_ENV === "production" ? "https://fitron.in" : "http://localhost:3000")).replace(/\/$/, "");

/** Makes a one-time link token; only its hash is stored. Older unused tokens of the same kind stop working. */
async function issueToken(userId: string, purpose: Purpose) {
  const token = randomBytes(32).toString("base64url");
  await db.$transaction([
    db.authToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } }),
    db.authToken.create({ data: { id: sha256(token), userId, purpose, expiresAt: new Date(Date.now() + LIFETIME[purpose]) } }),
  ]);
  return token;
}

/** Marks the token used and returns its user id, or null if it is unknown, used or expired. */
async function redeemToken(token: string, purpose: Purpose) {
  const row = await db.authToken.findUnique({ where: { id: sha256(token) } });
  if (!row || row.purpose !== purpose || row.usedAt || row.expiresAt.getTime() < Date.now()) return null;
  const { count } = await db.authToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  return count === 1 ? row.userId : null;
}

export type GymSignup = { plan: string; cycle: Cycle; name: string; email: string; phone: string; business: string; city?: string; password: string;
  gymEmail?: string; address?: string; state?: string; pin?: string; tagline?: string; website?: string; instagram?: string; logo?: File | null };

/**
 * Creates a gym on a free trial: the organisation, its first branch, default roles and
 * categories, and the owner as Super Admin. Then emails the owner a verification link.
 * Without an email service there is no way to deliver the link, so the address is trusted.
 */
/** `emailVerified`: Google has already confirmed the address, so no link is sent. */
export async function createGymAccount(d: GymSignup, emailVerified = false) {
  const plan = findPlan(d.plan);
  if (!plan || plan.product !== "GYM_ACCOUNTING") throw new UserError("Pick a Gym Accounting plan.", "plan");
  if (await db.user.findUnique({ where: { email: d.email } })) {
    throw new UserError("There's already an account with this email. Sign in, or reset your password.", "email");
  }
  // Check the logo first so a bad file fails before anything is created.
  let logo: { bytes: Uint8Array; mime: string; ext: string } | null = null;
  if (d.logo && d.logo.size > 0) {
    if (d.logo.size > MAX_LOGO_BYTES) throw new UserError("Logo must be under 1 MB.", "logo");
    const bytes = new Uint8Array(await d.logo.arrayBuffer());
    const type = sniffType(bytes);
    if (!type || (type.mime !== "image/png" && type.mime !== "image/jpeg")) throw new UserError("Use a PNG or JPG logo.", "logo");
    logo = { bytes, ...type };
  }
  const roles = await ensureRoles(db);
  await ensureExpenseCategories(db);
  const passwordHash = await hashPassword(d.password);
  const verifyNow = emailVerified || !emailReady();
  let user;
  try {
    user = await db.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { name: d.business, plan: plan.key, planCycle: d.cycle, trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * HOUR) },
      });
      const address = [d.address, d.city, d.pin].filter(Boolean).join(", ") || (d.city ?? "");
      const branch = await tx.branch.create({ data: { orgId: org.id, name: "Main", address, phone: d.phone } });
      const gym = compact({ name: d.business, phone: d.phone, email: d.gymEmail, address: d.address, city: d.city, state: d.state, pin: d.pin, tagline: d.tagline, website: d.website, instagram: d.instagram });
      // The DPDP consent record: what was accepted, when and by whom.
      const legal = { tos: "v1", privacy: "v1", dpa: "v1", marketing: false, at: new Date().toISOString(), by: d.email };
      await tx.setting.create({ data: { orgId: org.id, key: "gym", value: gym } });
      await tx.setting.create({ data: { orgId: org.id, key: "legal", value: legal } });
      const owner = await tx.user.create({
        data: {
          orgId: org.id,
          name: d.name,
          email: d.email,
          phone: d.phone,
          roleId: roles.get("Super Admin")!,
          passwordHash,
          emailVerifiedAt: verifyNow ? new Date() : null,
          branches: { create: [{ branchId: branch.id }] },
        },
      });
      await audit(tx, { orgId: org.id, userId: owner.id, action: "account.create", entity: "Organization", entityId: org.id, after: { plan: plan.key, cycle: d.cycle, gym, legal, via: emailVerified ? "google" : "email" } });
      return owner;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new UserError("There's already an account with this email. Sign in, or reset your password.", "email");
    throw e;
  }
  if (logo) {
    // The file needs the org id, so it goes up after the account exists. A failed upload never undoes the account.
    try {
      const key = `${user.orgId}/gym/logo-${randomUUID()}.${logo.ext}`;
      await putObject(key, logo.bytes, logo.mime);
      const row = await db.setting.findUniqueOrThrow({ where: { orgId_key: { orgId: user.orgId, key: "gym" } } });
      await db.setting.update({ where: { orgId_key: { orgId: user.orgId, key: "gym" } }, data: { value: { ...(row.value as object), logoKey: key } } });
    } catch (e) {
      log.error("signup.logo_upload_failed", e);
    }
  }
  if (!verifyNow) await sendVerification(user.id);
  return { user, verified: verifyNow };
}

const compact = (o: Record<string, string | undefined>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as Record<string, string>;

/** A successful sign-in: stamps lastLoginAt and records how, in one transaction. */
export async function recordSignIn(userId: string, via: "email" | "google") {
  await db.$transaction(async (tx) => {
    const u = await tx.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    await audit(tx, { orgId: u.orgId, userId, action: "auth.login", entity: "User", entityId: userId, after: { via } });
  });
}

export async function sendVerification(userId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.emailVerifiedAt) return;
  const link = `${appUrl()}/verify-email?token=${await issueToken(user.id, "VERIFY_EMAIL")}`;
  await sendEmail({
    to: user.email,
    subject: "Confirm your email for FITRON",
    text: `Hi ${user.name},\n\nConfirm your email to start using FITRON:\n${link}\n\nThe link works for 48 hours. If you didn't sign up, ignore this email.\n\nFITRON\nhello@fitron.in`,
  });
}

/** Resends the link to an unverified address. Says nothing about whether the address exists. */
export async function resendVerification(email: string) {
  const user = await db.user.findFirst({ where: { email, active: true, deletedAt: null, emailVerifiedAt: null } });
  if (user) await sendVerification(user.id);
}

export async function verifyEmail(token: string) {
  const userId = await redeemToken(token, "VERIFY_EMAIL");
  if (!userId) return null;
  return db.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
}

/** Emails a reset link if the address belongs to an active account. Always looks the same to the caller. */
export async function requestPasswordReset(email: string) {
  const user = await db.user.findFirst({ where: { email, active: true, deletedAt: null } });
  if (!user) return;
  const link = `${appUrl()}/reset-password?token=${await issueToken(user.id, "RESET_PASSWORD")}`;
  await sendEmail({
    to: user.email,
    subject: "Reset your FITRON password",
    text: `Hi ${user.name},\n\nChoose a new password here:\n${link}\n\nThe link works for 1 hour. If you didn't ask for this, ignore this email: your password stays the same.\n\nFITRON\nhello@fitron.in`,
  });
}

/**
 * Sets a new password from a reset link and signs the user out everywhere. Clicking a link
 * from their inbox also proves the address, so it counts as verified.
 */
export async function resetPassword(token: string, password: string) {
  const userId = await redeemToken(token, "RESET_PASSWORD");
  if (!userId) throw new UserError("This link has expired or was already used. Ask for a new one.");
  const passwordHash = await hashPassword(password);
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  await db.$transaction([
    db.user.update({ where: { id: userId }, data: { passwordHash, emailVerifiedAt: user.emailVerifiedAt ?? new Date() } }),
    db.session.deleteMany({ where: { userId } }),
  ]);
  return user;
}
