import { requireCrm } from "@/lib/auth/crm";
import { GYM_CATEGORIES } from "@/lib/domain/gym-intel/constants";
import { getSettings } from "@/lib/services/gym-intel/core";
import { Card, Field, Input, PageHeader } from "@/components/ui";
import { CrmForm } from "../../crm-form";
import { saveSettingsAction } from "../actions";

export const metadata = { title: "Collection settings · FITRON CRM" };

export default async function SettingsPage() {
  const u = await requireCrm("intel.manage");
  const s = await getSettings();
  void u;
  const num = (name: keyof typeof s, label: string, hint?: string, step?: string) => <Field label={label} hint={hint}><Input name={name} type="number" step={step ?? "1"} defaultValue={String(s[name])} required /></Field>;
  const chk = (name: string, label: string, on: boolean) => <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={name} defaultChecked={on} /> {label}</label>;
  return (
    <>
      <PageHeader kicker="Gym Intelligence" title="Collection settings" subtitle="Safe defaults. Every value is checked when saved; a value out of range is refused, not changed." />
      <Card>
        <CrmForm action={saveSettingsAction} submit="Save settings" className="flex flex-col gap-5">
          <fieldset className="flex flex-col gap-2"><legend className="mb-1 text-sm font-semibold">Default gym categories</legend><div className="grid gap-1 sm:grid-cols-3">{GYM_CATEGORIES.map(([k, l]) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" name="categories" value={k} defaultChecked={s.categories.includes(k)} /> {l}</label>)}</div></fieldset>
          <div className="grid gap-4 sm:grid-cols-3">
            {num("requestsPerMinute", "Requests per minute", "1–60. Be polite to public services.")}
            {num("concurrency", "Concurrency", "1–4")}
            {num("retryAttempts", "Retry attempts", "0–6")}
            {num("retryBackoffSeconds", "Retry back-off (seconds)", "Doubles each time")}
            {num("cacheHours", "Cache (hours)", "Don't re-read a site sooner")}
            {num("batchSize", "Job batch size", "Sites per step")}
            {num("confirmAbove", "Confirm jobs over (areas)")}
            {num("staleAfterDays", "Stale after (days)")}
            {num("retentionDays", "Retention (days)", "How long evidence is kept")}
            {num("sameNameThreshold", "Same-gym name match", "0.70–1.00 at the same place", "0.01")}
            {num("ambiguousNameThreshold", "Send-to-review name match", "0.50–0.99", "0.01")}
            {num("nearMeters", "Same place within (metres)")}
            {num("aiDailyCap", "Claude calls per day (cap)", "0 turns AI off. Each call costs a little through your Anthropic key.")}
          </div>
          <div className="flex flex-col gap-2">
            {chk("aiEnabled", "Let Claude find gym websites and choose between a page's numbers (it can never supply a number)", s.aiEnabled)}
            {chk("enrichMissingPhones", "Look for missing phones on the gym's own website", s.enrichMissingPhones)}
            {chk("recheckDuplicates", "Recheck duplicates after each job", s.recheckDuplicates)}
            {chk("acceptTollFree", "Accept toll-free numbers as a gym's number", s.acceptTollFree)}
            {chk("onlyWithPhone", "Exports: only gyms with a phone by default", s.exportDefaults.onlyWithPhone)}
            {chk("includeConflicts", "Exports: include conflicting numbers by default", s.exportDefaults.includeConflicts)}
          </div>
        </CrmForm>
      </Card>
    </>
  );
}
