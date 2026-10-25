import Link from "next/link";
import { requireCrm } from "@/lib/auth/crm";
import { CALL_STATUSES, DISPOSITIONS, DISPOSITION_LABEL } from "@/lib/domain/ai-calling/constants";
import { CALL_PAGE, listCalls } from "@/lib/services/ai-calling/reports";
import { Card, Empty, Pager, PageHeader, ScrollRegion, Select, TABLE, TD, TH, TR, Button } from "@/components/ui";
import { CallStatusBadge, DispositionBadge, mmss, when } from "../parts";

export const metadata = { title: "AI calls · FITRON CRM" };

export default async function CallsPage({ searchParams }: PageProps<"/crm/calling/calls">) {
  const u = await requireCrm("calling.view");
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const f = { status: one("status") || undefined, disposition: one("disposition") || undefined, page: Number(one("page")) || 1 };
  const r = await listCalls(u, f);
  const qs = (p: number) => `/crm/calling/calls?${new URLSearchParams({ ...(f.status ? { status: f.status } : {}), ...(f.disposition ? { disposition: f.disposition } : {}), page: String(p) })}`;
  return (
    <>
      <PageHeader kicker="AI Calling" title="Call history" subtitle="Numbers are masked. A transcript is kept only while retention allows, with phone numbers and emails removed." />
      <form className="mb-4 flex flex-wrap items-center gap-2" method="get">
        <Select name="status" defaultValue={f.status ?? ""} aria-label="Status" className="w-auto!"><option value="">Any status</option>{CALL_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ").toLowerCase()}</option>)}</Select>
        <Select name="disposition" defaultValue={f.disposition ?? ""} aria-label="Result" className="w-auto!"><option value="">Any result</option>{DISPOSITIONS.map((d) => <option key={d} value={d}>{DISPOSITION_LABEL[d]}</option>)}</Select>
        <Button>Filter</Button>
      </form>
      <Card>
        {r.rows.length === 0 ? <Empty>No calls match.</Empty> : (
          <ScrollRegion label="Calls">
            <table className={TABLE}>
              <thead><tr><th className={TH}>Gym</th><th className={TH}>Number</th><th className={TH}>Status</th><th className={TH}>Result</th><th className={TH}>Length</th><th className={TH}>Owner</th><th className={TH}>When</th></tr></thead>
              <tbody>
                {r.rows.map((c) => (
                  <tr key={c.id} className={TR}>
                    <td className={TD}><Link href={`/crm/calling/calls/${c.id}`} className="font-semibold underline">{c.gymName}</Link>{c.test && <div className="text-xs text-[var(--muted)]">test call</div>}<div className="text-xs text-[var(--muted)]">{c.city}</div></td>
                    <td className={`${TD} tabular-nums`}>{c.phone}</td>
                    <td className={TD}><CallStatusBadge s={c.status} />{c.error && <div className="max-w-52 text-xs text-[var(--muted)]">{c.error}</div>}</td>
                    <td className={TD}><DispositionBadge d={c.disposition} /></td>
                    <td className={`${TD} tabular-nums`}>{mmss(c.durationSec)}</td>
                    <td className={TD}>{c.owner ?? "—"}</td>
                    <td className={`${TD} whitespace-nowrap`}>{when(c.dialedAt ?? c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}
      </Card>
      <div className="mt-4"><Pager page={r.page} pageSize={CALL_PAGE} total={r.total} href={qs} /></div>
    </>
  );
}
