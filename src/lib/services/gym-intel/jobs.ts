import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { GYM_CATEGORIES, INDIA_STATES, stateByCode, type GymCategory, type JobKind } from "@/lib/domain/gym-intel/constants";
import { parseOverpass } from "@/lib/domain/gym-intel/osm";
import type { GiSettings } from "@/lib/domain/gym-intel/settings";
import { SOURCES, isSourceKey, type SourceKey } from "@/lib/domain/gym-intel/sources";
import { need, type CrmUser } from "../crm-access";
import { UserError } from "../errors";
import { DEFAULT_OVERPASS, SourceError, discoverOsmState, readGymSite } from "./adapters";
import { getSettings, intelAudit, noteSourceRun, sourceEnabled } from "./core";
import type { FetchLike } from "./fetch";
import { seedStates } from "./geo";
import { recordObservation } from "./persist";

// Collection jobs: created by a Super Admin, advanced a step at a time by the worker, and able to resume from their checkpoint
// after a crash, a timeout or a deploy. A step is idempotent: running it twice records the same observations once.

const LEASE_MS = 6 * 60_000;
const MAX_ERRORS = 40;

export type JobScope = { states: string[]; categories: GymCategory[]; /** ENRICHMENT: only gyms whose phone is missing */ onlyMissingPhone?: boolean; /** ENRICHMENT: just these gyms */ gymIds?: string[] };
type Checkpoint = { done: { code: string; records: number; phones: number }[]; failed: { code: string; error: string }[]; cursor?: string | null; processed?: number };

const categoryKeys = GYM_CATEGORIES.map((c) => c[0]) as string[];

export async function createJob(u: CrmUser, i: { source: string; kind?: string; states: string[]; categories?: string[]; onlyMissingPhone?: boolean; gymIds?: string[]; confirmed?: boolean }) {
  need(u, "intel.manage");
  if (!isSourceKey(i.source) || !SOURCES[i.source].live) throw new UserError("Choose a source that collects from the internet: OpenStreetMap or gym websites.");
  const source = i.source as SourceKey;
  if (!(await sourceEnabled(source))) throw new UserError(`${SOURCES[source].name} is switched off. Turn it on in Sources and integrations once you have read its terms.`);
  const kind: JobKind = source === "public_website" ? "ENRICHMENT" : i.kind === "REFRESH" ? "REFRESH" : "DISCOVERY";
  const settings = await getSettings();
  const states = [...new Set(i.states)];
  if (states.some((s) => !stateByCode(s))) throw new UserError("One of the states isn't on the list.");
  if (source === "osm_overpass" && !states.length) throw new UserError("Choose at least one state or union territory.");
  const categories = (i.categories?.length ? i.categories : settings.categories).filter((c) => categoryKeys.includes(c)) as GymCategory[];
  if (!categories.length) throw new UserError("Choose at least one gym category.");
  if (states.length > settings.confirmAbove && !i.confirmed) throw new UserError(`This covers ${states.length} states and will make many requests. Tick “I understand” to start it.`);
  const scope: JobScope = { states, categories, onlyMissingPhone: i.onlyMissingPhone ?? true, ...(i.gymIds?.length ? { gymIds: i.gymIds.slice(0, 5000) } : {}) };
  await seedStates();
  return db.$transaction(async (tx) => {
    const job = await tx.giJob.create({ data: { source, kind, scope, status: "QUEUED", checkpoint: { done: [], failed: [] } satisfies Checkpoint, createdById: u.id } });
    await tx.giGeo.updateMany({ where: { level: "STATE", code: { in: states }, status: { in: ["NOT_STARTED", "FAILED", "COMPLETED_NO_RESULTS", "PARTIALLY_COMPLETED", "REQUIRES_REVIEW"] } }, data: { status: "QUEUED", lastJobId: job.id } });
    await intelAudit(tx, u, `Collection job created: ${SOURCES[source].name}, ${states.length || "all"} area${states.length === 1 ? "" : "s"}`, { jobId: job.id, source });
    return job;
  });
}

