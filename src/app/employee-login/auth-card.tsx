"use client";

import { useActionState, useState, type ComponentProps } from "react";
import { passwordRules } from "@/lib/domain/crm-pay";
import { forgotAction, resendAction, resetAction, signInAction, signUpAction, verifyCodeAction, type AuthState } from "./actions";

type Mode = "login" | "signup" | "verify" | "forgot" | "reset";
const field = "min-h-[46px] w-full rounded-xl border border-[var(--line-2)] bg-[var(--input)] px-3.5 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--faint)] focus:border-[var(--accent)] focus:outline-none";
const label = "flex flex-col gap-1.5 text-xs font-semibold text-[var(--muted)]";
const linkBtn = "p-0 text-xs font-semibold text-[var(--accent)] hover:underline";

function Input(p: ComponentProps<"input">) {
  return <input {...p} className={`${field} ${p.className ?? ""}`} />;
}

const TITLES: Record<Mode, [string, string]> = {
  login: ["Welcome back", "Sign in with your work email or employee ID and the password you set."],
  signup: ["Create your account", "Use your email. @fitron.in addresses get in right away; any other address waits for a Super Admin to approve it."],
  verify: ["Confirm your email", "Enter the six-digit code we sent you."],
  forgot: ["Forgot password", "We'll email you a code and a link to choose a new one."],
  reset: ["Choose a new password", "Enter the code from the email and your new password."],
};

