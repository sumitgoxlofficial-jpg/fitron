import { requireCrm } from "@/lib/auth/crm";
import { liveReady } from "@/lib/domain/ai-calling/settings";
import { PLANS } from "@/lib/domain/pricing";
import { currentOffer } from "@/lib/domain/ai-calling/offer";
import { getAcSettings } from "@/lib/services/ai-calling/core";
import { Badge, Card, Field, Input, Notice, PageHeader, Select, Textarea } from "@/components/ui";
import { CrmForm } from "../../crm-form";
import { saveSettingsAction, testCallAction } from "../actions";

export const metadata = { title: "AI calling settings · FITRON CRM" };
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function SettingsPage() {
  await requireCrm("calling.manage");
  const s = await getAcSettings();
  const offer = currentOffer(s.offer);
  const chk = (name: string, label: string, on: boolean) => <label className="flex items-start gap-2 text-sm"><input type="checkbox" name={name} defaultChecked={on} className="mt-1" /> <span>{label}</span></label>;
  const num = (name: string, label: string, v: number, hint?: string) => <Field label={label} hint={hint}><Input name={name} type="number" defaultValue={v} required /></Field>;
  return (
    <>
      <PageHeader kicker="AI Calling" title="Settings" subtitle="Safe by default: test mode, nothing confirmed, offer off. Every value is checked when saved." />
      <div className="grid items-start gap-5 lg:grid-cols-[2fr_1fr]">
        <Card title="Calling settings">
          <CrmForm action={saveSettingsAction} submit="Save settings" className="flex flex-col gap-5">
            <Field label="Mode" hint="Test: only the authorised test numbers can be called. Live also needs the three confirmations below.">
              <Select name="mode" defaultValue={s.mode}><option value="test">Test</option><option value="live">Live</option></Select>
            </Field>
            <Field label="Authorised test numbers" hint="10-digit mobiles of people who agreed to be called for testing. One per line."><Textarea name="testNumbers" rows={3} defaultValue={s.testNumbers.join("\n")} /></Field>
            <fieldset className="flex flex-col gap-2 rounded-[12px] border border-[var(--line)] p-3">
              <legend className="px-1 text-sm font-semibold">Telecom confirmations {liveReady(s) ? <Badge tone="ok">all confirmed</Badge> : <Badge tone="alert">not confirmed</Badge>}</legend>
              {chk("a1", "FITRON (or the calling partner) is registered as a sender and telemarketer under TRAI's rules, with approved headers and templates where they apply.", s.attest.telemarketerRegistered)}
              {chk("a2", "The route and number series being used are approved for AI-generated promotional calls, in writing from the provider.", s.attest.routeAllowsAiPromotionalCalls)}
              {chk("a3", "Numbers are checked against the Do Not Disturb register and the customer's preferences before they are called.", s.attest.dndScrubbed)}
              {s.attest.at && <p className="text-xs text-[var(--muted)]">Last changed by {s.attest.by} on {new Date(s.attest.at).toLocaleDateString("en-IN")}. This is your own confirmation and is audited; FITRON cannot check it for you.</p>}
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-3">
              {num("maxAttempts", "Most attempts per lead", s.maxAttempts)}
              {num("retryGapMinutes", "Wait before retry (minutes)", s.retryGapMinutes)}
              {num("dailyCallCap", "Calls per day (all campaigns)", s.dailyCallCap)}
              {num("retentionDays", "Keep transcripts (days)", s.retentionDays, "Then they are deleted")}
            </div>
            {chk("storeTranscripts", "Store transcripts (phone numbers and emails are removed from them)", s.storeTranscripts)}
            <fieldset className="flex flex-col gap-2"><legend className="mb-1 text-sm font-semibold">Demo booking</legend>
              <div className="flex flex-wrap gap-3">{DAYS.map((d, i) => <label key={d} className="flex items-center gap-1 text-sm"><input type="checkbox" name="demoDays" value={i} defaultChecked={s.demoDays.includes(i)} /> {d.slice(0, 3)}</label>)}</div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="From (India)"><Input name="demoFrom" type="time" defaultValue={s.demoFrom} required /></Field>
                <Field label="Until"><Input name="demoTo" type="time" defaultValue={s.demoTo} required /></Field>
                {num("demoMinHours", "Notice needed (hours)", s.demoMinHours)}
              </div>
            </fieldset>
            <fieldset className="flex flex-col gap-3 rounded-[12px] border border-[var(--line)] p-3"><legend className="px-1 text-sm font-semibold">Introductory offer (the agent quotes only this)</legend>
              {chk("offerActive", "Offer is running", s.offer.active)}
              <div className="grid gap-4 sm:grid-cols-3">
                {num("freeMonths", "Free months", s.offer.freeMonths)}
                {num("percentOff", "Percent off afterwards", s.offer.percentOff)}
                <Field label="Plan"><Select name="plan" defaultValue={s.offer.plan}>{PLANS.filter((p) => p.product === "GYM_ACCOUNTING").map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</Select></Field>
                {num("slotsTotal", "First customers (places)", s.offer.slotsTotal)}
                {num("slotsClaimed", "Places already taken", s.offer.slotsClaimed)}
              </div>
              <Field label="Terms the agent can read out" hint="Exact conditions, if any."><Textarea name="terms" rows={2} maxLength={600} defaultValue={s.offer.terms} /></Field>
              <p className="text-xs text-[var(--muted)]">The agent would say: {offer.lines.join(" ")}</p>
            </fieldset>
          </CrmForm>
        </Card>
        <div className="flex flex-col gap-5">
          <Card title="Test call">
            <p className="mb-3 text-sm">Rings one of the authorised test numbers with the real agent, so you can talk to it. Needs the provider settings (see Agent setup).</p>
            <CrmForm action={testCallAction} submit="Call me now"><Field label="Test number"><Input name="phone" inputMode="numeric" placeholder="9876543210" required /></Field></CrmForm>
            {s.testNumbers.length === 0 && <div className="mt-3"><Notice tone="accent">Add your number under Authorised test numbers and save first.</Notice></div>}
          </Card>
        </div>
      </div>
    </>
  );
}
