import { redirect } from "next/navigation";
import { getCrmUser } from "@/lib/auth/crm";
import { confirmEmployeeEmail } from "@/lib/services/crm-auth";
import "../crm/crm.css";
import { AuthCard } from "./auth-card";

export const metadata = { title: "Employee sign in · FITRON CRM", robots: { index: false, follow: false } };

const POINTS = [
  ["20%", "Commission in your first month"],
  ["Salary + 5%", "Monthly salary and incentive after"],
  ["2nd", "Payout date, every month"],
];

/** The team's own sign-in and account page: separate from the gym console's, and the way into /crm. */
export default async function EmployeeLogin({ searchParams }: PageProps<"/employee-login">) {
  const q = await searchParams;
  if (await getCrmUser()) redirect("/crm");
  const str = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : "");
  let initial: "login" | "signup" | "reset" = str("mode") === "signup" ? "signup" : "login";
  let notice: string | undefined;
  const verify = str("verify");
  if (verify) notice = (await confirmEmployeeEmail({ token: verify })) ? "Email confirmed. Sign in." : "That link has expired or was already used. Sign in, or ask for a new code.";
  const resetToken = str("reset");
  if (resetToken) initial = "reset";
  return (
    <div className="crm flex min-h-screen flex-col">
      <header className="flex items-center justify-between gap-4 px-[clamp(20px,5vw,72px)] py-[22px]">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- the site's own static logo */}
          <img src="/site/fitron-ring-v2.png" alt="" width={42} height={42} className="block rounded-full" />
          <span className="font-[var(--font-head)] text-[22px] font-semibold tracking-[0.06em]">FITRON</span>
        </div>
        <a href="https://www.fitron.in" className="text-[13px] text-[var(--muted)]">fitron.in ↗</a>
      </header>
      <main className="flex flex-1 flex-wrap items-center justify-center gap-[clamp(32px,6vw,96px)] px-[clamp(20px,5vw,72px)] pt-6 pb-16">
        <div className="flex max-w-[560px] min-w-0 flex-[1_1_min(420px,100%)] flex-col gap-[22px]">
          <span className="text-xs font-semibold tracking-[0.26em] text-[var(--accent)] uppercase">Sales &amp; Partnerships CRM · Team only</span>
          <h1 className="m-0 text-[clamp(40px,5.6vw,72px)] leading-[0.98] text-balance">Sell FITRON. Track every lead. Get paid on the 2nd.</h1>
          <p className="m-0 max-w-[480px] text-base leading-[1.7] text-[var(--muted)]">The workspace for FITRON&apos;s sales and marketing team: manage gym leads, close Gym Accounting and Gym Partnership deals, and see your commission as deals are verified.</p>
          <div className="grid max-w-[520px] grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
            {POINTS.map(([big, small]) => (
              <div key={big} className="flex flex-col gap-0.5 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] px-4 py-3.5">
                <span className="font-[var(--font-head)] text-2xl font-semibold text-[var(--accent-strong)]">{big}</span>
                <span className="text-xs text-[var(--muted)]">{small}</span>
              </div>
            ))}
          </div>
        </div>
        <AuthCard initial={initial} notice={notice} resetToken={resetToken || undefined} />
      </main>
      <footer className="px-[clamp(20px,5vw,72px)] py-[18px] text-xs text-[var(--faint)]">© 2026 FITRON · Internal use only. Compliant with the Digital Personal Data Protection Act, 2023.</footer>
    </div>
  );
}
