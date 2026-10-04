import { DEFAULT_PLAN, TRIAL_DAYS } from "@/lib/domain/pricing";
import { GYM_SIGNIN_HREF, TRAINER_HREF, gymSignupHref, trainerHref } from "@/lib/domain/site-links";

export const metadata = { title: "Sign in · FITRON", description: "Sign in to FITRON Gym Accounting or the FITRON AI Trainer." };

// The sign-in link on fitron.in opens here: one product is for gym owners and staff, the other for their
// members, and each has its own sign-in.
const choices = [
  {
    who: "For gym owners and staff",
    name: "Gym Accounting",
    text: "Members, renewals, GST invoices, payments, expenses and reports for your gym.",
    signin: GYM_SIGNIN_HREF,
    signinLabel: "Sign in to Gym Accounting",
    trial: gymSignupHref({ plan: DEFAULT_PLAN }),
  },
  {
    who: "For members",
    name: "AI Trainer",
    text: "Your workout plan, Indian meal plan and a 24/7 AI coach, on your phone.",
    signin: TRAINER_HREF,
    signinLabel: "Sign in to the AI Trainer",
    trial: trainerHref("ai-pro"),
  },
] as const;

export default function SignInChoice() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-4xl leading-tight font-semibold sm:text-5xl">Sign in to FITRON</h1>
      <p className="mt-3 max-w-lg text-lg text-muted">Choose where you want to go. Gym owners and members have their own sign-ins.</p>
      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        {choices.map((c) => (
          <section key={c.name} className="flex flex-col rounded-xl border border-line bg-surface p-5 sm:p-6">
            <p className="text-xs font-semibold tracking-[0.2em] text-accent uppercase">{c.who}</p>
            <h2 className="mt-2 text-2xl font-semibold">{c.name}</h2>
            <p className="mt-2 flex-1 text-muted">{c.text}</p>
            <a href={c.signin} className="mt-5 inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-4 text-[15px] font-semibold text-accent-ink">
              {c.signinLabel}
            </a>
            <a href={c.trial} className="mt-3 text-center text-sm text-accent underline">
              New here? Start your {TRIAL_DAYS}-day free trial
            </a>
          </section>
        ))}
      </div>
    </div>
  );
}
