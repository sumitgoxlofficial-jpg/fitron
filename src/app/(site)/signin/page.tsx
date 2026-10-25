import Image from "next/image";
import { DEFAULT_PLAN, TRIAL_DAYS } from "@/lib/domain/pricing";
import { GYM_SIGNIN_HREF, gymSignupHref } from "@/lib/domain/site-links";
import { Logo } from "@/components/logo";

export const metadata = { title: "Sign in · FITRON", description: "Sign in to FITRON Gym Accounting." };

export default function SignInChoice() {
  return (
    <div className="s-card grid overflow-hidden lg:grid-cols-[1fr_1.05fr]">
      <aside aria-label="About FITRON" className="relative hidden flex-col justify-between gap-8 border-r border-line bg-[linear-gradient(160deg,var(--accent-soft),transparent_70%)] p-10 lg:flex">
        <div>
          <Logo size={40} />
          <p className="mt-8 max-w-sm font-[family-name:var(--font-head)] text-3xl leading-tight font-semibold uppercase">One FITRON for the person training and the gym they train in.</p>
        </div>
        <div className="flex flex-1 items-center">
          <div className="s-dev">
            <div className="s-dev-laptop">
              <div className="s-dev-lid">
                <div className="s-dev-screen">
                  <Image src="/site/gym-dashboard.webp" alt="FITRON Gym Accounting dashboard on a laptop" width={1440} height={900} sizes="440px" />
                </div>
              </div>
              <div className="s-dev-base" aria-hidden="true" />
            </div>
            <div className="s-dev-phone">
              <div className="s-dev-body">
                <span className="s-dev-cam" aria-hidden="true" />
                <div className="s-dev-pscreen">
                  <Image src="/site/app-home.webp" alt="FITRON AI Trainer app on a phone" width={488} height={987} sizes="130px" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div className="p-6 sm:p-10">
        <div className="lg:hidden">
          <Logo size={32} />
        </div>
        <h1 className="mt-6 text-4xl sm:text-5xl lg:mt-0">Sign in to FITRON</h1>
        <p className="mt-3 max-w-md text-muted">Sign in to your FITRON Gym Accounting console.</p>
        <div className="mt-8 grid gap-4">
          <section aria-labelledby="signin-gym" className="s-card flex flex-col gap-1 p-5">
            <p className="s-eyebrow">For gym owners and staff</p>
            <h2 id="signin-gym" className="mt-1 text-2xl font-semibold">Gym Accounting</h2>
            <p className="text-sm text-muted">Members, renewals, GST invoices, payments, expenses and reports for your gym.</p>
            <a href={GYM_SIGNIN_HREF} data-track="signin_click" data-track-from="signin-gym" className="s-btn s-btn-primary mt-4">
              Sign in to Gym Accounting
            </a>
            <p className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
              <a href={gymSignupHref({ plan: DEFAULT_PLAN })} className="min-h-6 text-accent underline">
                Create account · {TRIAL_DAYS}-day free trial
              </a>
              <a href="/forgot-password" className="min-h-6 text-muted underline">
                Forgot password?
              </a>
            </p>
          </section>
        </div>
        <p className="mt-6 text-sm text-muted">
          <b className="text-fg">Stay safe:</b> FITRON never asks for your password, an OTP or a card number on WhatsApp, e-mail or the phone.
        </p>
        <p className="mt-3 text-sm text-muted">
          By signing in you agree to our{" "}
          <a href="/terms" className="underline">
            Terms
          </a>{" "}
          and our{" "}
          <a href="/privacy" className="underline">
            Privacy Policy
          </a>
          .
        </p>
      </div>
    </div>
  );
}
