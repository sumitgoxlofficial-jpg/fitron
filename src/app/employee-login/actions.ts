"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSession } from "@/lib/auth/session";
import { startChallenge } from "@/lib/auth/two-step-challenge";
import { confirmEmployeeEmail, employeeSignIn, employeeSignUp, requestEmployeeReset, resendEmployeeVerification, resetEmployeePassword } from "@/lib/services/crm-auth";
import { recordSignIn } from "@/lib/services/accounts";
import { UserError } from "@/lib/services/errors";

// The employee page's actions. Each answers with a small state the page shows; a successful sign-in goes straight to the CRM.

export type AuthState = { error?: string; notice?: string; field?: string; mode?: "login" | "signup" | "verify" | "forgot" | "reset"; email?: string; unverified?: string; nonce?: string } | undefined;

const ip = async () => (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
const s = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? (fd.get(k) as string).trim() : "");
const nonce = () => Math.random().toString(36).slice(2);
const fail = (e: unknown): AuthState => {
  if (e instanceof UserError) return { error: e.message, field: e.field, nonce: nonce() };
  throw e;
};

export async function signInAction(_: AuthState, fd: FormData): Promise<AuthState> {
  const r = await employeeSignIn(s(fd, "id"), String(fd.get("password") ?? ""), await ip());
  if (!r.ok) return { error: r.error, unverified: r.unverified, nonce: nonce() };
  if (r.twoStep) {
    await startChallenge({ uid: r.userId, next: "/crm", via: "email" });
    redirect("/login?step=2");
  }
  await createSession(r.userId);
  await recordSignIn(r.userId, "email");
  redirect("/crm");
}

export async function signUpAction(_: AuthState, fd: FormData): Promise<AuthState> {
  try {
    const r = await employeeSignUp({ name: s(fd, "name"), email: s(fd, "id"), phone: s(fd, "phone"), password: String(fd.get("password") ?? ""), confirm: String(fd.get("confirm") ?? "") }, await ip());
    return r.verified
      ? { mode: "login", notice: "Account created. Sign in with your email or employee ID.", email: r.email, nonce: nonce() }
      : { mode: "verify", email: r.email, notice: "We sent a six-digit code and a link to your email. Enter the code, or open the link, to confirm it.", nonce: nonce() };
  } catch (e) {
    return fail(e);
  }
}

export async function verifyCodeAction(_: AuthState, fd: FormData): Promise<AuthState> {
  const email = s(fd, "email");
  const ok = await confirmEmployeeEmail({ email, code: s(fd, "code") });
  return ok ? { mode: "login", notice: "Email confirmed. Sign in.", email, nonce: nonce() } : { mode: "verify", email, error: "That code is not right, or it has expired.", nonce: nonce() };
}

export async function resendAction(_: AuthState, fd: FormData): Promise<AuthState> {
  const email = s(fd, "email");
  await resendEmployeeVerification(email, await ip());
  return { mode: "verify", email, notice: "If that address is waiting to be confirmed, we've sent a new code and link.", nonce: nonce() };
}

export async function forgotAction(_: AuthState, fd: FormData): Promise<AuthState> {
  const email = s(fd, "id");
  if (!email.includes("@")) return { mode: "forgot", error: "Enter your work email.", nonce: nonce() };
  await requestEmployeeReset(email, await ip());
  return { mode: "reset", email, notice: "If that email belongs to an employee, we've sent a code and a link. Enter the code with your new password.", nonce: nonce() };
}

export async function resetAction(_: AuthState, fd: FormData): Promise<AuthState> {
  const token = s(fd, "token");
  const email = s(fd, "email");
  try {
    await resetEmployeePassword(token ? { token } : { email, code: s(fd, "code") }, String(fd.get("password") ?? ""), String(fd.get("confirm") ?? ""));
    return { mode: "login", notice: "Password changed. Sign in with the new one.", email, nonce: nonce() };
  } catch (e) {
    const r = fail(e);
    return { ...r, mode: "reset", email };
  }
}
