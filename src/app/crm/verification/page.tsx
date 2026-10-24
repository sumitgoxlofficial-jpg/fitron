import { requireCrm } from "@/lib/auth/crm";
import { verificationQueue } from "@/lib/services/crm-leads";
import { Button, Card, Empty, Field, Input, PageHeader } from "@/components/ui";
import { fmtStamp, formatRupees } from "@/lib/format";
import { approveAction, rejectAction } from "../actions";
import { CrmForm } from "../crm-form";
import { LeadLink } from "../parts";

export const metadata = { title: "Deal verification · FITRON CRM" };

export default async function VerificationPage() {
  const u = await requireCrm("deal.verify");
  const q = await verificationQueue(u);
  return (
    <>
      <PageHeader kicker={u.role === "admin" ? "All teams" : "Your team"} title="Deal verification" subtitle="A closed deal counts as revenue only after approval. Check the payment reference or the signed agreement first." />
      {q.pending.length === 0 ? <Empty>No deals waiting.</Empty> : (
        <div className="mb-8 grid gap-4 md:grid-cols-2">
          {q.pending.map((l) => (
            <Card key={l.id}>
              <div className="text-[11px] tracking-[0.08em] text-muted uppercase"><LeadLink id={l.id} /> · {l.product === "SaaS" ? "Gym Accounting" : "Gym Partnership"}</div>
              <div className="text-xl font-semibold">{l.gymName}</div>
              <div className="text-[28px] font-semibold tabular-nums">{formatRupees(l.estValue)}</div>
              <div className="my-3 text-sm text-muted">
                <div>{l.proofType}: <b className="text-fg">{l.proofRef}</b></div>
                <div>Closed by {l.closedByName ?? "—"} · created {fmtStamp(l.createdAt)}</div>
                <div>Campaign: {l.campaignName ?? "none"} · Source: {l.source}</div>
              </div>
              <div className="flex flex-wrap items-start gap-3">
                <form action={approveAction.bind(null, l.id)}><Button variant="primary">Approve</Button></form>
                <CrmForm action={rejectAction.bind(null, l.id)} submit="Reject" variant="danger" className="flex min-w-[220px] flex-1 flex-col gap-2">
                  <Field label="Reason for rejecting"><Input name="reason" required minLength={5} /></Field>
                </CrmForm>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Card title="Recent decisions">
        {q.decisions.length === 0 ? <Empty>None yet.</Empty> : (
          <ul className="divide-y divide-fg/8">{q.decisions.map((d) => <li key={d.id} className="py-2 text-sm">{d.leadId && <LeadLink id={d.leadId} />} · {d.text} <span className="text-muted">· {d.by} · {fmtStamp(d.at)}</span></li>)}</ul>
        )}
      </Card>
    </>
  );
}
