import Link from "next/link";
import { requireCrm } from "@/lib/auth/crm";
import { leaderboard } from "@/lib/services/crm-insights";
import { formatRupees, initials } from "@/lib/format";
import { pctText } from "../parts";

export const metadata = { title: "Leaderboard · FITRON CRM" };

const Avatar = ({ id, name, has, size }: { id: string; name: string; has: boolean; size: number }) =>
  has ? (
    // eslint-disable-next-line @next/next/no-img-element -- private, session-checked image
    <img src={`/api/crm/photo/${id}`} alt="" width={size} height={size} className="shrink-0 rounded-full border border-[var(--line-2)] object-cover" style={{ width: size, height: size }} />
  ) : (
    <span aria-hidden="true" className="grid shrink-0 place-items-center rounded-full border border-[var(--line-2)] bg-[var(--surface-2)] font-[var(--font-head)] font-semibold text-[var(--accent-strong)]" style={{ width: size, height: size, fontSize: size * 0.38 }}>{initials(name)}</span>
  );

export default async function LeaderboardPage({ searchParams }: PageProps<"/crm/leaderboard">) {
  const u = await requireCrm();
  const sp = await searchParams;
  const period = sp.period === "all" ? "all" : "month";
  const rows = await leaderboard(u, period);
  const top = rows.slice(0, 3);
  const place = ["1st", "2nd", "3rd"];
  const order = [1, 0, 2];
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2"><span className="text-[11px] font-semibold tracking-[0.24em] text-[var(--accent)] uppercase">Sales team</span><h1 className="m-0">Leaderboard</h1><span className="text-[13px] text-[var(--muted)]">Ranked by verified revenue. Pending deals don&apos;t count until they are approved.</span></div>
        <div className="flex gap-1 rounded-full border border-[var(--line)] p-1">
          {([["month", "This month"], ["all", "All time"]] as const).map(([k, l]) => <Link key={k} href={`/crm/leaderboard?period=${k}`} aria-current={period === k ? "true" : undefined} className={`inline-flex min-h-8 items-center rounded-full px-3.5 text-xs font-semibold ${period === k ? "bg-gradient-to-b from-[#f3d88f] via-[#d9b45a] to-[#c49a3c] text-[#17140d]" : ""}`}>{l}</Link>)}
        </div>
      </div>
      {rows.length === 0 ? <div className="rounded-2xl border border-dashed border-[var(--line-2)] p-8 text-center text-[var(--muted)]">No sales employees yet.</div> : (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] items-end gap-3.5">
            {top.map((r, i) => (
              <div key={r.userId} style={{ order: order.indexOf(i) }} className={`flex flex-col items-center gap-2 rounded-[20px] border bg-[var(--surface)] px-4 py-[22px] ${i === 0 ? "border-[var(--line-2)] pb-8" : "border-[var(--line)]"}`}>
                <span className={`text-[11px] font-bold tracking-[0.2em] uppercase ${i === 0 ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}>{place[i]}</span>
                <Avatar id={r.userId} name={r.name} has={r.hasPhoto} size={64} />
                <span className="font-semibold">{r.name}</span>
                <span className="font-[var(--font-head)] text-[26px] font-semibold text-[var(--accent-strong)]">{formatRupees(r.revenue)}</span>
                <span className="text-xs text-[var(--faint)]">{r.won} won · {pctText(r.conversion)} conversion</span>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead><tr className="border-b border-[var(--line-2)] text-left text-[11px] font-semibold tracking-[0.12em] text-[var(--muted)] uppercase">{["#", "Employee", "Verified rev.", "Won", "Calls", "Demos", "Conversion"].map((h) => <th key={h} className="py-2 pr-2.5">{h}</th>)}</tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.userId} className={`border-b border-[var(--line-soft)] ${r.userId === u.id ? "bg-[var(--accent-soft)]" : ""}`}>
                  <td className="py-2.5 pr-2.5 font-[var(--font-head)] text-base text-[var(--accent)]">{r.rank}</td>
                  <td className="pr-2.5"><span className="flex items-center gap-2.5"><Avatar id={r.userId} name={r.name} has={r.hasPhoto} size={30} /><b>{r.name}</b></span></td>
                  <td className="tabular-nums text-[var(--accent-strong)]">{formatRupees(r.revenue)}</td><td>{r.won}</td><td>{r.calls}</td><td>{r.demos}</td><td>{pctText(r.conversion)}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
