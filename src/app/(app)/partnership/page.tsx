import Link from "next/link";
import { requireFeature, requirePermission } from "@/lib/auth/current";
import { ensureTrainerCode, partnership } from "@/lib/services/trainer-gym";
import { todayIso } from "@/lib/services/time";
import { findPlan, PARTNER_SHARE, rupeesLabel } from "@/lib/domain/pricing";
import { Badge, Card, Empty, ListHeader, Notice, Stat, TABLE, TD, TH, TR, type Tone, ScrollRegion } from "@/components/ui";
import { fmtMonthShort, fmtShort, fmtStamp, formatRupees } from "@/lib/format";
import { appUrl } from "@/lib/services/accounts";

export const metadata = { title: "Gym Partnership · Fitron" };

const ACCESS: Record<string, [string, Tone]> = { ACTIVE: ["Paid", "ok"], TRIAL: ["Free trial", "accent"], LOCKED: ["No plan", "neutral"] };

/** Members of this gym who use the AI Trainer, and the gym's share of what they pay FITRON. */
export default async function PartnershipPage({ searchParams }: PageProps<"/partnership">) {
  await requirePermission("accounting.view");
  const u = await requireFeature("partnership");
  const sp = await searchParams;
  const today = todayIso();
  const thisMonth = today.slice(0, 7);
  const month = typeof sp.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : thisMonth;
  const [code, data] = await Promise.all([ensureTrainerCode(u.orgId), partnership(u, month, today)]);
  const link = `${appUrl()}/trainer?gym=${code}`;
  const prev = (ym: string, n: number) => {
    const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1));
    return d.toISOString().slice(0, 7);
  };
  const months = [0, -1, -2, -3, -4, -5].map((n) => prev(thisMonth, n));
  const pct = Math.round(PARTNER_SHARE * 100);

  return (
    <div className="flex flex-col gap-6 pt-4">
      <ListHeader kicker="FITRON AI Trainer" title="Gym Partnership" />
      <Notice tone="accent">
        Members who link their AI Trainer to your gym with code <strong className="font-mono text-base tracking-wider">{code}</strong> show their training here, next to their membership. You earn {pct}% of the listed price of what they pay FITRON for the AI Trainer while linked. Share this link with them:{" "}
        <a className="underline" href={link} target="_blank" rel="noopener">
          {link}
        </a>
      </Notice>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-6">
        <Stat label="Linked members" value={data.totals.members} />
        <Stat label="Paying" value={data.totals.active} />
        <Stat label="On free trial" value={data.totals.trial} />
        <Stat label={`Paid to FITRON · ${fmtMonthShort(month)}`} value={formatRupees(data.totals.base)} />
        <Stat label={`Your ${pct}% · ${fmtMonthShort(month)}`} value={formatRupees(data.totals.share)} />
      </div>

      <div className="flex flex-wrap gap-2">
        {months.map((m) => (
          <Link key={m} href={`/partnership?month=${m}`} className={m === month ? "rounded-md bg-accent px-3 py-1.5 text-sm text-accent-ink" : "rounded-md bg-surface px-3 py-1.5 text-sm hover:bg-surface-2"}>
            {fmtMonthShort(m)} {m.slice(0, 4)}
          </Link>
        ))}
      </div>

      <Card title={`AI Trainer payments · ${fmtMonthShort(month)} ${month.slice(0, 4)}`}>
        {data.paid.length === 0 ? (
          <Empty>No AI Trainer payments from your members were confirmed this month.</Empty>
        ) : (
          <ScrollRegion label="Referred members">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH}>Paid on</th>
                  <th className={TH}>Member</th>
                  <th className={TH}>Plan</th>
                  <th className={TH}>Ref</th>
                  <th className={`${TH} text-right`}>Price paid</th>
                  <th className={`${TH} text-right`}>Your {pct}%</th>
                </tr>
              </thead>
              <tbody>
                {data.paid.map((p) => (
                  <tr key={p.id} className={TR}>
                    <td className={TD}>{fmtStamp(p.paidAt)}</td>
                    <td className={TD}>{p.member}</td>
                    <td className={TD}>
                      {findPlan(p.plan)?.name ?? p.plan} · {p.cycle === "YEARLY" ? "yearly" : "monthly"}
                      {p.periodEnd ? <span className="text-muted"> · till {fmtShort(p.periodEnd)}</span> : null}
                    </td>
                    <td className={`${TD} font-mono text-xs`}>{p.ref}</td>
                    <td className={`${TD} text-right tabular-nums`}>{rupeesLabel(p.base)}</td>
                    <td className={`${TD} text-right font-semibold tabular-nums`}>{rupeesLabel(p.share)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}
        <p className="mt-3 text-xs text-muted">FITRON pays the month&apos;s share to the gym&apos;s bank account in the first week of the next month. Payments confirmed after a member leaves your gym are not counted.</p>
      </Card>

      <Card title={`Linked members · ${data.rows.length}`}>
        {data.rows.length === 0 ? (
          <Empty>No member has linked yet. Share the code above, or put it on a poster at the front desk.</Empty>
        ) : (
          <ScrollRegion label="Payouts">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH}>Member</th>
                  <th className={TH}>Gym record</th>
                  <th className={TH}>AI Trainer</th>
                  <th className={TH}>This week</th>
                  <th className={TH}>Streak</th>
                  <th className={TH}>Last seen</th>
                  <th className={TH}>Linked</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => {
                  const [label, tone] = ACCESS[r.access] ?? [r.access, "neutral" as Tone];
                  return (
                    <tr key={r.id} className={TR}>
                      <td className={TD}>
                        <div className="font-medium">{r.name || "—"}</div>
                        <div className="text-xs text-muted">{r.email}</div>
                      </td>
                      <td className={TD}>
                        {r.gymMember ? (
                          <Link className="underline" href={`/members/${r.gymMember.id}`}>
                            {r.gymMember.code} · {r.gymMember.name}
                          </Link>
                        ) : (
                          <span className="text-muted">Not matched to a member</span>
                        )}
                      </td>
                      <td className={TD}>
                        <Badge tone={tone}>{label}</Badge> <span className="text-xs text-muted">{findPlan(r.plan)?.name ?? r.plan}{r.paidUntil && r.access === "ACTIVE" ? ` · till ${fmtShort(r.paidUntil)}` : ""}</span>
                      </td>
                      <td className={`${TD} tabular-nums`}>
                        {r.weekWorkouts}/{r.weekPlanned} workouts
                      </td>
                      <td className={`${TD} tabular-nums`}>{r.streak ? `${r.streak} days` : "—"}</td>
                      <td className={TD}>{r.lastSeenAt ? fmtStamp(r.lastSeenAt) : "—"}</td>
                      <td className={TD}>{r.linkedAt ? fmtStamp(r.linkedAt) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollRegion>
        )}
        <p className="mt-3 text-xs text-muted">A member is matched to their gym record by the email they signed in with, or the phone they gave the app. Unmatched members are counted for your share all the same.</p>
      </Card>
    </div>
  );
}
