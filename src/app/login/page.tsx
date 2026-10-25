import Image from "next/image";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current";
import { LoginForm } from "./login-form";
import { EmailSignInForm } from "./email-signin-form";
import { emailReady } from "@/lib/integrations/email";
import { CreateAccountForm } from "./create-account-form";
import { TwoStepForm } from "./two-step-form";
import { readChallenge } from "@/lib/auth/two-step-challenge";
import { Notice } from "@/components/ui";
import { safeNext } from "@/lib/auth/next";
import { CookieBanner } from "@/components/cookie-banner";
import { googleMessage } from "@/components/google-button";
import { DEFAULT_PLAN, findPlan } from "@/lib/domain/pricing";
import { GOOGLE_SIGNUP_COOKIE, unsign } from "@/lib/integrations/google";

export const metadata = { title: "Sign in · FITRON" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const q = await searchParams;
  const next = safeNext(q.next, "");
  if (await getCurrentUser()) redirect(next || "/dashboard");
  const up = q.tab === "up";
  const planQ = one(q.plan);
  const plan = findPlan(planQ)?.product === "GYM_ACCOUNTING" ? planQ! : DEFAULT_PLAN;
  const cycle = q.cycle === "YEARLY" || q.cycle === "year" ? "YEARLY" : "MONTHLY";
  const upHref = `/login?${new URLSearchParams({ tab: "up", ...(planQ ? { plan } : {}), ...(one(q.cycle) ? { cycle } : {}), ...(next ? { next } : {}) })}`;
  const inHref = next ? `/login?${new URLSearchParams({ next })}` : "/login";
  const gMsg = googleMessage(q.google, q.email);
  // The second step of a two-step sign-in, once the password (or Google) has been accepted.
  const twoStep = !up && q.step === "2" ? await readChallenge() : null
  // Back from Google on a sign-up: it has confirmed the email and name, so the form starts at the gym's details.
  const google = up && q.google === "1" ? unsign<{ email: string; name: string }>((await cookies()).get(GOOGLE_SIGNUP_COOKIE)?.value) : null;
  // Passwordless sign-in needs the email service (without it, a development server only logs the email).
  const emailSignInOn = emailReady() || process.env.NODE_ENV !== "production";
  const emailMode = emailSignInOn && q.mode === "email";
  const stats: [string, string][] = [
    ["₹15,000", "a year, white-labelled"],
    ["24/7", "AI coach for members"],
    ["UPI", "autopay and reminders"],
  ];
  return (
    <main className="grid min-h-screen grid-cols-[repeat(auto-fit,minmax(min(100%,380px),1fr))]">
      <section className="flex flex-col justify-between gap-10 bg-[#0e0d0a] bg-[radial-gradient(ellipse_at_top_left,rgba(207,169,79,0.18),transparent_60%)] p-10 text-[#f3ede0]">
        <div className="flex items-center justify-between gap-3">
          <a href="/#top" className="block w-[min(100%,340px)]"><Image src="/fitron-logo-v2.png" alt="FITRON" width={599} height={218} className="block h-auto w-full" priority /></a>
          <a href="/#gyms" className="text-[13px] text-[#cfa94f]">For gyms ↗</a>
        </div>
        <div className="max-w-[440px]">
          <p className="mb-3 text-xs tracking-[0.14em] text-[#cfa94f] uppercase">Fitron Gym Accounting Solution</p>
          <h1 className="mb-3.5 text-[40px] leading-[1.08] font-semibold">Run your gym on FITRON.</h1>
          <p className="m-0 text-[15px] text-[#f3ede0]/72">
            Members, payments, WhatsApp reminders, accounting and an AI coach under your brand. One console for the front desk and the owner.
          </p>
        </div>
        <div className="flex flex-wrap gap-7 text-xs text-[#f3ede0]/60">
          {stats.map(([a, b]) => (
            <span key={b}><strong className="block text-xl text-[#f3ede0]">{a}</strong>{b}</span>
          ))}
        </div>
      </section>
      <section className="flex items-center justify-center bg-[#0e0d0a] px-6 py-10">
        <div className="flex w-full max-w-[420px] flex-col gap-[18px] rounded-[22px] border border-[rgba(243,237,224,0.1)] bg-[#181611] p-[30px] shadow-[0_40px_90px_-40px_rgba(0,0,0,.9)]">
{!twoStep && (
            <nav className="flex gap-1 rounded-full border border-[rgba(243,237,224,0.1)] bg-[#0e0d0a] p-1" aria-label="Sign in or create account">
            <Link href={inHref} aria-current={up ? undefined : "page"} className={`flex-1 rounded-full px-3.5 py-2 text-[13px] font-bold text-center ${up ? "text-[#cfa94f]" : "bg-gradient-to-b from-[#f3d88f] via-[#d9b45a] to-[#c49a3c] text-[#17140d]"}`}>Sign in</Link>
            <Link href={upHref} aria-current={up ? "page" : undefined} className={`flex-1 rounded-full px-3.5 py-2 text-[13px] font-bold text-center ${up ? "bg-gradient-to-b from-[#f3d88f] via-[#d9b45a] to-[#c49a3c] text-[#17140d]" : "text-[#cfa94f]"}`}>Create account</Link>
          </nav>
          )}
          {twoStep ? (
            <>
              <div>
                <h2 className="text-[26px] font-semibold text-[#f3ede0] uppercase" style={{fontFamily:"var(--font-head,inherit)"}}>Two-step sign-in</h2>
                <p className="m-0 text-sm text-[#a99f8c]">Your password was right. Now enter the code from your authenticator app.</p>
              </div>
              <TwoStepForm />
            </>
          ) : up ? (
            <>
              {gMsg && <Notice tone="alert">{gMsg}</Notice>}
              <CreateAccountForm key={google?.email ?? "email"} plan={plan} cycle={cycle} googleOn={false} google={google ? { email: google.email, name: google.name } : undefined} />
            </>
          ) : (
            <>
              <div>
                <h2 className="text-[26px] font-semibold text-[#f3ede0] uppercase" style={{fontFamily:"var(--font-head,inherit)"}}>Welcome back</h2>
                <p className="m-0 text-[13px] text-[#a99f8c]">Sign in with your staff email.</p>
              </div>
              {(q.twostep === "expired" || (q.step === "2" && !twoStep)) && <Notice tone="alert">That sign-in took too long or could not be finished. Sign in again.</Notice>}
              {typeof q.idle === "string" && /^\d+$/.test(q.idle) && <Notice tone="alert">You were signed out after {q.idle} minutes of inactivity.</Notice>}
              {q.reset && <Notice tone="ok">Password changed. Sign in with your new password.</Notice>}
              {q.verified && <Notice tone="ok">Email confirmed. Sign in to open your console.</Notice>}
              {gMsg && <Notice tone="alert">{gMsg}</Notice>}
              {emailMode ? (
                <EmailSignInForm next={next} />
              ) : (
                <>
                  <LoginForm next={next} />
                  {emailSignInOn && (
                    <Link href={`/login?${new URLSearchParams({ mode: "email", ...(next ? { next } : {}) })}`} className="self-start py-1 text-[13px] text-accent no-underline">
                      Email me a code or sign-in link instead
                    </Link>
                  )}
                </>
              )}
            </>
          )}
          <p className="text-xs text-[#a99f8c]">New to FITRON? <a href="/#pricing" className="text-[#cfa94f] underline">See plans and pricing</a></p>
          <p className="flex flex-wrap gap-x-3 gap-y-1 border-t border-[rgba(243,237,224,0.1)] pt-3 text-xs text-[#a99f8c]">
            <a href="/" className="text-[#cfa94f] underline">Back to fitron.in</a>
          </p>
        </div>
      </section>
      <CookieBanner />
    </main>
  );
}
