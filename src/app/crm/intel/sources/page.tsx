import { requireCrm } from "@/lib/auth/crm";
import { listSources } from "@/lib/services/gym-intel/core";
import { aiUsedToday, aiAvailable } from "@/lib/services/gym-intel/ai";
import { Badge, Card, Field, Input, PageHeader } from "@/components/ui";
import { CrmForm } from "../../crm-form";
import { when } from "../parts";
import { setSourceAction } from "../actions";

export const metadata = { title: "Sources & integrations · FITRON CRM" };

export default async function SourcesPage() {
  const u = await requireCrm("intel.manage");
  const sources = await listSources(u);
  const aiUsed = await aiUsedToday();
  const aiKey = aiAvailable();
  return (
    <>
      <PageHeader kicker="Gym Intelligence" title="Sources & integrations" subtitle="Every source starts off. Turn one on only after you have read its terms. Credentials are never shown here." />
      <div className="grid items-start gap-5 lg:grid-cols-2">
        {sources.map((s) => (
          <Card key={s.key} title={s.name} action={<Badge tone={s.health === "OK" ? "ok" : s.health === "ERRORS" ? "alert" : "neutral"}>{s.enabled ? s.health.replace("_", " ").toLowerCase() : "off"}</Badge>}>
            <dl className="m-0 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-[var(--muted)]">Type</dt><dd className="m-0">{s.type}</dd>
              <dt className="text-[var(--muted)]">Where</dt><dd className="m-0 break-words">{s.location}</dd>
              <dt className="text-[var(--muted)]">Access</dt><dd className="m-0">{s.access}</dd>
              <dt className="text-[var(--muted)]">Licence</dt><dd className="m-0">{s.license}{s.licenseUrl && <> · <a href={s.licenseUrl} className="underline" rel="noopener noreferrer" target="_blank">terms</a></>}</dd>
              <dt className="text-[var(--muted)]">Permitted</dt><dd className="m-0">{s.permitted}</dd>
              <dt className="text-[var(--muted)]">Last success</dt><dd className="m-0">{when(s.lastSuccessAt)}</dd>
              <dt className="text-[var(--muted)]">Found</dt><dd className="m-0">{s.recordsFound.toLocaleString("en-IN")} records · {s.phonesFound.toLocaleString("en-IN")} with phones · {s.errorCount} errors</dd>
              {s.key === "ai_assisted" && <><dt className="text-[var(--muted)]">Claude today</dt><dd className="m-0">{aiUsed} call{aiUsed === 1 ? "" : "s"} used{aiKey ? "" : " · the server has no ANTHROPIC_API_KEY"}. The daily cap is in Collection settings; AI is off until you tick it there.</dd></>}
              {s.lastError && <><dt className="text-[var(--muted)]">Latest error</dt><dd className="m-0 text-[var(--alert)]">{s.lastError}</dd></>}
              {s.reviewedAt && <><dt className="text-[var(--muted)]">Terms reviewed</dt><dd className="m-0">{when(s.reviewedAt)}</dd></>}
            </dl>
            <div className="mt-4">
              <CrmForm action={setSourceAction} submit={s.enabled ? "Save" : "Turn on"}>
                <input type="hidden" name="key" value={s.key} />
                <input type="hidden" name="enabled" value="1" />
                {s.needsReview && !s.enabled && <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="reviewed" className="mt-1" /> I have read this source&apos;s terms and the use is permitted</label>}
                {s.live && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Requests per minute"><Input name="rpm" type="number" min={1} max={60} defaultValue={s.config.requestsPerMinute ?? s.defaultRate} /></Field>
                    {s.key === "osm_overpass" && <Field label="Overpass endpoint" hint="https only; leave to use overpass-api.de"><Input name="endpoint" defaultValue={s.config.endpoint ?? ""} placeholder="https://overpass-api.de/api/interpreter" /></Field>}
                  </div>
                )}
              </CrmForm>
              {s.enabled && <div className="mt-2"><CrmForm action={setSourceAction} submit="Turn off" variant="danger"><input type="hidden" name="key" value={s.key} /><input type="hidden" name="enabled" value="0" /></CrmForm></div>}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
