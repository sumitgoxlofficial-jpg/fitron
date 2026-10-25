import Link from "next/link";
import { requireCrm } from "@/lib/auth/crm";
import { fmtMinutes } from "@/lib/domain/ai-calling/time";
import { OPEN_STAGES } from "@/lib/domain/crm";
import { INDIA_STATES } from "@/lib/domain/gym-intel/constants";
import { listCampaigns } from "@/lib/services/ai-calling/campaigns";
import { Card, Empty, Field, Input, PageHeader, ScrollRegion, Select, TABLE, TD, TH, TR } from "@/components/ui";
import { CrmForm } from "../../crm-form";
import { createCampaignAction } from "../actions";
import { CampaignBadge, when } from "../parts";

export const metadata = { title: "AI campaigns · FITRON CRM" };

export default async function CampaignsPage() {
  const u = await requireCrm("calling.view");
  const rows = await listCampaigns(u);
  return (
    <>
      <PageHeader kicker="AI Calling" title="Campaigns" subtitle="A campaign is a list of leads, a call limit, and the hours to call in. Nothing starts until you have reviewed and approved it." />
      <div className="grid items-start gap-5 lg:grid-cols-[2fr_1fr]">
        <Card title="All campaigns">
          {rows.length === 0 ? <Empty>No campaigns yet. Create one on the right.</Empty> : (
            <ScrollRegion label="Campaigns">
              <table className={TABLE}>
                <thead><tr><th className={TH}>Campaign</th><th className={TH}>Status</th><th className={`${TH} text-right`}>Calls</th><th className={`${TH} text-right`}>Answered</th><th className={`${TH} text-right`}>Failed</th><th className={TH}>Hours</th><th className={TH}>Created</th></tr></thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id} className={TR}>
                      <td className={TD}><Link href={`/crm/calling/campaigns/${c.id}`} className="font-semibold underline">{c.name}</Link>{c.testMode && <div className="text-xs text-[var(--muted)]">test</div>}</td>
                      <td className={TD}><CampaignBadge s={c.status} /></td>
                      <td className={`${TD} text-right tabular-nums`}>{c.made} / {c.maxCalls}</td>
                      <td className={`${TD} text-right tabular-nums`}>{c.done}</td>
                      <td className={`${TD} text-right tabular-nums`}>{c.failed}</td>
                      <td className={`${TD} whitespace-nowrap`}>{fmtMinutes(c.hoursFrom)}–{fmtMinutes(c.hoursTo)}</td>
                      <td className={`${TD} whitespace-nowrap`}>{when(c.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          )}
        </Card>
        <Card title="New campaign">
          <CrmForm action={createCampaignAction} submit="Create draft" reset>
            <Field label="Name"><Input name="name" required minLength={3} maxLength={80} /></Field>
            <Field label="States" hint="Comma-separated, as written on the leads (for example Jharkhand, Bihar). Empty means all."><Input name="states" list="ac-states" /></Field>
            <datalist id="ac-states">{INDIA_STATES.map((s) => <option key={s.code} value={s.name} />)}</datalist>
            <fieldset className="flex flex-col gap-1"><legend className="mb-1 text-sm font-semibold">Lead stages</legend>{OPEN_STAGES.map((s) => <label key={s} className="flex items-center gap-2 text-sm"><input type="checkbox" name="stages" value={s} defaultChecked={s === "New Lead" || s === "Contacted"} /> {s}</label>)}</fieldset>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Most calls"><Input name="maxCalls" type="number" min={1} max={5000} defaultValue={50} required /></Field>
              <Field label="At once"><Input name="concurrency" type="number" min={1} max={5} defaultValue={1} required /></Field>
              <Field label="Call from (India)"><Input name="from" type="time" defaultValue="10:00" required /></Field>
              <Field label="Call until"><Input name="to" type="time" defaultValue="18:00" required /></Field>
            </div>
            <Field label="Audience" hint="A test campaign only ever calls the authorised test numbers."><Select name="testMode" defaultValue="test"><option value="test">Test numbers only</option><option value="live">Real leads (needs live mode)</option></Select></Field>
          </CrmForm>
        </Card>
      </div>
    </>
  );
}
