import Link from "next/link";
import { requireCrm } from "@/lib/auth/crm";
import { GYM_CATEGORIES, INDIA_STATES } from "@/lib/domain/gym-intel/constants";
import { SOURCES, type SourceKey } from "@/lib/domain/gym-intel/sources";
import { listSources, getSettings } from "@/lib/services/gym-intel/core";
import { listJobs } from "@/lib/services/gym-intel/jobs";
import { Card, Empty, Field, Notice, PageHeader, ScrollRegion, Select, TABLE, TD, TH, TR } from "@/components/ui";
import { CrmForm } from "../../crm-form";
import { JobStatusBadge, when } from "../parts";
import { createJobAction, jobControlAction, runNowAction } from "../actions";

export const metadata = { title: "Gym discovery · FITRON CRM" };
export const maxDuration = 300;

const box = "flex items-center gap-2 text-sm";

export default async function DiscoveryPage() {
  const u = await requireCrm("intel.manage");
  const [sources, jobs, settings] = await Promise.all([listSources(u), listJobs(u, 40), getSettings()]);
  const live = sources.filter((s) => s.live && s.enabled);
  return (
    <>
      <PageHeader kicker="Gym Intelligence" title="Gym discovery" subtitle="Start a collection job, watch it, and retry what failed. Jobs carry on from where they stopped." />
      {live.length === 0 && <div className="mb-5"><Notice tone="accent">No collecting source is switched on. Open <Link href="/crm/intel/sources" className="underline">Sources &amp; integrations</Link>, read a source&apos;s terms and turn it on first.</Notice></div>}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card title="New collection job">
          <CrmForm action={createJobAction} submit="Queue job" className="flex flex-col gap-4">
            <Field label="Source"><Select name="source" required defaultValue={live[0]?.key ?? ""}>{live.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}</Select></Field>
            <fieldset className="flex flex-col gap-2"><legend className="mb-1 text-sm font-semibold">Where</legend>
              <label className={box}><input type="radio" name="scope" value="all" /> All India, all {INDIA_STATES.length} states and union territories (one state per step; confirm below)</label>
              <label className={box}><input type="radio" name="scope" value="selected" defaultChecked /> Only the areas ticked here (website enrichment: leave all unticked to cover every gym with a website)</label>
              <div className="grid max-h-56 grid-cols-1 gap-1 overflow-auto rounded-[10px] border border-[var(--line)] p-3 sm:grid-cols-2">
                {INDIA_STATES.map((s) => <label key={s.code} className={box}><input type="checkbox" name="states" value={s.code} /> {s.name}{s.ut ? " (UT)" : ""}</label>)}
              </div>
            </fieldset>
            <fieldset className="flex flex-col gap-2"><legend className="mb-1 text-sm font-semibold">Gym categories</legend>
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">{GYM_CATEGORIES.map(([k, l]) => <label key={k} className={box}><input type="checkbox" name="categories" value={k} defaultChecked={settings.categories.includes(k)} /> {l}</label>)}</div>
            </fieldset>
            <label className={box}><input type="checkbox" name="onlyMissingPhone" defaultChecked /> Website enrichment: only gyms with no phone yet</label>
            <label className={box}><input type="checkbox" name="confirmed" /> I understand a job over {settings.confirmAbove} areas makes many requests to a public service</label>
          </CrmForm>
        </Card>
        <Card title="Run now">
          <p className="mt-0 text-sm text-[var(--muted)]">The worker advances jobs every half hour on its own. Press this to move queued jobs along immediately (up to about three minutes of work).</p>
          <CrmForm action={runNowAction} submit="Run next batch now"><></></CrmForm>
          <p className="mb-0 text-xs text-[var(--muted)]">Limits: {settings.requestsPerMinute} requests a minute, {settings.retryAttempts} retries with {settings.retryBackoffSeconds}s back-off. <Link href="/crm/intel/settings" className="underline">Change</Link></p>
        </Card>
      </div>
      <div className="mt-6" />
      <Card title="Jobs">
        {jobs.length === 0 ? <Empty>No jobs yet.</Empty> : (
          <ScrollRegion label="Collection jobs">
            <table className={TABLE}>
              <thead><tr><th className={TH}>Job</th><th className={TH}>Status</th><th className={TH}>Where</th><th className={`${TH} text-right`}>Gyms</th><th className={`${TH} text-right`}>Phones</th><th className={`${TH} text-right`}>Duplicates</th><th className={TH}>Started</th><th className={TH}>Controls</th></tr></thead>
              <tbody>
                {jobs.map((j) => {
                  const sc = j.scope as { states?: string[]; file?: string };
                  const cp = (j.checkpoint ?? {}) as { done?: unknown[]; failed?: { code: string; error: string }[] };
                  const errors = (j.errors as string[] | null) ?? [];
                  return (
                    <tr key={j.id} className={TR}>
                      <td className={TD}><b>{SOURCES[j.source as SourceKey]?.name ?? j.source}</b><div className="text-xs text-[var(--muted)]">{j.kind.toLowerCase()} · {j.id.slice(-6)}</div></td>
                      <td className={TD}><JobStatusBadge s={j.status} />{j.errorSummary && <div className="mt-1 max-w-[260px] text-xs text-[var(--alert)]">{j.errorSummary}</div>}</td>
                      <td className={TD}>{sc.file ?? (sc.states?.length ? `${cp.done?.length ?? 0} of ${sc.states.length} areas${cp.failed?.length ? `, ${cp.failed.length} failed` : ""}` : "gym websites")}</td>
                      <td className={`${TD} text-right tabular-nums`}>{j.recordsFound}</td>
                      <td className={`${TD} text-right tabular-nums`}>{j.phonesFound}</td>
                      <td className={`${TD} text-right tabular-nums`}>{j.duplicates}</td>
                      <td className={`${TD} whitespace-nowrap`}>{when(j.startedAt ?? j.createdAt)}</td>
                      <td className={TD}>
                        <div className="flex flex-wrap gap-1.5">
                          {["QUEUED", "RUNNING"].includes(j.status) && <CrmForm action={jobControlAction} submit="Pause" className="contents"><input type="hidden" name="id" value={j.id} /><input type="hidden" name="op" value="pause" /></CrmForm>}
                          {j.status === "PAUSED" && <CrmForm action={jobControlAction} submit="Resume" className="contents"><input type="hidden" name="id" value={j.id} /><input type="hidden" name="op" value="resume" /></CrmForm>}
                          {["QUEUED", "RUNNING", "PAUSED"].includes(j.status) && <CrmForm action={jobControlAction} submit="Cancel" variant="danger" className="contents"><input type="hidden" name="id" value={j.id} /><input type="hidden" name="op" value="cancel" /></CrmForm>}
                          {["FAILED", "CANCELLED"].includes(j.status) && <CrmForm action={jobControlAction} submit="Retry" className="contents"><input type="hidden" name="id" value={j.id} /><input type="hidden" name="op" value="retry" /></CrmForm>}
                        </div>
                        {(errors.length > 0 || (cp.failed?.length ?? 0) > 0) && (
                          <details className="mt-2 max-w-[320px] text-xs"><summary className="cursor-pointer underline">Errors</summary>
                            <ul className="mt-1 list-disc pl-4">{(cp.failed ?? []).map((f) => <li key={f.code}>{f.code}: {f.error}</li>)}{errors.slice(-5).map((e, i) => <li key={i}>{e}</li>)}</ul>
                          </details>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollRegion>
        )}
      </Card>
    </>
  );
}
