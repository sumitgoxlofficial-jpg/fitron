import Link from "next/link";
import { requireCrm } from "@/lib/auth/crm";
import { CRM_ROLE_LABEL, STALE_DAYS, stageLabel } from "@/lib/domain/crm";
import { WIDGET_LABEL, visible, type Widget } from "@/lib/domain/crm-dash";
import { dashboard, type DashboardData } from "@/lib/services/crm-reports";
import { assignees } from "@/lib/services/crm-leads";
import { getLayout } from "@/lib/services/crm-insights";
import { listCampaigns } from "@/lib/services/crm-people";
import { Button, Empty, ScrollRegion, Select, TABLE, TD, TH, TR } from "@/components/ui";
import { DATE_RANGES } from "@/lib/domain/crm";
import { fmtStamp, formatRupees } from "@/lib/format";
import { TrendChart } from "./charts";
import { DashControls } from "./dash-controls";
import { Bars, Kpi, KpiGrid, LeadLink, Money, pctText } from "./parts";
import { doneAction } from "./actions";
import type { CrmUser } from "@/lib/services/crm-access";

export const metadata = { title: "Dashboard · FITRON CRM" };

const Panel = ({ title, action, children, wide }: { title: string; action?: React.ReactNode; children: React.ReactNode; wide?: boolean }) => (
  <section className={`flex flex-col gap-3.5 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 ${wide ? "lg:col-span-2" : ""}`}>
    <div className="flex items-center justify-between gap-3"><h2 className="m-0 text-base">{title}</h2>{action}</div>
    {children}
  </section>
);

function stats(u: CrmUser, d: DashboardData): { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "alert" }[] {
  const k = d.kpi;
  const all = [
    { label: u.role === "sales" ? "My leads" : "Total leads", value: k.total, hint: `${k.contacted} contacted` },
    ...(u.role !== "sales" ? [{ label: "Lead → contact", value: pctText(k.leadToContact) }] : []),
    ...(u.role === "marketing" ? [{ label: "Contact → demo", value: pctText(k.contactToDemo) }, { label: "Demo → paid", value: pctText(k.demoToPaid) }] : []),
    ...(u.role !== "marketing" ? [{ label: "Open pipeline", value: <Money paise={k.openPipeline} />, hint: "Estimated, not revenue" }, { label: "Verified wins", value: k.verifiedWon, hint: `${k.lost} lost` }] : []),
    { label: "Verified revenue", value: <Money paise={k.verifiedRevenue} />, hint: "Approved deals only" },
    ...(u.role !== "marketing" ? [{ label: "Pending verification", value: <Money paise={k.pendingValue} />, hint: `${k.pendingCount} deal${k.pendingCount === 1 ? "" : "s"} · not revenue yet` }, { label: "Overdue follow-ups", value: d.overdue, tone: d.overdue ? ("alert" as const) : undefined }] : []),
    ...(u.role !== "sales" ? [{ label: "Conversion", value: pctText(k.conversion), hint: "Won ÷ (won + lost)" }] : []),
  ];
  return all;
}

