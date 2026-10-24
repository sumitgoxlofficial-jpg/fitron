import { forbidden } from "next/navigation";
import { requireCrm } from "@/lib/auth/crm";
import { DATE_RANGES } from "@/lib/domain/crm";
import { assignees } from "@/lib/services/crm-leads";
import { listCampaigns } from "@/lib/services/crm-people";
import { reportView } from "@/lib/services/crm-insights";
import { formatRupees } from "@/lib/format";
import { Button, Select } from "@/components/ui";
import { Donut, TrendChart } from "../charts";
import { pctText } from "../parts";

export const metadata = { title: "Reports · FITRON CRM" };

const Panel = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="flex flex-col gap-3.5 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5"><h2 className="m-0 text-base">{title}</h2>{children}</section>
);
const Bar = ({ label, w, right }: { label: string; w: number; right: string }) => (
  <div className="grid grid-cols-[150px_minmax(0,1fr)_90px] items-center gap-2.5 text-[13px]"><span className="text-[var(--muted)]">{label}</span><div className="h-2.5 rounded-full bg-[var(--line-soft)]"><div className="h-full rounded-full bg-gradient-to-r from-[#a9791f] to-[#d9b45a]" style={{ width: `${Math.max(2, w)}%` }} /></div><span className="text-right tabular-nums">{right}</span></div>
);

export default async function ReportsPage({ searchParams }: PageProps<"/crm/reports">) {
  const u = await requireCrm();
  if (u.role === "sales") forbidden();
  const sp = await searchParams;
  const g = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const f = { range: g("range"), product: g("product"), campaignId: g("campaign"), ownerId: g("owner") };
  const [r, people, campaigns] = await Promise.all([reportView(u, f), assignees(u), listCampaigns()]);
  const k = r.kpi;
  const topFunnel = Math.max(1, r.funnel[0]!.n);
  const topStage = Math.max(1, ...r.stageValue.map((s) => s.value));
  const topLoss = Math.max(1, ...r.loss.map((l) => l[1]));
  const qs = new URLSearchParams(Object.entries({ range: f.range, product: f.product, campaign: f.campaignId, owner: f.ownerId }).filter(([, v]) => v)).toString();
  const tiles: [string, string, string][] = [
    ["Leads", String(k.total), "In this period"],
    ["Contact rate", pctText(k.leadToContact), `${k.contacted} of ${k.total} contacted`],
    ["Demo rate", pctText(k.contactToDemo), `${k.demos} demos done`],
    ["Win rate", pctText(k.conversion), `${k.verifiedWon} won · ${k.lost} lost`],
    ["Verified revenue", formatRupees(k.verifiedRevenue), `${formatRupees(k.pendingValue)} pending, excluded`],
    ["Avg deal size", formatRupees(k.avgDeal), "Verified deals"],
  ];
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2"><span className="text-[11px] font-semibold tracking-[0.24em] text-[var(--accent)] uppercase">{u.can("leads.all") ? "All leads" : "Your team"}</span><h1 className="m-0">Reports</h1><span className="text-[13px] text-[var(--muted)]">Every figure is worked out from the lead records. Revenue counts approved deals only; filters apply to the lead&apos;s creation date.</span></div>
        {u.can("leads.export") && <a href={`/api/crm/report?${qs}`} className="inline-flex min-h-10 items-center rounded-xl border border-[var(--line-2)] px-4 text-[13px] font-semibold hover:border-[var(--accent)]">Export report</a>}
      </div>
      <form className="flex flex-wrap items-center gap-2.5">
        <Select name="range" defaultValue={f.range} aria-label="Date range" className="w-auto!">{DATE_RANGES.map(([v, l]) => <option key={v} value={v === "all" ? "" : v}>{l}</option>)}</Select>
        <Select name="product" defaultValue={f.product} aria-label="Product" className="w-auto!"><option value="">All products</option><option value="SaaS">Gym Accounting SaaS</option><option value="Partnership">Gym Partnership</option></Select>
        <Select name="campaign" defaultValue={f.campaignId} aria-label="Campaign" className="w-auto!"><option value="">All campaigns</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Select name="owner" defaultValue={f.ownerId} aria-label="Employee" className="w-auto!"><option value="">All employees</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        <Button>Apply</Button>
      </form>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
        {tiles.map(([l, v, n]) => <div key={l} className="flex flex-col gap-1.5 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-[18px] py-4"><span className="text-[11px] font-semibold tracking-[0.12em] text-[var(--muted)] uppercase">{l}</span><span className="font-[var(--font-head)] text-[28px] leading-[1.1] font-medium">{v}</span><span className="text-xs text-[var(--faint)]">{n}</span></div>)}
      </div>
      <Panel title="Pipeline vs verified revenue"><TrendChart trend={r.trend} /></Panel>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Panel title="Funnel">
          {r.funnel.map((x) => (
            <div key={x.label} className="grid grid-cols-[120px_minmax(0,1fr)_56px] items-center gap-2.5 text-[13px]"><span className="text-[var(--muted)]">{x.label}</span><div className="h-[26px] overflow-hidden rounded-lg bg-[var(--line-soft)]"><div className="flex h-full items-center rounded-lg bg-gradient-to-r from-[#a9791f] to-[#d9b45a] px-2.5 text-xs font-bold text-[#17140d]" style={{ width: `${Math.max(6, (x.n / topFunnel) * 100)}%` }}>{x.n}</div></div><span className="text-right text-xs text-[var(--muted)]">{x.conv == null ? "" : `${x.conv}%`}</span></div>
          ))}
          <span className="text-xs text-[var(--faint)]">Right column: conversion from the previous step.</span>
        </Panel>
        <Panel title="Open pipeline by product"><Donut total={formatRupees(r.mix.total)} items={[{ name: "Gym Accounting SaaS", value: r.mix.saas, color: "#d9b45a" }, { name: "Gym Partnership", value: r.mix.partner, color: "#a9791f" }]} /></Panel>
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Panel title="Why deals are lost">{r.loss.length === 0 ? <span className="text-[13px] text-[var(--faint)]">No lost deals in this period.</span> : r.loss.map(([l, n]) => <Bar key={l} label={l} w={(n / topLoss) * 100} right={String(n)} />)}</Panel>
        <Panel title="Open pipeline by stage">{r.stageValue.map((s) => <Bar key={s.stage} label={`${s.label} · ${s.n}`} w={(s.value / topStage) * 100} right={formatRupees(s.value)} />)}</Panel>
      </div>
      <Panel title="Source effectiveness">
        <div role="region" aria-label="Table" tabIndex={0} className="overflow-x-auto"><table className="w-full min-w-[720px] text-[13px]">
          <thead><tr className="border-b border-[var(--line-2)] text-left text-[11px] font-semibold tracking-[0.12em] text-[var(--muted)] uppercase">{["Source", "Leads", "Contacted", "Demos", "Won", "Verified rev."].map((h) => <th key={h} className="py-2 pr-2.5">{h}</th>)}</tr></thead>
          <tbody>{r.sources.map((s) => <tr key={s.source} className="border-b border-[var(--line-soft)]"><td className="py-2.5 pr-2.5 font-semibold">{s.source}</td><td>{s.leads}</td><td>{s.contacted}</td><td>{s.demos}</td><td>{s.won}</td><td className="tabular-nums">{formatRupees(s.revenue)}</td></tr>)}</tbody>
        </table></div>
      </Panel>
    </section>
  );
}
