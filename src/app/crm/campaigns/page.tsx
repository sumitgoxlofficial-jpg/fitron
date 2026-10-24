import { requireCrm } from "@/lib/auth/crm";
import { SOURCES } from "@/lib/domain/crm";
import { listCampaigns } from "@/lib/services/crm-people";
import { Card, Field, Input, PageHeader, ScrollRegion, Select, TABLE, TD, TH, TR } from "@/components/ui";
import { campaignAction } from "../actions";
import { CrmForm } from "../crm-form";

export const metadata = { title: "Campaigns · FITRON CRM" };

export default async function CampaignsPage() {
  await requireCrm("campaigns.manage");
  const campaigns = await listCampaigns();
  return (
    <>
      <PageHeader kicker="Marketing" title="Campaigns" subtitle="Spend is only what you enter. Leave it empty and cost per lead reads “Not recorded”; it is never estimated." />
      <Card title="New campaign" className="mb-6">
        <CrmForm action={campaignAction.bind(null, null)} submit="Add campaign" reset>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Name"><Input name="name" required /></Field>
            <Field label="Source"><Select name="source">{SOURCES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
            <Field label="Spend (₹, optional)"><Input name="spend" inputMode="decimal" /></Field>
          </div>
        </CrmForm>
      </Card>
      <ScrollRegion label="Campaigns">
        <table className={TABLE}>
          <thead><tr><th className={TH}>Campaign</th><th className={TH}>Source</th><th className={`${TH} text-right`}>Leads</th><th className={TH}>Name, source and spend</th></tr></thead>
          <tbody>
            {campaigns.map((c) => (
              <tr key={c.id} className={TR}>
                <td className={TD}>{c.name}</td><td className={TD}>{c.source}</td><td className={`${TD} text-right`}>{c.leads}</td>
                <td className={TD}>
                  <CrmForm action={campaignAction.bind(null, c.id)} submit="Save" variant="default" className="flex flex-wrap items-center gap-2">
                    <Input name="name" defaultValue={c.name} aria-label="Name" className="w-44" required />
                    <Select name="source" defaultValue={c.source} aria-label="Source" className="w-auto">{SOURCES.map((s) => <option key={s}>{s}</option>)}</Select>
                    <Input name="spend" defaultValue={c.spend == null ? "" : String(c.spend / 100)} aria-label="Spend in rupees" placeholder="Not recorded" inputMode="decimal" className="w-32" />
                  </CrmForm>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
    </>
  );
}
