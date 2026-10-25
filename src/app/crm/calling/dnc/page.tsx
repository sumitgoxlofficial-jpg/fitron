import { requireCrm } from "@/lib/auth/crm";
import { CONSENT_BASES, CONSENT_LABEL } from "@/lib/domain/ai-calling/constants";
import { listSuppressions } from "@/lib/services/ai-calling/people";
import { Card, Empty, Field, Input, PageHeader, ScrollRegion, Select, TABLE, TD, TH, TR, Textarea } from "@/components/ui";
import { CrmForm } from "../../crm-form";
import { addSuppressionAction, recordConsentAction, removeSuppressionAction } from "../actions";
import { when } from "../parts";

export const metadata = { title: "Do not call · FITRON CRM" };

export default async function DncPage() {
  const u = await requireCrm("calling.view");
  const rows = await listSuppressions(u);
  return (
    <>
      <PageHeader kicker="AI Calling" title="Permission and do-not-call" subtitle="A number is called only if there is a recorded reason it may be, and never if it is on this list. A public listing is not a reason." />
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card title="Record permission to call">
          <CrmForm action={recordConsentAction} submit="Record permission" reset>
            <Field label="CRM lead ids" hint="For example FL-12, FL-13 (up to 500)."><Textarea name="leads" rows={3} required /></Field>
            <Field label="Why these may be called"><Select name="basis" defaultValue="ENQUIRY">{CONSENT_BASES.filter((b) => b !== "TEST").map((b) => <option key={b} value={b}>{CONSENT_LABEL[b]}</option>)}</Select></Field>
            <Field label="Where the permission is recorded" hint="The enquiry form and date, the customer record, the opt-in message…"><Input name="note" required minLength={8} maxLength={300} /></Field>
          </CrmForm>
        </Card>
        <Card title="Add a number to the do-not-call list">
          <CrmForm action={addSuppressionAction} submit="Add" reset>
            <Field label="Mobile number"><Input name="phone" inputMode="numeric" required /></Field>
            <Field label="Reason"><Input name="reason" required minLength={3} maxLength={200} /></Field>
          </CrmForm>
          <p className="mt-3 text-xs text-[var(--muted)]">When a person asks the agent to stop, the number is added here during the call. It also blocks the number in Gym Intelligence.</p>
        </Card>
      </div>
      <div className="mt-5"><Card title={`Do-not-call list (${rows.length})`}>
        {rows.length === 0 ? <Empty>Nobody is on the list.</Empty> : (
          <ScrollRegion label="Do-not-call list"><table className={TABLE}><thead><tr><th className={TH}>Number</th><th className={TH}>Reason</th><th className={TH}>How</th><th className={TH}>Added</th><th className={TH}>Remove</th></tr></thead><tbody>
            {rows.map((r) => (
              <tr key={r.phoneNorm} className={TR}>
                <td className={`${TD} tabular-nums`}>{r.masked}</td><td className={TD}>{r.reason}</td><td className={TD}>{r.source === "call" ? "Asked during a call" : "Added by an admin"}</td><td className={TD}>{when(r.createdAt)}</td>
                <td className={TD}><CrmForm action={removeSuppressionAction} submit="Remove" variant="ghost" className="flex items-center gap-2"><input type="hidden" name="phone" value={r.phoneNorm} /><Input name="reason" aria-label="Reason for removing" placeholder="Reason (10+ characters)" required minLength={10} /></CrmForm></td>
              </tr>
            ))}
          </tbody></table></ScrollRegion>
        )}
      </Card></div>
    </>
  );
}
