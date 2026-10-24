import { requireCrm } from "@/lib/auth/crm";
import { listCampaigns } from "@/lib/services/crm-people";
import { PageHeader } from "@/components/ui";
import { Importer } from "./importer";

export const metadata = { title: "Import leads · FITRON CRM" };

export default async function ImportPage() {
  await requireCrm("leads.import");
  const campaigns = await listCampaigns();
  return (
    <>
      <PageHeader kicker="CSV" title="Import leads" subtitle="Only valid rows are added, together, as unassigned leads. A number already in the CRM is skipped for review, never overwritten." />
      <Importer campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))} />
    </>
  );
}
