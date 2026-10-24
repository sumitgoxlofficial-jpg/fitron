import Link from "next/link";
import { requireCrm } from "@/lib/auth/crm";
import { CRM_ROLE_LABEL, stageLabel, STALE_DAYS } from "@/lib/domain/crm";
import { dashboard, RANGES, type DashFilter } from "@/lib/services/crm-reports";
import { assignees } from "@/lib/services/crm-leads";
import { listCampaigns } from "@/lib/services/crm-people";
import { Card, ScrollRegion, Select, TABLE, TD, TH, TR, PageHeader, Button, Empty } from "@/components/ui";
import { fmtDate, fmtStamp, formatRupees } from "@/lib/format";
import { Bars, Kpi, KpiGrid, LeadLink, Money, pctText } from "./parts";
import { doneAction } from "./actions";

export const metadata = { title: "Dashboard · FITRON CRM" };

export default async function CrmDashboard({ searchParams }: PageProps<"/crm">) {
  const u = await requireCrm();
  const sp = await searchParams;
  const g = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const f: DashFilter = { range: g("range"), product: g("product"), campaignId: g("campaign"), ownerId: g("owner") };
  const [d, people, campaigns] = await Promise.all([dashboard(u, f), u.role === "sales" ? [] : assignees(u), u.can("leads.all") ? listCampaigns() : []]);
  const k = d.kpi;
  const title = u.role === "admin" ? "Company overview" : u.role === "marketing" ? "Marketing overview" : u.role === "manager" ? "Team overview" : "My day";

  return (
    <>
      <PageHeader kicker={`${CRM_ROLE_LABEL[u.role]}${u.role === "admin" ? " · all teams" : u.role === "manager" ? " · your team" : ""}`} title={title} />
      {u.role !== "sales" && (
        <form className="mb-5 flex flex-wrap items-center gap-2">
          <Select name="range" defaultValue={f.range} className="w-auto">
            {RANGES.map(([v, l]) => <option key={v} value={v === "all" ? "" : v}>{l}</option>)}
          </Select>
          <Select name="product" defaultValue={f.product} className="w-auto">
            <option value="">All products</option><option>SaaS</option><option>Partnership</option>
          </Select>
          {campaigns.length > 0 && (
            <Select name="campaign" defaultValue={f.campaignId} className="w-auto">
              <option value="">All campaigns</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          )}
          <Select name="owner" defaultValue={f.ownerId} className="w-auto">
            <option value="">All employees</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Button>Apply</Button>
          <span className="text-xs text-muted">Filters apply to the lead&apos;s creation date. Revenue counts approved deals only.</span>
        </form>
      )}

      <KpiGrid>
        <Kpi label={u.role === "sales" ? "My leads" : "Total leads"} value={k.total} hint={`${k.contacted} contacted`} />
        {u.role !== "sales" && <Kpi label="Lead → contact" value={pctText(k.leadToContact)} />}
        {u.role === "marketing" && <Kpi label="Contact → demo" value={pctText(k.contactToDemo)} />}
        {u.role === "marketing" && <Kpi label="Demo → paid" value={pctText(k.demoToPaid)} />}
        {u.role !== "marketing" && <Kpi label="Open pipeline" value={<Money paise={k.openPipeline} />} hint="Estimated, not revenue" />}
        {u.role !== "marketing" && <Kpi label="Verified wins" value={k.verifiedWon} hint={`${k.lost} lost`} />}
        <Kpi label="Verified revenue" value={<Money paise={k.verifiedRevenue} />} hint="Approved deals only" />
        {u.role !== "marketing" && <Kpi label="Pending verification" value={<Money paise={k.pendingValue} />} hint={`${k.pendingCount} deal${k.pendingCount === 1 ? "" : "s"} · not revenue yet`} />}
        {u.role !== "marketing" && <Kpi label="Overdue follow-ups" value={d.overdue} tone={d.overdue ? "alert" : undefined} />}
        {u.role !== "sales" && <Kpi label="Conversion" value={pctText(k.conversion)} hint="Won ÷ (won + lost)" />}
      </KpiGrid>

      {d.target && (
        <Card title="This month's target" className="mb-6">
          {d.target.target > 0 ? (
            <>
              <div className="mb-2 flex justify-between text-sm"><span><Money paise={d.target.achieved} /> verified</span><span className="text-muted">of <Money paise={d.target.target} /> · {pctText(d.target.pct)}</span></div>
              <div className="h-2.5 overflow-hidden rounded-full bg-fg/8"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, d.target.pct ?? 0)}%` }} /></div>
            </>
          ) : <p className="text-sm text-muted">No monthly target is set for you yet. Verified revenue so far this month: <Money paise={d.target.achieved} />.</p>}
        </Card>
      )}

      <div className="mb-6 grid gap-5 lg:grid-cols-2">
        {u.role !== "marketing" && (
          <Card title="Follow-ups to clear" action={<Link href="/crm/tasks" className="text-sm underline">All tasks</Link>}>
            {d.tasks.length === 0 ? <Empty>Nothing due. Nice.</Empty> : (
              <ul className="flex flex-col divide-y divide-fg/8">
                {d.tasks.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <LeadLink id={t.lead.id}>{t.lead.gymName}</LeadLink>
                      <div className={`text-xs ${t.overdue ? "text-alert" : "text-muted"}`}>{t.type} · {t.overdue ? "Overdue · " : t.today ? "Today · " : ""}{fmtStamp(t.dueAt)}</div>
                    </div>
                    {u.can("activity.log") && <form action={doneAction.bind(null, t.id, t.lead.id)}><Button variant="default" className="px-3! py-1.5!">Done</Button></form>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        <Card title="Recent activity" action={u.can("audit.view") ? <Link href="/crm/audit" className="text-sm underline">Full audit log</Link> : undefined}>
          {d.recent.length === 0 ? <Empty>No activity yet.</Empty> : (
            <ul className="flex flex-col divide-y divide-fg/8">
              {d.recent.map((r) => (
                <li key={r.id} className="py-2.5 text-sm">
                  <div>{r.actor && <b>{r.actor} · </b>}{r.text}{r.leadId && <> · <LeadLink id={r.leadId} /></>}</div>
                  <div className="text-xs text-muted">{fmtStamp(r.at)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mb-6 grid gap-5 lg:grid-cols-2">
        <Card title="Leads per week"><Bars rows={d.weeks.map((w) => [w.label, w.n])} /></Card>
        {d.byStage && <Card title="Leads by stage"><Bars rows={d.byStage.map(([s, n]) => [stageLabel(s), n])} /></Card>}
      </div>

      {d.people && d.people.length > 0 && (
        <Card title="Employee performance" className="mb-6">
          <ScrollRegion label="Employee performance">
            <table className={TABLE}>
              <thead><tr><th className={TH}>Employee</th><th className={`${TH} text-right`}>Leads</th><th className={`${TH} text-right`}>Calls (30d)</th><th className={`${TH} text-right`}>Demos</th><th className={`${TH} text-right`}>Verified wins</th><th className={`${TH} text-right`}>Revenue</th><th className={`${TH} text-right`}>Conversion</th></tr></thead>
              <tbody>
                {d.people.map((p) => (
                  <tr key={p.id} className={TR}>
                    <td className={TD}>{p.name}</td><td className={`${TD} text-right`}>{p.leads}</td><td className={`${TD} text-right`}>{p.calls}</td><td className={`${TD} text-right`}>{p.demos}</td><td className={`${TD} text-right`}>{p.won}</td><td className={`${TD} text-right`}><Money paise={p.revenue} /></td><td className={`${TD} text-right`}>{pctText(p.conversion)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        </Card>
      )}

      {d.byProduct && (
        <div className="mb-6 grid gap-5 lg:grid-cols-2">
          <Card title="By product">
            <table className={TABLE}>
              <thead><tr><th className={TH}>Product</th><th className={`${TH} text-right`}>Leads</th><th className={`${TH} text-right`}>Won</th><th className={`${TH} text-right`}>Revenue</th></tr></thead>
              <tbody>{d.byProduct.map((p) => <tr key={p.product} className={TR}><td className={TD}>{p.product === "SaaS" ? "Gym Accounting" : "Gym Partnership"}</td><td className={`${TD} text-right`}>{p.total}</td><td className={`${TD} text-right`}>{p.verifiedWon}</td><td className={`${TD} text-right`}><Money paise={p.verifiedRevenue} /></td></tr>)}</tbody>
            </table>
          </Card>
          {d.bySource && <Card title="By source"><Bars rows={d.bySource} /></Card>}
        </div>
      )}

      {d.campaigns && (
        <Card title="Campaigns" className="mb-6" action={u.can("campaigns.manage") ? <Link href="/crm/campaigns" className="text-sm underline">Manage</Link> : undefined}>
          {d.campaigns.length === 0 ? <Empty>No campaigns yet.</Empty> : (
            <ScrollRegion label="Campaigns">
              <table className={TABLE}>
                <thead><tr><th className={TH}>Campaign</th><th className={TH}>Source</th><th className={`${TH} text-right`}>Leads</th><th className={`${TH} text-right`}>Spend</th><th className={`${TH} text-right`}>Cost per lead</th><th className={`${TH} text-right`}>Won</th><th className={`${TH} text-right`}>Revenue</th></tr></thead>
                <tbody>
                  {d.campaigns.map((c) => (
                    <tr key={c.id} className={TR}>
                      <td className={TD}>{c.name}</td><td className={TD}>{c.source}</td><td className={`${TD} text-right`}>{c.leads}</td>
                      <td className={`${TD} text-right`}>{c.spend == null ? <span className="text-muted">Not recorded</span> : formatRupees(c.spend)}</td>
                      <td className={`${TD} text-right`}>{c.cpl == null ? <span className="text-muted">Not recorded</span> : formatRupees(c.cpl)}</td>
                      <td className={`${TD} text-right`}>{c.won}</td><td className={`${TD} text-right`}><Money paise={c.revenue} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          )}
        </Card>
      )}

      {(d.byState || d.ageing) && (
        <div className="mb-6 grid gap-5 lg:grid-cols-3">
          {d.byState && <Card title="Leads by state"><Bars rows={d.byState} /></Card>}
          {d.topCities && <Card title="Top cities"><Bars rows={d.topCities} /></Card>}
          {d.ageing && (
            <Card title="Open leads by age">
              <ul className="flex flex-col gap-2 text-sm">
                {d.ageing.map((a) => <li key={a.label} className="flex justify-between"><span className={a.stale ? "text-alert" : ""}>{a.label}{a.stale ? " · stale" : ""}</span><b className={`tabular-nums ${a.stale && a.n ? "text-alert" : ""}`}>{a.n}</b></li>)}
              </ul>
              <p className="mt-3 text-xs text-muted">{STALE_DAYS}+ days without closing is shown in red.</p>
            </Card>
          )}
        </div>
      )}
      <p className="text-xs text-muted">Today is {fmtDate(new Date())}.</p>
    </>
  );
}
