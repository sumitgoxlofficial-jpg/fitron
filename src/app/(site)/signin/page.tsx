import Image from "next/image";
import { DEFAULT_PLAN, TRIAL_DAYS } from "@/lib/domain/pricing";
import { GYM_SIGNIN_HREF, TRAINER_HREF, gymSignupHref, trainerHref } from "@/lib/domain/site-links";
import { Logo } from "@/components/logo";

export const metadata = { title: "Sign in · FITRON", description: "Sign in to FITRON Gym Accounting or the FITRON AI Trainer." };

// The sign-in link on fitron.in opens here: one product is for gym owners and staff, the other for their
// members, and each has its own sign-in. Desktop: the brand on the left, the two sign-ins on the right.
// Phones: only the sign-ins.
const choices = [
  {
    who: "For gym owners and staff",
    name: "Gym Accounting",
    text: "Members, renewals, GST invoices, payments, expenses and reports for your gym.",
    signin: GYM_SIGNIN_HREF,
    signinLabel: "Sign in to Gym Accounting",
    trial: gymSignupHref({ plan: DEFAULT_PLAN }),
    forgot: "/forgot-password",
  },
  {
    who: "For members",
    name: "AI Trainer",
    text: "Your workout plan, Indian meal plan and a 24/7 AI coach, on your phone.",
    signin: TRAINER_HREF,
    signinLabel: "Sign in to the AI Trainer",
    trial: trainerHref("ai-pro"),
    forgot: null,
  },
] as const;

export default function SignInChoice() {
  return (
    <div className="s-card grid overflow-hidden lg:grid-cols-[1fr_1.05fr]">
      <aside aria-label="About FITRON" className="relative hidden flex-col justify-between gap-8 border-r border-line bg-[linear-gradient(160deg,var(--accent-soft),transparent_70%)] p-10 lg:flex">
        <div>
          <Logo size={40} />
          <p className="mt-8 max-w-sm font-[family-name:var(--font-head)] text-3xl leading-tight font-semibold uppercase">One FITRON for the person training and the gym they train in.</p>
        </div>
        <div className="relative h-56">
          <Image src="/site/console-dashboard.webp" alt="FITRON Gym Accounting dashboard" width={1400} height={658} sizes="360px" className="absolute top-0 right-0 w-[78%] rounded-xl border border-line shadow-lg" />
          <Image src="/site/app-dashboard.webp" alt="FITRON AI Trainer app" width={575} height={987} sizes="140px" className="absolute bottom-0 left-0 w-[30%] rounded-2xl border border-line shadow-lg" />
        </div>
      </aside>

      <div className="p-6 sm:p-10">
        <div className="lg:hidden">
          <Logo size={32} />
        </div>
        <h1 className="mt-6 text-4xl sm:text-5xl lg:mt-0">Sign in to FITRON</h1>
        <p className="mt-3 max-w-md text-muted">Choose where you want to go. Gym owners and members have their own sign-ins.</p>
        <div className="mt-8 grid gap-4">
          {choices.map((c) => (
            <section key={c.name} aria-labelledby={`signin-${c.name}`} className="s-card flex flex-col gap-1 p-5">
              <p className="s-eyebrow">{c.who}</p>
              <h2 id={`signin-${c.name}`} className="mt-1 text-2xl font-semibold">
                {c.name}
              </h2>
              <p className="text-sm text-muted">{c.text}</p>
              <a href={c.signin} data-track="signin_click" data-track-from={`signin-${c.name}`} className="s-btn s-btn-primary mt-4">
                {c.signinLabel}
              </a>
              <p className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
                <a href={c.trial} className="min-h-6 text-accent underline">
                  Create account · {TRIAL_DAYS}-day free trial
                </a>
                {c.forgot && (
                  <a href={c.forgot} className="min-h-6 text-muted underline">
                    Forgot password?
                  </a>
                )}
              </p>
            </section>
          ))}
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
