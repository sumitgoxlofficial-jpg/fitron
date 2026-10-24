import { requireCrm } from "@/lib/auth/crm";
import { ADDONS_LIST, AI_REFERENCE, PRICE_SECTIONS, commissionAt, planOf } from "@/lib/domain/crm-plans";
import { formatRupees } from "@/lib/format";

export const metadata = { title: "Price list · FITRON CRM" };
const inr = (paise: number) => formatRupees(paise);
const gold = "font-[var(--font-head)] text-4xl leading-none font-semibold text-[var(--accent-strong)]";

export default async function PricingPage() {
  const u = await requireCrm();
  const note = u.role === "sales" ? "20% commission in your first month, then salary plus up to 5% incentive on verified sales." : "Sales commission: 20% in the first month after joining, then salary plus up to 5% incentive on verified sales.";
  return (
    <section className="flex flex-col gap-9">
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold tracking-[0.24em] text-[var(--accent)] uppercase">From fitron.in</span>
        <h1 className="m-0">Price list</h1>
        <span className="max-w-[720px] text-[13px] text-[var(--muted)]">Prices in rupees, inclusive of 18% GST. 7-day free trial on Gym Accounting, no card needed. Yearly plans are billed upfront. {note}</span>
      </div>
      {PRICE_SECTIONS.map((sec) => (
        <div key={sec.title} className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1"><h2 className="m-0 text-2xl">{sec.title}</h2><span className="text-[13px] text-[var(--muted)]">{sec.note}</span></div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-3.5">
            {sec.plans.map((p) => {
              const plan = planOf(p.key);
              const m = commissionAt(plan.price.MONTHLY);
              const y = commissionAt(plan.price.YEARLY);
              return (
                <div key={p.key} className={`flex flex-col gap-2.5 rounded-[22px] border bg-[var(--surface)] p-[22px] ${p.recommended ? "border-[var(--line-2)]" : "border-[var(--line)]"}`}>
                  <div className="flex items-center justify-between gap-2"><h3 className="m-0 text-xl">{p.name}</h3>{p.recommended && <span className="rounded-full bg-gradient-to-b from-[#f3d88f] via-[#d9b45a] to-[#c49a3c] px-2.5 py-0.5 text-[10px] font-bold tracking-[0.08em] text-[#17140d] uppercase">Recommended</span>}</div>
                  <span className="text-[13px] text-[var(--muted)]">{p.desc}</span>
                  <div className="flex items-baseline gap-1.5"><span className={gold}>{inr(plan.price.MONTHLY)}</span><span className="text-[13px] text-[var(--muted)]">/ month</span></div>
                  <span className="text-[13px]">{inr(plan.price.YEARLY)} / year <span className="text-[var(--faint)]">· ≈ {inr(Math.round(plan.price.YEARLY / 12))} / month · 2 months free</span></span>
                  <div className="flex flex-col gap-0.5 rounded-[10px] bg-[var(--accent-soft)] px-3 py-2.5 text-xs">
                    <span className="font-semibold text-[var(--accent-strong)]">First month (20%): {inr(m.first)} monthly · {inr(y.first)} yearly</span>
                    <span className="text-[var(--text-2)]">Incentive (up to 5%): {inr(m.incentive)} · {inr(y.incentive)}</span>
                  </div>
                  <div className="mt-0.5 flex flex-col gap-1">{p.features.map((f) => <span key={f} className="text-xs text-[var(--text-2)]">— {f}</span>)}</div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-1"><h2 className="m-0 text-2xl">AI Trainer (reference)</h2><span className="text-[13px] text-[var(--muted)]">Sold to members directly on fitron.in, not through this CRM, so no sales commission applies. Shown so you can explain partner earnings.</span></div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-3.5">
          {AI_REFERENCE.map((p, i) => (
            <div key={p.name} className="flex flex-col gap-2.5 rounded-[22px] border border-[var(--line)] bg-[var(--surface)] p-[22px]">
              <h3 className="m-0 text-xl">{p.name}</h3><span className="text-[13px] text-[var(--muted)]">{p.desc}</span>
              <div className="flex items-baseline gap-1.5"><span className={gold}>{i === 0 ? "₹299" : "₹499"}</span><span className="text-[13px] text-[var(--muted)]">/ month</span></div>
              <span className="text-[13px]">{i === 0 ? "₹1,999" : "₹4,999"} / year</span>
              <div className="flex flex-col gap-1">{p.features.map((f) => <span key={f} className="text-xs text-[var(--text-2)]">— {f}</span>)}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        <h2 className="m-0 text-2xl">Add-ons</h2>
        <div className="flex flex-col rounded-[14px] border border-[var(--line)] bg-[var(--surface)] px-4 py-1">
          {ADDONS_LIST.map((a) => {
            const c = a.price == null ? null : commissionAt(a.price);
            return (
              <div key={a.name} className="flex flex-wrap justify-between gap-2.5 border-b border-[var(--line-soft)] py-[11px] text-[13px] last:border-0">
                <span className="flex-[1_1_220px]"><b>{a.name}</b> <span className="text-[var(--faint)]">· {a.kind}</span></span>
                <span className="flex-[0_0_130px] text-[var(--accent-strong)]">{a.price == null ? "Usage-based" : `${a.from ? "from " : ""}${inr(a.price)}${a.per ? ` ${a.per}` : ""}`}</span>
                <span className="flex-[0_0_200px] text-[var(--muted)]">{c == null ? "No commission" : a.from ? "20% first month · up to 5% after, on quoted price" : `20%: ${inr(c.first)} · 5%: ${inr(c.incentive)}${a.per ? ` ${a.per}` : ""}`}</span>
              </div>
            );
          })}
        </div>
        <span className="max-w-[760px] text-xs text-[var(--faint)]">All prices are FITRON&apos;s proposed launch prices. WhatsApp messaging has usage limits and charges. Partner revenue share (70% to the gym) depends on eligibility, deductions, refunds, chargebacks, verification and the signed agreement, and is not guaranteed income.</span>
      </div>
    </section>
  );
}