export async function cancelJob(u: CrmUser, id: string) {
  need(u, "intel.manage");
  await db.$transaction(async (tx) => {
    const j = await tx.giJob.findUnique({ where: { id } });
    if (!j || !["QUEUED", "RUNNING", "PAUSED"].includes(j.status)) throw new UserError("That job can't be cancelled.");
    await tx.giJob.update({ where: { id }, data: { status: "CANCELLED", completedAt: new Date(), leaseUntil: null } });
    await resetGeo(tx, j);
    await intelAudit(tx, u, "Collection job cancelled", { jobId: id });
  });
}

export async function pauseJob(u: CrmUser, id: string, pause: boolean) {
  need(u, "intel.manage");
  const j = await db.giJob.findUnique({ where: { id } });
  if (!j || !(pause ? ["QUEUED", "RUNNING"] : ["PAUSED"]).includes(j.status)) throw new UserError("That job can't be changed.");
  await db.giJob.update({ where: { id }, data: { status: pause ? "PAUSED" : "QUEUED", leaseUntil: null } });
  await intelAudit(db, u, pause ? "Collection job paused" : "Collection job resumed", { jobId: id });
}

/** A failed or cancelled job goes back in the queue and carries on from its checkpoint: areas already done are not repeated. */
export async function retryJob(u: CrmUser, id: string) {
  need(u, "intel.manage");
  const j = await db.giJob.findUnique({ where: { id } });
  if (!j || !["FAILED", "CANCELLED"].includes(j.status)) throw new UserError("Only a failed or cancelled job can be retried.");
  const cp = (j.checkpoint ?? { done: [], failed: [] }) as Checkpoint;
  await db.giJob.update({ where: { id }, data: { status: "QUEUED", attempts: 0, errorSummary: null, completedAt: null, leaseUntil: null, checkpoint: { ...cp, failed: [] } } });
  await intelAudit(db, u, "Collection job retried", { jobId: id });
}

export async function listJobs(u: CrmUser, take = 50) {
  need(u, "intel.view");
  return db.giJob.findMany({ orderBy: { createdAt: "desc" }, take });
}
export async function jobDetail(u: CrmUser, id: string) {
  need(u, "intel.view");
  const job = await db.giJob.findUnique({ where: { id } });
  if (!job) return null;
  const contribution = await db.giGymSource.groupBy({ by: ["source"], where: { jobId: id }, _count: { _all: true } });
  return { job, contribution };
}

async function resetGeo(tx: Prisma.TransactionClient, j: { id: string; scope: Prisma.JsonValue }) {
  const states = ((j.scope as JobScope).states ?? []) as string[];
  await tx.giGeo.updateMany({ where: { level: "STATE", code: { in: states }, status: { in: ["QUEUED", "IN_PROGRESS"] }, lastJobId: j.id }, data: { status: "NOT_STARTED" } });
}

const pushError = (errors: Prisma.JsonValue | null | undefined, msg: string) => [...(((errors as string[] | null) ?? []).slice(-(MAX_ERRORS - 1))), `${new Date().toISOString()} ${msg}`.slice(0, 400)];

/** Counts a state's gyms from the database, so coverage shows what is stored, not what a response said. */
async function stateCount(name: string) {
  const [gyms, withPhone] = await Promise.all([db.giGym.count({ where: { state: name } }), db.giGym.count({ where: { state: name, phoneNorm: { not: null } } })]);
  return { gyms, withPhone };
}

type Deps = { fetch?: FetchLike; now?: Date; /** Tests only: replaces the public-address check, which needs real DNS */ checkHost?: (h: string) => Promise<void> };

