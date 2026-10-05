"use server";

import * as z from "zod";
import "@/lib/zod-config";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { audit } from "@/lib/services/audit";
import { recordSignIn } from "@/lib/services/accounts";
import { getCurrentUser } from "@/lib/auth/current";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession, idleSignOut } from "@/lib/auth/session";
import { clearChallenge, readChallenge, startChallenge } from "@/lib/auth/two-step-challenge";
import { verifySecondFactor } from "@/lib/services/two-step";
import { safeNext } from "@/lib/auth/next";
import { rateLimit } from "@/lib/rate-limit";
import { fieldErrors, type FormState } from "@/lib/validation/common";
import { signupStep1Schema } from "@/lib/validation/site";

const loginInput = z.object({
  email: z.email({ error: "Enter your email." }).transform((s) => s.toLowerCase().trim()),
  password: z.string().min(1, { error: "Enter your password." }),
});

// Verifying against a dummy hash keeps timing the same for unknown emails.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword("not-a-real-password"));

type LoginState = (FormState & { email?: string; unverified?: boolean }) | undefined;

export async function login(_: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimit(`login:${ip}`, 5, 60_000)) return { email, message: "Too many attempts. Wait a minute and try again." };

  const parsed = loginInput.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { email, errors: z.flattenError(parsed.error).fieldErrors };

  const user = await db.user.findFirst({ where: { email: parsed.data.email, active: true, deletedAt: null } });
  const ok = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), parsed.data.password);
  if (!user || !ok) return { email, message: "Email or password is incorrect." };
  if (!user.emailVerifiedAt) return { email, unverified: true, message: "Confirm your email first: open the link we sent you." };

  // Two-step sign-in: the password was right, but a code is still needed. No session until it is given.
  if (user.totpEnabledAt) {
    await startChallenge({ uid: user.id, next: safeNext(formData.get("next")), via: "email" });
    redirect("/login?step=2");
  }

  await createSession(user.id);
  await recordSignIn(user.id, "email");
  redirect(safeNext(formData.get("next")));
}

/** The second step of a sign-in: a code from the authenticator app, or a recovery code. */
export async function verifyTwoStep(_: LoginState, formData: FormData): Promise<LoginState> {
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimit(`two-step:${ip}`, 20, 10 * 60_000)) return { message: "Too many tries. Wait a few minutes and sign in again." };
  const challenge = await readChallenge();
  if (!challenge) redirect("/login?twostep=expired");
  // Per person as well as per address: a code has a million possibilities, so guessing has to stay slow from anywhere.
  if (!rateLimit(`two-step-user:${challenge.uid}`, 8, 10 * 60_000)) return { message: "Too many wrong codes. Wait a few minutes and sign in again." };
  const user = await db.user.findFirst({ where: { id: challenge.uid, active: true, deletedAt: null }, select: { id: true } });
  if (!user) {
    await clearChallenge();
    redirect("/login?twostep=expired");
  }
  const how = await verifySecondFactor(user.id, String(formData.get("code") ?? ""));
  if (!how) return { message: "That code is not right. Use the current code in your app, or a recovery code." };
  await clearChallenge();
  await createSession(user.id);
  await recordSignIn(user.id, challenge.via, how);
  redirect(safeNext(challenge.next));
}

export async function logout() {
  const me = await getCurrentUser().catch(() => null);
  if (me) await db.$transaction((tx) => audit(tx, { orgId: me.orgId, userId: me.id, action: "auth.logout", entity: "User", entityId: me.id }));
  await destroySession();
  redirect("/login");
}

/** The browser sat idle for the configured minutes (Settings › Go live › Security): sign out and say why. */
export async function idleLogout(minutes: number) {
  const m = Math.max(1, Math.min(1440, Math.floor(Number(minutes) || 0)));
  await idleSignOut(m);
  redirect(`/login?idle=${m}`);
}

/** Create account, step 1: check the owner's details and that the email is free before asking about the gym. */
export async function continueSignup(_: FormState, fd: FormData): Promise<FormState> {
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimit(`signup-check:${ip}`, 10, 10 * 60_000)) return { message: "Too many tries in a few minutes. Wait a little and try again.", nonce: Math.random().toString(36).slice(2) };
  const parsed = signupStep1Schema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    return { errors, message: Object.values(errors).flat()[0] ?? "Check the highlighted fields.", nonce: Math.random().toString(36).slice(2) };
  }
  if (await db.user.findUnique({ where: { email: parsed.data.email }, select: { id: true } })) {
    const message = "An account with this email exists. Sign in instead.";
    return { message, errors: { email: [message] }, nonce: Math.random().toString(36).slice(2) };
  }
  return { ok: true, nonce: Math.random().toString(36).slice(2) };
}
