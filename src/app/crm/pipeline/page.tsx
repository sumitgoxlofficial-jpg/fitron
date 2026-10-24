import { requireCrm } from "@/lib/auth/crm";
import { BOARD_STAGES } from "@/lib/domain/crm";
import { listLeads } from "@/lib/services/crm-leads";
import { PageHeader } from "@/components/ui";
import { Board } from "./board";

export const metadata = { title: "Pipeline · FITRON CRM" };
const PER_COLUMN = 30;

export default async function PipelinePage() {
  const u = await requireCrm();
  const columns = await Promise.all(BOARD_STAGES.map(async (stage) => {
    const { leads, total } = await listLeads(u, { stage, pageSize: PER_COLUMN });
    return { stage, total, cards: leads.map((l) => ({ id: l.id, gymName: l.gymName, product: l.product, city: l.city, estValue: l.estValue, ownerName: l.ownerName, priority: l.priority, locked: l.locked, verification: l.verification })) };
  }));
  return (
    <>
      <PageHeader kicker="Drag a card to change its stage" title="Pipeline" subtitle="Closed Won asks for proof and waits for verification; Closed Lost asks for a reason." />
      <Board columns={columns} canMove={u.can("activity.log")} />
    </>
  );
}
