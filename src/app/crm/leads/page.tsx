import Link from "next/link";
import { requireCrm } from "@/lib/auth/crm";
import { PRODUCTS, SOURCES, STAGES, stageLabel } from "@/lib/domain/crm";
import { SELLABLE } from "@/lib/domain/crm-plans";
import { assignees, listLeads, type LeadFilter } from "@/lib/services/crm-leads";
import { listCampaigns } from "@/lib/services/crm-people";
import { Dialog } from "@/components/dialog";
import { Button, Empty, Field, Input, LinkButton, PageHeader, Pager, ScrollRegion, Select, TABLE, TD, TH, TR } from "@/components/ui";
import { fmtShort, formatRupees } from "@/lib/format";
import { saveNewLead } from "../actions";
import { CrmForm } from "../crm-form";
import { LeadLink, StageBadge, VerificationBadge } from "../parts";

export const metadata = { title: "Leads · FITRON CRM" };

export default async function LeadsPage({ searchParams }: PageProps<"/crm/leads">) {
  const u = await requireCrm();
  const sp = await searchParams;
  const g = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const f: LeadFilter = { q: g("q"), stage: g("stage"), product: g("product"), ownerId: g("owner"), campaignId: g("campaign"), verification: g("verification"), page: Math.max(1, Number(g("page")) || 1) };
  const [{ leads, total, pageSize }, owners, campaigns] = await Promise.all([listLeads(u, f), u.role === "sales" ? [] : assignees(u), listCampaigns()]);
  const qs = (over: Record<string, string> = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: f.q, stage: f.stage, product: f.product, owner: f.ownerId, campaign: f.campaignId, verification: f.verification, ...over })) if (v) p.set(k, v);
    return p.toString();
  };

  return (
    <>
      <PageHeader
        kicker={u.can("leads.all") ? "All leads" : u.can("leads.team") ? "Your team's leads and unassigned" : "Assigned to you"}
        title="Leads"
        actions={
          <>
            {u.can("leads.import") && <LinkButton href="/crm/import">Import</LinkButton>}
            {u.can("leads.export") && <a href={`/api/crm/export?${qs()}`} className="inline-flex items-center rounded-md border border-line px-[18px] py-2.5 text-sm font-semibold hover:bg-fg/7">Export CSV</a>}
            <LinkButton href="/crm/leads?new=1" variant="primary">Add lead</LinkButton>
          </>
        }
      />
      <form className="mb-4 flex flex-wrap items-center gap-2">
        <Input name="q" defaultValue={f.q} placeholder={u.can("phone.full") ? "Search gym, contact, ID, city or phone" : "Search gym, contact, ID or city"} className="max-w-[320px] flex-[1_1_240px]" />
        <Select name="stage" defaultValue={f.stage} className="w-auto!"><option value="">All stages</option>{STAGES.map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}</Select>
        <Select name="product" defaultValue={f.product} className="w-auto!"><option value="">All products</option>{PRODUCTS.map((p) => <option key={p}>{p}</option>)}</Select>
        {u.role !== "sales" && <Select name="owner" defaultValue={f.ownerId} className="w-auto!"><option value="">All owners</option><option value="none">Unassigned</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>}
        <Select name="verification" defaultValue={f.verification} className="w-auto!"><option value="">Any verification</option><option>Pending</option><option>Verified</option><option>Rejected</option></Select>
        <Button>Filter</Button>
        {(f.q || f.stage || f.product || f.ownerId || f.verification) && <Link href="/crm/leads" className="text-sm underline">Clear</Link>}
      </form>

      {leads.length === 0 ? <Empty>No leads match.</Empty> : (
        <ScrollRegion label="Leads">
          <table className={TABLE}>
            <thead><tr><th className={TH}>ID</th><th className={TH}>Gym / contact</th><th className={TH}>City</th><th className={TH}>Product</th><th className={TH}>Stage</th><th className={TH}>Owner</th><th className={`${TH} text-right`}>Value</th><th className={TH}>Added</th></tr></thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className={TR}>
                  <td className={TD}><LeadLink id={l.id} /></td>
                  <td className={TD}><div className="font-semibold">{l.gymName}</div><div className="text-xs text-muted">{l.contactName} · {l.phone}</div></td>
                  <td className={TD}>{l.city ?? "—"}</td>
                  <td className={TD}>{l.product === "SaaS" ? "Gym Accounting" : "Partnership"}</td>
                  <td className={TD}><div className="flex flex-wrap gap-1"><StageBadge stage={l.stage} /><VerificationBadge v={l.verification} /></div></td>
                  <td className={TD}>{l.ownerName ?? <span className="text-alert">Unassigned</span>}</td>
                  <td className={`${TD} text-right tabular-nums`}>{l.estValue ? formatRupees(l.estValue) : "—"}</td>
                  <td className={TD}>{fmtShort(l.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}
      <div className="mt-4"><Pager page={f.page ?? 1} pageSize={pageSize} total={total} href={(p) => `/crm/leads?${qs({ page: String(p) })}`} /></div>

      {g("new") && (
        <Dialog kicker="New lead" title="Add a lead" close="/crm/leads" form width={560}>
          <CrmForm action={saveNewLead} submit="Add lead" className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Contact name"><Input name="contactName" required /></Field>
              <Field label="Gym / business"><Input name="gymName" required /></Field>
              <Field label="Mobile" hint="10 digits; +91 or 0 in front is fine."><Input name="phone" inputMode="tel" required /></Field>
              <Field label="Alternate mobile"><Input name="altPhone" inputMode="tel" /></Field>
              <Field label="Email"><Input name="email" type="email" /></Field>
              <Field label="City"><Input name="city" /></Field>
              <Field label="State"><Input name="state" /></Field>
              <Field label="PIN code"><Input name="pin" inputMode="numeric" maxLength={6} /></Field>
              <Field label="Plan pitched"><Select name="plan" defaultValue="starter">{SELLABLE.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</Select></Field>
              <Field label="Billing"><Select name="billing" defaultValue="MONTHLY"><option value="MONTHLY">Monthly</option><option value="YEARLY">Yearly</option></Select></Field>
              <Field label="Campaign"><Select name="campaignId"><option value="">None</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
              <Field label="Source (if no campaign)"><Select name="source" defaultValue="Other">{SOURCES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
            </div>
          </CrmForm>
        </Dialog>
      )}
    </>
  );
}