/** Does one step of a job (one state, or one batch of gym sites). Returns whether there is more to do. */
export async function runJobStep(jobId: string, deps: Deps = {}): Promise<{ ran: boolean; more: boolean }> {
  const f = deps.fetch ?? fetch;
  const now = deps.now ?? new Date();
  // Take the job: only if nobody else holds it.
  const taken = await db.giJob.updateMany({ where: { id: jobId, status: { in: ["QUEUED", "RUNNING"] }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] }, data: { status: "RUNNING", leaseUntil: new Date(now.getTime() + LEASE_MS), startedAt: now } });
  if (!taken.count) return { ran: false, more: false };
  const job = await db.giJob.findUniqueOrThrow({ where: { id: jobId } });
  const settings = await getSettings();
  const scope = job.scope as unknown as JobScope;
  const cp = (job.checkpoint ?? { done: [], failed: [] }) as Checkpoint;
  const source = job.source as SourceKey;
  try {
    if (!(await sourceEnabled(source))) throw new SourceError(`${SOURCES[source].name} was switched off.`, false);
    const more = source === "public_website" ? await enrichStep(job, scope, cp, settings, f, now, deps.checkHost) : await osmStep(job, scope, cp, settings, f, now);
    const after = await db.giJob.findUniqueOrThrow({ where: { id: jobId }, select: { status: true } });
    if (after.status === "CANCELLED" || after.status === "PAUSED") return { ran: true, more: false };
    if (more) {
      await db.giJob.update({ where: { id: jobId }, data: { status: "QUEUED", leaseUntil: null } });
      return { ran: true, more: true };
    }
    const failedAreas = ((await db.giJob.findUniqueOrThrow({ where: { id: jobId } })).checkpoint as Checkpoint).failed;
    await db.giJob.update({ where: { id: jobId }, data: { status: failedAreas.length ? "FAILED" : "COMPLETED", completedAt: new Date(), leaseUntil: null, errorSummary: failedAreas.length ? `${failedAreas.length} area${failedAreas.length === 1 ? "" : "s"} failed: ${failedAreas.map((x) => x.code).join(", ")}` : null } });
    return { ran: true, more: false };
  } catch (e) {
    const retryable = !(e instanceof SourceError) || e.retryable;
    const msg = (e as Error).message;
    await noteSourceRun(source, { ok: false, error: msg });
    const attempts = job.attempts + 1;
    const giveUp = !retryable || attempts > settings.retryAttempts;
    await db.giJob.update({
      where: { id: jobId },
      data: giveUp
        ? { status: "FAILED", attempts, completedAt: new Date(), leaseUntil: null, errorSummary: msg.slice(0, 300), errors: pushError(job.errors, msg) }
        : { status: "QUEUED", attempts, leaseUntil: new Date(now.getTime() + settings.retryBackoffSeconds * 1000 * 2 ** (attempts - 1)), errorSummary: `Retrying after: ${msg.slice(0, 250)}`, errors: pushError(job.errors, msg) },
    });
    if (giveUp) await db.giGeo.updateMany({ where: { level: "STATE", lastJobId: jobId, status: { in: ["QUEUED", "IN_PROGRESS"] } }, data: { status: "FAILED" } });
    return { ran: true, more: !giveUp };
  }
}