export default async function CrmDashboard({ searchParams }: PageProps<"/crm">) {
  const u = await requireCrm();
  const sp = await searchParams;
  const g = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const f = { range: g("range"), product: g("product"), campaignId: g("campaign"), ownerId: g("owner") };
  const [d, people, campaigns, layout] = await Promise.all([dashboard(u, f), u.role === "sales" ? [] : assignees(u), u.can("leads.all") ? listCampaigns() : [], getLayout(u)]);
  const k = d.kpi;
  const title = u.role === "admin" ? "Company overview" : u.role === "marketing" ? "Marketing overview" : u.role === "manager" ? "Team overview" : "My day";
  const st = stats(u, d);
  const hero = u.role === "sales" && d.target && d.target.target > 0 ? { label: "This month's target", value: pctText(d.target.pct), note: `${formatRupees(d.target.achieved)} verified of ${formatRupees(d.target.target)}. Pending deals don't count.` } : { label: "Verified revenue", value: formatRupees(k.verifiedRevenue), note: `${k.verifiedWon} verified wins from ${k.total} leads. ${formatRupees(k.pendingValue)} awaiting verification, not counted.` };

  const render: Record<Widget, () => React.ReactNode> = {
    kpis: () => layout.mode === "focus" ? (
      <section className="flex flex-col gap-5 rounded-[22px] border border-[var(--line-2)] bg-gradient-to-br from-[var(--surface-2)] to-[var(--input)] p-6 lg:col-span-2" aria-label="Key figures">
        <div className="flex flex-col gap-1.5"><span className="text-[11px] font-semibold tracking-[0.22em] text-[var(--accent)] uppercase">{hero.label}</span><span className="font-[var(--font-head)] text-[clamp(44px,8vw,76px)] leading-none font-semibold text-[var(--accent-strong)]">{hero.value}</span><span className="max-w-[640px] text-[13px] text-[var(--muted)]">{hero.note}</span></div>
        <dl className="m-0 flex flex-col border-t border-[var(--line)]">{st.filter((x) => x.label !== hero.label).map((x) => <div key={x.label} className="flex items-baseline justify-between gap-4 border-b border-[var(--line-soft)] py-2.5 text-sm"><dt className="text-[var(--muted)]">{x.label}{x.hint ? <span className="ml-2 text-xs text-[var(--faint)]">{x.hint}</span> : null}</dt><dd className={`m-0 font-semibold tabular-nums ${x.tone === "alert" ? "text-[var(--alert)]" : ""}`}>{x.value}</dd></div>)}</dl>
      </section>
    ) : <div className="lg:col-span-2"><KpiGrid>{st.map((x) => <Kpi key={x.label} label={x.label} value={x.value} hint={x.hint} tone={x.tone} />)}</KpiGrid></div>,
    target: () => d.target && (
      <Panel title="This month's target">
        {d.target.target > 0 ? (<><div className="mb-0.5 flex justify-between text-sm"><span><Money paise={d.target.achieved} /> verified</span><span className="text-[var(--muted)]">of <Money paise={d.target.target} /> · {pctText(d.target.pct)}</span></div><div className="h-2.5 overflow-hidden rounded-full bg-[var(--line-soft)]"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.min(100, d.target.pct ?? 0)}%` }} /></div></>) : <p className="m-0 text-sm text-[var(--muted)]">No monthly target is set for you yet. Verified revenue so far this month: <Money paise={d.target.achieved} />.</p>}
      </Panel>
    ),
    trend: () => <Panel title="Pipeline & revenue · last 12 weeks" wide><TrendChart trend={d.trend} /></Panel>,
    tasks: () => (
      <Panel title="Follow-ups to clear" action={<Link href="/crm/tasks" className="text-sm underline">All tasks</Link>}>
        {d.tasks.length === 0 ? <Empty>Nothing due. Nice.</Empty> : <ul className="m-0 flex list-none flex-col divide-y divide-[var(--line-soft)] p-0">{d.tasks.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm"><div className="min-w-0"><LeadLink id={t.lead.id}>{t.lead.gymName}</LeadLink><div className={`text-xs ${t.overdue ? "text-[var(--alert)]" : "text-[var(--muted)]"}`}>{t.type} · {t.overdue ? "Overdue · " : t.today ? "Today · " : ""}{fmtStamp(t.dueAt)}</div></div>{u.can("activity.log") && <form action={doneAction.bind(null, t.id, t.lead.id)}><Button className="px-3! py-1.5!">Done</Button></form>}</li>
        ))}</ul>}
      </Panel>
    ),
    activity: () => (
      <Panel title="Recent activity" action={<Link href="/crm/activity" className="text-sm underline">{u.role === "sales" ? "My activity" : "All activity"}</Link>}>
        {d.recent.length === 0 ? <Empty>No activity yet.</Empty> : <ul className="m-0 flex list-none flex-col divide-y divide-[var(--line-soft)] p-0">{d.recent.map((r) => <li key={r.id} className="py-2.5 text-sm"><div>{r.actor && <b>{r.actor} · </b>}{r.text}{r.leadId && <> · <LeadLink id={r.leadId} /></>}</div><div className="text-xs text-[var(--muted)]">{fmtStamp(r.at)}</div></li>)}</ul>}
      </Panel>
    ),
    stages: () => d.byStage && <Panel title="Leads by stage"><Bars rows={d.byStage.map(([s, n]) => [stageLabel(s), n])} /></Panel>,
    people: () => d.people && d.people.length > 0 && (
      <Panel title="Employee performance" wide>
        <ScrollRegion label="Employee performance"><table className={TABLE}><thead><tr><th className={TH}>Employee</th><th className={`${TH} text-right`}>Leads</th><th className={`${TH} text-right`}>Calls (30d)</th><th className={`${TH} text-right`}>Demos</th><th className={`${TH} text-right`}>Verified wins</th><th className={`${TH} text-right`}>Revenue</th><th className={`${TH} text-right`}>Conversion</th></tr></thead>
          <tbody>{d.people.map((p) => <tr key={p.id} className={TR}><td className={TD}>{p.name}</td><td className={`${TD} text-right`}>{p.leads}</td><td className={`${TD} text-right`}>{p.calls}</td><td className={`${TD} text-right`}>{p.demos}</td><td className={`${TD} text-right`}>{p.won}</td><td className={`${TD} text-right`}><Money paise={p.revenue} /></td><td className={`${TD} text-right`}>{pctText(p.conversion)}</td></tr>)}</tbody></table></ScrollRegion>
      </Panel>
    ),
    products: () => d.byProduct && (
      <Panel title="By product"><table className={TABLE}><thead><tr><th className={TH}>Product</th><th className={`${TH} text-right`}>Leads</th><th className={`${TH} text-right`}>Won</th><th className={`${TH} text-right`}>Revenue</th></tr></thead><tbody>{d.byProduct.map((p) => <tr key={p.product} className={TR}><td className={TD}>{p.product === "SaaS" ? "Gym Accounting" : "Gym Partnership"}</td><td className={`${TD} text-right`}>{p.total}</td><td className={`${TD} text-right`}>{p.verifiedWon}</td><td className={`${TD} text-right`}><Money paise={p.verifiedRevenue} /></td></tr>)}</tbody></table></Panel>
    ),
    sources: () => d.bySource && <Panel title="By source"><Bars rows={d.bySource} /></Panel>,
    campaigns: () => d.campaigns && (
      <Panel title="Campaigns" wide action={u.can("campaigns.manage") ? <Link href="/crm/campaigns" className="text-sm underline">Manage</Link> : undefined}>
        {d.campaigns.length === 0 ? <Empty>No campaigns yet.</Empty> : <ScrollRegion label="Campaigns"><table className={TABLE}><thead><tr><th className={TH}>Campaign</th><th className={TH}>Source</th><th className={`${TH} text-right`}>Leads</th><th className={`${TH} text-right`}>Spend</th><th className={`${TH} text-right`}>Cost per lead</th><th className={`${TH} text-right`}>Won</th><th className={`${TH} text-right`}>Revenue</th></tr></thead>
          <tbody>{d.campaigns.map((c) => <tr key={c.id} className={TR}><td className={TD}>{c.name}</td><td className={TD}>{c.source}</td><td className={`${TD} text-right`}>{c.leads}</td><td className={`${TD} text-right`}>{c.spend == null ? <span className="text-[var(--muted)]">Not recorded</span> : formatRupees(c.spend)}</td><td className={`${TD} text-right`}>{c.cpl == null ? <span className="text-[var(--muted)]">Not recorded</span> : formatRupees(c.cpl)}</td><td className={`${TD} text-right`}>{c.won}</td><td className={`${TD} text-right`}><Money paise={c.revenue} /></td></tr>)}</tbody></table></ScrollRegion>}
      </Panel>
    ),
    geo: () => d.byState && <Panel title="Where leads come from"><div className="grid gap-5 sm:grid-cols-2"><div><div className="mb-2 text-[11px] tracking-[0.12em] text-[var(--muted)] uppercase">States</div><Bars rows={d.byState} /></div><div><div className="mb-2 text-[11px] tracking-[0.12em] text-[var(--muted)] uppercase">Top cities</div><Bars rows={d.topCities ?? []} /></div></div></Panel>,
    ageing: () => d.ageing && (
      <Panel title="Open leads by age"><ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">{d.ageing.map((a) => <li key={a.label} className="flex justify-between"><span className={a.stale ? "text-[var(--alert)]" : ""}>{a.label}{a.stale ? " · stale" : ""}</span><b className={`tabular-nums ${a.stale && a.n ? "text-[var(--alert)]" : ""}`}>{a.n}</b></li>)}</ul><p className="m-0 text-xs text-[var(--faint)]">{STALE_DAYS}+ days without closing is shown in red.</p></Panel>
    ),
  };

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2"><span className="text-[11px] font-semibold tracking-[0.24em] text-[var(--accent)] uppercase">{CRM_ROLE_LABEL[u.role]}{u.role === "admin" ? " · all teams" : u.role === "manager" ? " · your team" : ""}</span><h1 className="m-0">{title}</h1></div>
        <DashControls role={u.role} layout={layout} />
      </div>
      {u.role !== "sales" && (
        <form className="mb-5 flex flex-wrap items-center gap-2">
          <Select name="range" defaultValue={f.range} aria-label="Date range" className="w-auto!">{DATE_RANGES.map(([v, l]) => <option key={v} value={v === "all" ? "" : v}>{l}</option>)}</Select>
          <Select name="product" defaultValue={f.product} aria-label="Product" className="w-auto!"><option value="">All products</option><option value="SaaS">Gym Accounting SaaS</option><option value="Partnership">Gym Partnership</option></Select>
          {campaigns.length > 0 && <Select name="campaign" defaultValue={f.campaignId} aria-label="Campaign" className="w-auto!"><option value="">All campaigns</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}
          <Select name="owner" defaultValue={f.ownerId} aria-label="Employee" className="w-auto!"><option value="">All employees</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          <Button>Apply</Button>
          <span className="text-xs text-[var(--muted)]">Filters apply to the lead&apos;s creation date. Revenue counts approved deals only.</span>
        </form>
      )}
      <div className="grid items-start gap-5 lg:grid-cols-2">
        {visible(layout).map((w) => <div key={w} data-widget={w} aria-label={WIDGET_LABEL[w]} className="contents">{render[w]()}</div>)}
      </div>
    </>
  );
}
