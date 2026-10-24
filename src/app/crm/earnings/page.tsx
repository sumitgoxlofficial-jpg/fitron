import { requireCrm } from "@/lib/auth/crm";
import { forbidden } from "next/navigation";
import { earningsScope, earningsView } from "@/lib/services/crm-earnings";
import { FIRST_DAYS, INCENTIVE_MAX } from "@/lib/domain/crm-pay";
import { formatRupees, fmtDate, fmtShort } from "@/lib/format";
import { LinkButton } from "@/components/ui";
import { LeadLink } from "../parts";

export const metadata = { title: "Earnings · FITRON CRM" };

const Tile = ({ label, value, note, gold }: { label: string; value: string; note: string; gold?: boolean }) => (
  <div className="flex flex-col gap-1.5 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-[18px]">
    <span className="text-[11px] font-semibold tracking-[0.14em] text-[var(--muted)] uppercase">{label}</span>
    <span className={`font-[var(--font-head)] text-[32px] leading-[1.1] font-medium ${gold ? "text-[var(--accent-strong)]" : ""}`}>{value}</span>
    <span className="text-xs text-[var(--faint)]">{note}</span>
  </div>
);

export default async function EarningsPage() {
  const u = await requireCrm();
  if (!earningsScope(u)) forbidden();
  const e = await earningsView(u);
  const mine = e.scope === "self";
  const t = e.totals;
  const month = new Date().toLocaleDateString("en-IN", { month: "long", timeZone: "Asia/Kolkata" });
  const note = mine && e.me
    ? e.me.inFirstMonth
      ? `You're in your first month (joined ${fmtShort(e.me.joinedAt)}): ${Math.round(0.2 * 100)}% commission on verified sales until ${fmtShort(e.me.firstMonthEnds)}. After that you move to a monthly salary${e.me.salary ? ` of ${formatRupees(e.me.salary)}` : ""} plus a ${e.me.incentive}% incentive on verified sales.`
      : `You're on a monthly salary${e.me.salary ? ` of ${formatRupees(e.me.salary)}` : ""} plus a ${e.me.rateText} incentive on verified sales. Earnings count on the day a deal is verified.`
    : `First ${FIRST_DAYS} days after joining: 20% on verified sales. After that: monthly salary plus up to ${INCENTIVE_MAX}% incentive, set per employee. Earnings count on the day a deal is verified, and a pending deal earns nothing yet.`;
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold tracking-[0.24em] text-[var(--accent)] uppercase">{mine ? "Sales employee" : e.scope === "team" ? "Your team" : "All sales staff"}</span>
        <h1 className="m-0">{mine ? "My earnings" : "Commissions"}</h1>
        <span className="text-[13px] text-[var(--muted)]">{note}</span>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
        <Tile label="Today" value={formatRupees(t.today)} note={t.todayN ? `${t.todayN} deal${t.todayN > 1 ? "s" : ""} verified today` : "Nothing verified today yet"} gold />
        <Tile label="This month" value={formatRupees(t.month)} note={`Verified in ${month}`} />
        <Tile label="Total earned" value={formatRupees(t.total)} note={`${t.n} verified deal${t.n === 1 ? "" : "s"}`} />
        <Tile label="Pending" value={formatRupees(t.pending)} note={`${t.nPending} awaiting verification, not earned yet`} />
      </div>

      <div className={`flex flex-wrap items-center justify-between gap-4 rounded-[22px] border bg-gradient-to-br from-[var(--surface-2)] to-[var(--input)] p-[22px] ${mine && !e.payout.hasAccount ? "border-[var(--alert)]" : "border-[var(--line-2)]"}`}>
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold tracking-[0.22em] text-[var(--accent)] uppercase">Next payout · {fmtDate(e.payout.date)}</span>
          <span className="font-[var(--font-head)] text-[40px] leading-none font-semibold text-[var(--accent-strong)]">{formatRupees(e.payout.amount)}</span>
          {mine ? (
            <span className={`text-[13px] ${e.payout.hasAccount ? "text-[var(--text-2)]" : "text-[var(--alert-strong)]"}`}>{e.payout.hasAccount ? `To ${e.payout.account}` : "No payout account: add one to be paid"}</span>
          ) : (
            <span className="text-[13px] text-[var(--muted)]">{e.payout.held.length ? `${e.payout.held.length} employee${e.payout.held.length > 1 ? "s" : ""} on hold: ${e.payout.held.join(", ")}` : "Everyone has a payout account"}</span>
          )}
        </div>
        <div className="flex max-w-[380px] flex-col gap-2">
          <span className="text-xs leading-relaxed text-[var(--muted)]">
            {mine
              ? "Your salary (from day 31) and the commission verified this month are paid by the 2nd of next month. A refund or chargeback can be deducted from a later payout."
              : `Salaries ${formatRupees(e.payout.salaries)} + commission and incentives ${formatRupees(e.payout.commission)} for ${month}, due to employees' registered accounts by the 2nd. Payouts for employees without account details are held until they add them.`}
          </span>
          {mine && <LinkButton href="/crm/profile" className="self-start">{e.payout.hasAccount ? "Edit payout account" : "Add payout account"}</LinkButton>}
        </div>
      </div>

      {!mine && (
        <div className="flex flex-col gap-3 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-5">
          <h2 className="m-0">By employee</h2>
          <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-[13px]">
            <thead><tr className="border-b border-[var(--line-2)] text-left text-[11px] font-semibold tracking-[0.12em] text-[var(--muted)] uppercase">{["Employee", "Today", "This month", "Total earned", "Pending", "Payout"].map((h) => <th key={h} className="py-2 pr-2.5">{h}</th>)}</tr></thead>
            <tbody>{e.people.map((p) => (
              <tr key={p.userId} className="border-b border-[var(--line)]">
                <td className="py-2.5 pr-2.5 font-semibold">{p.name}</td><td>{formatRupees(p.today)}</td><td>{formatRupees(p.month)}</td><td className="text-[var(--accent-strong)]">{formatRupees(p.total)}</td><td className="text-[var(--muted)]">{formatRupees(p.pending)}</td>
                <td className={p.hasAccount ? "" : "text-[var(--alert-strong)]"}>{p.hasAccount ? formatRupees(p.due) : "On hold"}</td>
              </tr>))}</tbody>
          </table></div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <h2 className="m-0">Earnings statement</h2>
        {e.rows.length === 0 ? <div className="rounded-[14px] border border-dashed border-[var(--line-2)] px-5 py-8 text-center text-[var(--muted)]">No closed deals yet. Commission appears here once a Closed Won deal is submitted.</div> : (
          <div className="overflow-x-auto rounded-[14px] border border-[var(--line)] bg-[var(--surface)] px-4">
            <table className="w-full min-w-[940px] text-[13px]">
              <thead><tr className="border-b border-[var(--line-2)] text-left text-[11px] font-semibold tracking-[0.12em] text-[var(--muted)] uppercase">{["Date", "Gym", "Closed by", "Plan", "Sale", "Commission", "Status"].map((h) => <th key={h} className="py-3 pr-2.5">{h}</th>)}</tr></thead>
              <tbody>{e.rows.map((r) => (
                <tr key={r.id} className="border-b border-[var(--line-soft)]">
                  <td className="py-2.5 pr-2.5 text-[var(--faint)]">{r.date ? fmtShort(r.date) : "—"}</td>
                  <td className="pr-2.5 font-semibold"><LeadLink id={r.id}>{r.gym}</LeadLink></td>
                  <td className="pr-2.5 text-[var(--muted)]">{r.closer}</td><td className="pr-2.5">{r.plan}</td><td className="pr-2.5 tabular-nums">{formatRupees(r.sale)}</td>
                  <td className="pr-2.5 font-semibold text-[var(--accent-strong)] tabular-nums">{r.commission == null ? "—" : `${formatRupees(r.commission)} · ${Math.round(r.rate * 1000) / 10}%`}</td>
                  <td><span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${r.status === "Earned" ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]" : r.status === "Rejected" ? "bg-[var(--alert-soft)] text-[var(--alert)]" : "border border-[var(--line-2)] text-[var(--accent)]"}`}>{r.status}</span></td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
