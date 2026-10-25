import { requireCrm } from "@/lib/auth/crm";
import { analytics, type FunnelRow } from "@/lib/services/gym-intel/analytics";
import { SOURCES, type SourceKey } from "@/lib/domain/gym-intel/sources";
import { Card, Empty, Notice, PageHeader, ScrollRegion, TABLE, TD, TH, TR } from "@/components/ui";
import { Kpi, KpiGrid } from "../../parts";

export const metadata = { title: "Sales analytics · FITRON CRM" };

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

function Table({ title, first, rows, named }: { title: string; first: string; rows: FunnelRow[]; named?: (k: string) => string }) {
  return (
    <Card title={title}>
      {rows.length === 0 ? <Empty>Nothing yet.</Empty> : (
        <ScrollRegion label={title}>
          <table className={TABLE}>
            <thead><tr><th className={TH}>{first}</th><th className={`${TH} text-right`}>Gyms</th><th className={`${TH} text-right`}>Leads</th><th className={`${TH} text-right`}>Assigned</th><th className={`${TH} text-right`}>Contacted</th><th className={`${TH} text-right`}>Demos</th><th className={`${TH} text-right`}>Closed</th><th className={`${TH} text-right`}>Lead → closed</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.key + r.label} className={TR}><td className={TD}>{named ? named(r.label) : r.label}</td><td className={`${TD} text-right tabular-nums`}>{r.gyms || "—"}</td><td className={`${TD} text-right tabular-nums`}>{r.leads}</td><td className={`${TD} text-right tabular-nums`}>{r.assigned}</td><td className={`${TD} text-right tabular-nums`}>{r.contacted}</td><td className={`${TD} text-right tabular-nums`}>{r.demos}</td><td className={`${TD} text-right tabular-nums`}>{r.closed}</td><td className={`${TD} text-right tabular-nums`}>{pct(r.closed, r.leads)}</td></tr>)}</tbody>
          </table>
        </ScrollRegion>
      )}
    </Card>
  );
}

export default async function AnalyticsPage() {
  const u = await requireCrm("intel.view");
  const a = await analytics(u);
  const t = a.totals;
  return (
    <>
      <PageHeader kicker="Gym Intelligence" title="Sales analytics" subtitle="From discovery to a closed sale. A discovered phone number is never counted as a sale: “closed” is a deal a manager or the Super Admin verified in the CRM." />
      <KpiGrid>
        <Kpi label="Gyms discovered" value={t.discovered.toLocaleString("en-IN")} />
        <Kpi label="With a phone" value={t.withPhone.toLocaleString("en-IN")} hint={pct(t.withPhone, t.discovered) + " of gyms"} />
        <Kpi label="Promoted to leads" value={t.promoted.toLocaleString("en-IN")} hint={pct(t.promoted, t.withPhone) + " of gyms with a phone"} />
        <Kpi label="Assigned" value={t.assigned.toLocaleString("en-IN")} hint={pct(t.assigned, t.promoted) + " of leads"} />
        <Kpi label="Contacted" value={t.contacted.toLocaleString("en-IN")} hint={pct(t.contacted, t.promoted) + " of leads"} />
        <Kpi label="Demos" value={t.demos.toLocaleString("en-IN")} hint={pct(t.demos, t.contacted) + " of contacted"} />
        <Kpi label="Sales closed" value={t.closed.toLocaleString("en-IN")} hint="Verified deals only" />
        <Kpi label="Flagged as duplicates" value={t.flagged.toLocaleString("en-IN")} />
      </KpiGrid>
      <div className="mb-5"><Notice tone="accent">Discovery status (this module) and the sales pipeline (the CRM) are separate. Pipeline stages are the CRM&apos;s own: New Lead → Contacted → Interested → Demo Scheduled → Demo Completed → Negotiation → Closed Won / Closed Lost / Disqualified. “Do not contact” numbers are blocked from promotion; a lead that turns out to be an invalid contact is closed as Disqualified.</Notice></div>
      <div className="flex flex-col gap-5">
        <Table title="By source (a gym with evidence from two sources counts under both)" first="Source" rows={a.bySource} named={(k) => SOURCES[k as SourceKey]?.name ?? k} />
        <Table title="By state" first="State" rows={a.byState} />
        <Table title="By employee" first="Employee" rows={a.byOwner} />
      </div>
    </>
  );
}
