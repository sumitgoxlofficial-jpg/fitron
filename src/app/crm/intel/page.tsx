import Link from "next/link";
import { requireCrm } from "@/lib/auth/crm";
import { overview } from "@/lib/services/gym-intel/gyms";
import { Card, Empty, Notice, PageHeader } from "@/components/ui";
import { Bars, Kpi, KpiGrid } from "../parts";
import { when } from "./parts";
import { SOURCES, type SourceKey } from "@/lib/domain/gym-intel/sources";

export const metadata = { title: "Gym Intelligence · FITRON CRM" };

export default async function IntelOverview() {
  const u = await requireCrm("intel.view");
  const o = await overview(u);
  const n = (x: number | null) => (x === null ? "—" : x.toLocaleString("en-IN"));
  return (
    <>
      <PageHeader kicker="Gym Intelligence" title="Overview" subtitle="Every figure is counted from the stored records." />
      {o.total === 0 && <div className="mb-5"><Notice tone="accent">Nothing has been collected yet. {u.can("intel.manage") ? <>Turn a source on in <Link href="/crm/intel/sources" className="underline">Sources &amp; integrations</Link>, then start a job in <Link href="/crm/intel/discovery" className="underline">Gym discovery</Link>.</> : "A Super Admin starts collection."}</Notice></div>}
      <KpiGrid>
        <Kpi label="Gyms discovered" value={n(o.total)} />
        <Kpi label="Unique public phones" value={n(o.uniquePhones)} hint="Business numbers a source published" />
        <Kpi label="Gyms with a phone" value={n(o.withPhone)} hint={o.total ? `${Math.round((o.withPhone / o.total) * 100)}% of gyms found` : undefined} />
        <Kpi label="Valid format" value={n(o.formatValid)} />
        <Kpi label="Source confirmed" value={n(o.confirmed)} hint="A source printed it" />
        <Kpi label="Awaiting verification" value={n(o.awaiting)} hint="Not checked by a person" />
        <Kpi label="Conflicting sources" value={n(o.conflicting)} tone={o.conflicting ? "alert" : undefined} />
        <Kpi label="Duplicates to review" value={n(o.openDups)} tone={o.openDups ? "alert" : undefined} />
        <Kpi label="States / UTs processed" value={`${o.statesProcessed} of ${o.statesTotal}`} />
        <Kpi label="Districts processed" value={n(o.districtsProcessed)} hint={o.districtsProcessed === null ? "Load the PIN directory" : undefined} />
        <Kpi label="PIN codes processed" value={n(o.pinsProcessed)} hint={o.pinTotal ? `of ${o.pinTotal.toLocaleString("en-IN")}` : "Load the PIN directory"} />
        <Kpi label="PIN codes remaining" value={n(o.pinsRemaining)} />
        <Kpi label="Jobs running" value={n(o.jobsRunning)} />
        <Kpi label="Failed jobs" value={n(o.jobsFailed)} tone={o.jobsFailed ? "alert" : undefined} />
        <Kpi label="Coverage" value={`${o.coveragePct}%`} hint={`of ${o.coverageBasis}`} />
        <Kpi label="Last successful collection" value={o.lastSuccess?.completedAt ? when(o.lastSuccess.completedAt) : "—"} />
      </KpiGrid>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card title="Gyms by source">
          {o.sources.length ? <Bars rows={o.sources.map((s) => [SOURCES[s.source as SourceKey]?.name ?? s.source, s.gyms])} /> : <Empty>No records yet.</Empty>}
        </Card>
        <Card title="Recent activity" action={u.can("intel.manage") ? <Link href="/crm/audit?kind=intel" className="text-sm underline">Audit log</Link> : undefined}>
          {o.recent.length ? <ul className="m-0 flex list-none flex-col divide-y divide-[var(--line-soft)] p-0">{o.recent.map((r) => <li key={r.id} className="py-2.5 text-sm">{r.text}<div className="text-xs text-[var(--muted)]">{when(r.at)}</div></li>)}</ul> : <Empty>Nothing yet.</Empty>}
        </Card>
      </div>
      <p className="mt-5 text-xs text-[var(--muted)]">A phone listed here is a gym&apos;s published business number. It is not proof the number works, and not the owner&apos;s direct line. Coverage never means every gym was found: a search with no results does not mean there are none.</p>
    </>
  );
}