async function osmStep(job: { id: string; attempts: number; errors: Prisma.JsonValue | null }, scope: JobScope, cp: Checkpoint, settings: GiSettings, f: FetchLike, now: Date) {
  const doneCodes = new Set(cp.done.map((d) => d.code));
  const failedCodes = new Set(cp.failed.map((d) => d.code));
  const code = scope.states.find((s) => !doneCodes.has(s) && !failedCodes.has(s));
  if (!code) return false;
  const st = stateByCode(code)!;
  const cfg = ((await db.giSource.findUnique({ where: { key: "osm_overpass" } }))?.config ?? {}) as { endpoint?: string; requestsPerMinute?: number };
  await db.giGeo.updateMany({ where: { level: "STATE", code }, data: { status: "IN_PROGRESS", lastJobId: job.id } });
  let parsed;
  try {
    parsed = await discoverOsmState(code, st.name, scope.categories, { endpoint: cfg.endpoint ?? DEFAULT_OVERPASS, perMinute: cfg.requestsPerMinute ?? settings.requestsPerMinute, fetch: f });
  } catch (e) {
    // A busy or unreachable server is tried again after a back-off; only when the attempts are used up is this state marked failed.
    if (!(e instanceof SourceError) || (e.retryable && job.attempts < settings.retryAttempts)) throw e;
    // This state failed; the job carries on with the next and ends FAILED if any failed, so a retry redoes only these.
    const msg = (e as Error).message;
    await db.giGeo.updateMany({ where: { level: "STATE", code }, data: { status: "FAILED", checkedAt: now } });
    await db.giJob.update({ where: { id: job.id }, data: { checkpoint: { ...cp, failed: [...cp.failed, { code, error: msg.slice(0, 200) }] }, errors: pushError(job.errors, msg), attempts: 0 } });
    await noteSourceRun("osm_overpass", { ok: false, error: msg });
    return scope.states.some((s) => s !== code && !doneCodes.has(s) && !failedCodes.has(s));
  }
  let records = 0;
  let phones = 0;
  let dups = 0;
  for (const o of parsed.observations) {
    const r = await recordObservation(o, { jobId: job.id, settings, now });
    records++;
    phones += r.phones ? 1 : 0;
    dups += r.ambiguous;
  }
  const { gyms } = await stateCount(st.name);
  await db.giGeo.updateMany({ where: { level: "STATE", code }, data: { status: records ? "COMPLETED_WITH_RESULTS" : "COMPLETED_NO_RESULTS", gymsFound: gyms, checkedAt: now, lastJobId: job.id } });
  await db.giJob.update({ where: { id: job.id }, data: { recordsFound: { increment: records }, phonesFound: { increment: phones }, duplicates: { increment: dups }, checkpoint: { ...cp, done: [...cp.done, { code, records, phones }] } } });
  await noteSourceRun("osm_overpass", { ok: true, records, phones });
  return scope.states.some((s) => s !== code && !doneCodes.has(s) && !failedCodes.has(s));
}

async function enrichStep(job: { id: string; attempts: number; errors: Prisma.JsonValue | null }, scope: JobScope, cp: Checkpoint, settings: GiSettings, f: FetchLike, now: Date, checkHost?: (h: string) => Promise<void>) {
  const names = scope.states.map((s) => stateByCode(s)?.name).filter(Boolean) as string[];
  const where: Prisma.GiGymWhereInput = { website: { not: null }, id: { gt: cp.cursor ?? "", ...(scope.gymIds ? { in: scope.gymIds } : {}) }, ...(names.length ? { state: { in: names } } : {}), ...(scope.onlyMissingPhone ? { phoneNorm: null } : { lastChecked: { lt: new Date(now.getTime() - settings.cacheHours * 3_600_000) } }), promotion: { not: "DO_NOT_CONTACT" } };
  const gyms = await db.giGym.findMany({ where, orderBy: { id: "asc" }, take: settings.batchSize });
  if (!gyms.length) return false;
  const cfg = ((await db.giSource.findUnique({ where: { key: "public_website" } }))?.config ?? {}) as { requestsPerMinute?: number };
  let records = 0;
  let phones = 0;
  const skipNotes: string[] = [];
  for (const g of gyms) {
    try {
      const r = await readGymSite(g.website!, { fetch: f, perMinute: cfg.requestsPerMinute ?? settings.requestsPerMinute, checkHost });
      if ("skipped" in r && !("observation" in r)) {
        skipNotes.push(`${g.id}: ${r.skipped}`);
        continue;
      }
      if (!("observation" in r)) continue;
      const res = await recordObservation({ source: "public_website", sourceUrl: r.observation.sourceUrl, sourceRecordId: `site:${g.id}`, name: g.name, phonesRaw: r.observation.phonesRaw, website: g.website, evidence: r.observation.evidence }, { jobId: job.id, settings, now, attachTo: g.id });
      records++;
      phones += res.phones ? 1 : 0;
    } catch (e) {
      skipNotes.push(`${g.id}: ${(e as Error).message.slice(0, 80)}`);
    }
  }
  await db.giJob.update({ where: { id: job.id }, data: { recordsFound: { increment: records }, phonesFound: { increment: phones }, checkpoint: { ...cp, cursor: gyms[gyms.length - 1]!.id, processed: (cp.processed ?? 0) + gyms.length }, ...(skipNotes.length ? { errors: skipNotes.reduce<string[]>((acc, n) => pushError(acc, n), (job.errors as string[] | null) ?? []) } : {}) } });
  await noteSourceRun("public_website", { ok: true, records, phones });
  return gyms.length === settings.batchSize;
}