/** The employee sign-in card from the design: Sign in and Create account tabs, then the steps that follow (confirm email, forgot and reset password). */
export function AuthCard({ initial, notice, resetToken, email: initialEmail }: { initial: Mode; notice?: string; resetToken?: string; email?: string }) {
  const [mode, setMode] = useState<Mode>(initial);
  const [show, setShow] = useState(false);
  const [email, setEmail] = useState(initialEmail ?? "");
  // React clears a form's fields after its action returns, so what was typed is kept here and survives an error.
  const [f, setF] = useState({ name: "", phone: "", confirm: "", code: "", password: "" });
  const bind = (k: keyof typeof f) => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value })) });
  const go = (m: Mode) => {
    setMode(m);
    setF((x) => ({ ...x, password: "", confirm: "", code: "" }));
  };
  const wrap = (a: (s: AuthState, fd: FormData) => Promise<AuthState>) => async (prev: AuthState, fd: FormData) => {
    const r = await a(prev, fd);
    if (r?.mode) go(r.mode);
    if (r?.email) setEmail(r.email);
    return r;
  };
  const [sIn, doSignIn, inPending] = useActionState(wrap(signInAction), undefined);
  const [sUp, doSignUp, upPending] = useActionState(wrap(signUpAction), undefined);
  const [sVer, doVerify, verPending] = useActionState(wrap(verifyCodeAction), undefined);
  const [sRe, doResend] = useActionState(wrap(resendAction), undefined);
  const [sFor, doForgot, forPending] = useActionState(wrap(forgotAction), undefined);
  const [sRes, doReset, resPending] = useActionState(wrap(resetAction), undefined);
  const cur = { login: sIn, signup: sUp, verify: sVer ?? sRe, forgot: sFor, reset: sRes }[mode];
  // A notice from the step before (account created, code sent) shows until the person acts again.
  const msg = cur?.notice ?? [sUp, sVer, sRe, sFor, sRes].map((x) => x?.notice).find(Boolean) ?? notice;
  const rules = passwordRules(f.password, email);
  const strong = rules.slice(0, 4).filter((r) => r.ok).length;
  const [t, sub] = TITLES[mode];
  const tab = (m: Mode, text: string) => (
    <button type="button" onClick={() => go(m)} className={`min-h-10 flex-1 rounded-full text-[13px] font-bold ${mode === m ? "bg-gradient-to-b from-[#f3d88f] via-[#d9b45a] to-[#c49a3c] text-[#17140d]" : "text-[var(--text)]"}`}>
      {text}
    </button>
  );
  const pwField = (name: string, text: string, auto: string) => (
    <label className={label}>
      <span className="flex items-center justify-between">
        <span>{text}</span>
        <button type="button" onClick={() => setShow(!show)} className={linkBtn}>{show ? "Hide" : "Show"}</button>
      </span>
      <Input name={name} type={show ? "text" : "password"} autoComplete={auto} required {...bind(name === "password" ? "password" : "confirm")} />
    </label>
  );
  const cta = "mt-1 min-h-[50px] rounded-full bg-gradient-to-b from-[#f3d88f] via-[#d9b45a] to-[#c49a3c] text-[15px] font-bold text-[#17140d] shadow-[inset_0_1px_0_rgba(255,255,255,.5),0_12px_26px_-8px_rgba(217,180,90,.5)] hover:brightness-105 disabled:opacity-60";

  return (
    <div className="flex w-full max-w-[440px] flex-col gap-[18px] rounded-[22px] border border-[var(--line-2)] bg-[var(--surface)] p-[30px] shadow-[0_40px_90px_-40px_rgba(0,0,0,.9)]">
      {(mode === "login" || mode === "signup") && (
        <div className="flex gap-1 rounded-full border border-[var(--line)] p-1">
          {tab("login", "Sign in")}
          {tab("signup", "Create account")}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <h2 className="font-[var(--font-head)] text-[26px] uppercase">{t}</h2>
        <span className="text-[13px] text-[var(--muted)]">{sub}</span>
      </div>
      {msg && !cur?.error && <div role="status" className="rounded-xl bg-[var(--accent-soft)] px-3.5 py-2.5 text-[13px] text-[var(--accent-strong)]">{msg}</div>}

      {mode === "login" && (
        <form action={doSignIn} className="flex flex-col gap-[18px]">
          <label className={label}>Email or employee ID<Input name="id" autoComplete="username" placeholder="name@fitron.in or FIT-EMP-0004" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          {pwField("password", "Password", "current-password")}
          <button type="button" onClick={() => go("forgot")} className={`${linkBtn} self-end`}>Forgot password?</button>
          {sIn?.error && <span role="alert" className="text-[13px] text-[var(--alert-strong)]">{sIn.error}</span>}
          {sIn?.unverified && <button type="button" onClick={() => { setEmail(sIn.unverified!); go("verify"); }} className={`${linkBtn} self-start`}>Enter the confirmation code</button>}
          <button className={cta} disabled={inPending}>{inPending ? "Signing in…" : "Sign in"}</button>
          <span className="text-center text-xs text-[var(--muted)]">New to the team? <button type="button" onClick={() => go("signup")} className={linkBtn}>Create an account</button></span>
        </form>
      )}

      {mode === "signup" && (
        <form action={doSignUp} className="flex flex-col gap-[18px]">
          <label className={label}>Full name<Input name="name" autoComplete="name" required {...bind("name")} /></label>
          <label className={label}>Work email<Input name="id" type="email" autoComplete="username" placeholder="name@fitron.in" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label className={label}>Mobile number<Input name="phone" inputMode="tel" autoComplete="tel" placeholder="98xxxxxxxx" required {...bind("phone")} /></label>
          {pwField("password", "Create a password", "new-password")}
          <div className="-mt-1.5 flex flex-col gap-1.5">
            <div className="grid grid-cols-4 gap-1">{[0, 1, 2, 3].map((i) => <span key={i} className={`h-1 rounded-full ${i < strong ? (strong === 4 ? "bg-[var(--ok)]" : "bg-[var(--accent)]") : "bg-[var(--line-2)]"}`} />)}</div>
            <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[11px]">{rules.map((r) => <span key={r.key} className={r.ok ? "text-[var(--ok)]" : "text-[var(--faint)]"}>{r.ok ? "✓" : "○"} {r.text}</span>)}</div>
          </div>
          <label className={label}>Confirm password<Input name="confirm" type={show ? "text" : "password"} autoComplete="new-password" required {...bind("confirm")} /></label>
          <span className="text-xs text-[var(--faint)]">You&apos;ll use this email and password to sign in. Other than @fitron.in, a Super Admin approves new accounts. Invited employees: use the email your admin invited.</span>
          {sUp?.error && <span role="alert" className="text-[13px] text-[var(--alert-strong)]">{sUp.error}</span>}
          <button className={cta} disabled={upPending}>{upPending ? "Creating…" : "Create account"}</button>
          <span className="text-center text-xs text-[var(--muted)]">Already have an account? <button type="button" onClick={() => go("login")} className={linkBtn}>Sign in</button></span>
        </form>
      )}

      {mode === "verify" && (
        <div className="flex flex-col gap-[18px]">
          <form action={doVerify} className="flex flex-col gap-[18px]">
            <label className={label}>Email<Input name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
            <label className={label}>Six-digit code<Input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} required {...bind("code")} /></label>
            {sVer?.error && <span role="alert" className="text-[13px] text-[var(--alert-strong)]">{sVer.error}</span>}
            <button className={cta} disabled={verPending}>{verPending ? "Checking…" : "Confirm email"}</button>
          </form>
          <form action={doResend} className="flex items-center justify-between text-xs text-[var(--muted)]">
            <input type="hidden" name="email" value={email} />
            <span>No email yet? Check spam.</span><button className={linkBtn}>Send a new code</button>
          </form>
          <button type="button" onClick={() => go("login")} className={`${linkBtn} self-center`}>Back to sign in</button>
        </div>
      )}

      {mode === "forgot" && (
        <form action={doForgot} className="flex flex-col gap-[18px]">
          <label className={label}>Work email<Input name="id" type="email" autoComplete="username" placeholder="name@fitron.in" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          {sFor?.error && <span role="alert" className="text-[13px] text-[var(--alert-strong)]">{sFor.error}</span>}
          <button className={cta} disabled={forPending}>{forPending ? "Sending…" : "Send code and link"}</button>
          <button type="button" onClick={() => go("login")} className={`${linkBtn} self-center`}>Back to sign in</button>
        </form>
      )}

      {mode === "reset" && (
        <form action={doReset} className="flex flex-col gap-[18px]">
          <input type="hidden" name="token" value={resetToken ?? ""} />
          {!resetToken && (
            <>
              <label className={label}>Work email<Input name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
              <label className={label}>Six-digit code<Input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} required {...bind("code")} /></label>
            </>
          )}
          {pwField("password", "New password", "new-password")}
          <div className="-mt-1.5 flex flex-wrap gap-x-3.5 gap-y-1 text-[11px]">{rules.map((r) => <span key={r.key} className={r.ok ? "text-[var(--ok)]" : "text-[var(--faint)]"}>{r.ok ? "✓" : "○"} {r.text}</span>)}</div>
          <label className={label}>Confirm new password<Input name="confirm" type={show ? "text" : "password"} autoComplete="new-password" required {...bind("confirm")} /></label>
          {sRes?.error && <span role="alert" className="text-[13px] text-[var(--alert-strong)]">{sRes.error}</span>}
          <button className={cta} disabled={resPending}>{resPending ? "Saving…" : "Change password"}</button>
          <button type="button" onClick={() => go("login")} className={`${linkBtn} self-center`}>Back to sign in</button>
        </form>
      )}
    </div>
  );
}