/** The worker: advances every due job until the time budget is spent. Called by the scheduled job and by the Super Admin's “Run now”. */
export async function runDueJobs(budgetMs = 240_000, deps: Deps = {}) {
  const started = Date.now();
  const ran: { id: string; steps: number }[] = [];
  const now = () => deps.now ?? new Date();
  while (Date.now() - started < budgetMs) {
    const due = await db.giJob.findMany({ where: { status: { in: ["QUEUED", "RUNNING"] }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now() } }] }, orderBy: { createdAt: "asc" }, take: 5, select: { id: true } });
    if (!due.length) break;
    let progressed = false;
    for (const j of due) {
      if (Date.now() - started >= budgetMs) break;
      const r = await runJobStep(j.id, deps);
      if (r.ran) {
        progressed = true;
        const e = ran.find((x) => x.id === j.id);
        if (e) e.steps++;
        else ran.push({ id: j.id, steps: 1 });
      }
    }
    if (!progressed) break;
  }
  return ran;
}

/** One-off import of an uploaded Overpass JSON file: runs now, in the request, and is recorded as a job like any other. */
export async function importOsmFile(u: CrmUser, text: string, fileName: string) {
  need(u, "intel.manage");
  if (!(await sourceEnabled("osm_extract"))) throw new UserError("“OpenStreetMap extract” is switched off. Turn it on in Sources and integrations first.");
  let parsed;
  try {
    parsed = parseOverpass(JSON.parse(text), "osm_extract");
  } catch (e) {
    throw new UserError(e instanceof SyntaxError ? "That file isn't valid JSON." : (e as Error).message);
  }
  const settings = await getSettings();
  const job = await db.giJob.create({ data: { source: "osm_extract", kind: "IMPORT", scope: { file: fileName.slice(0, 120) }, status: "RUNNING", createdById: u.id, startedAt: new Date() } });
  let records = 0;
  let phones = 0;
  let dups = 0;
  try {
    for (const o of parsed.observations) {
      const r = await recordObservation(o, { jobId: job.id, settings });
      records++;
      phones += r.phones ? 1 : 0;
      dups += r.ambiguous;
    }
  } catch (e) {
    await db.giJob.update({ where: { id: job.id }, data: { status: "FAILED", errorSummary: (e as Error).message.slice(0, 300), recordsFound: records, phonesFound: phones, completedAt: new Date() } });
    throw new UserError(`The import stopped after ${records} records: ${(e as Error).message}`);
  }
  await db.giJob.update({ where: { id: job.id }, data: { status: "COMPLETED", recordsFound: records, phonesFound: phones, duplicates: dups, completedAt: new Date(), checkpoint: { skipped: parsed.skipped } } });
  await noteSourceRun("osm_extract", { ok: true, records, phones });
  await intelAudit(db, u, `Imported ${records} gym records from an OpenStreetMap file`, { jobId: job.id });
  return { jobId: job.id, records, phones, duplicates: dups, skipped: parsed.skipped };
}

export const allStates = () => INDIA_STATES;
