"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireCrm } from "@/lib/auth/crm";
import { simpleAction } from "@/lib/form-action";
import type { FormState } from "@/lib/validation/common";
import { INDIA_STATES } from "@/lib/domain/gym-intel/constants";
import { SettingsSchema } from "@/lib/domain/gym-intel/settings";
import { saveSettings, setSource } from "@/lib/services/gym-intel/core";
import { addManualGym, decideDup, recordReachability, setReview, suppressNumber } from "@/lib/services/gym-intel/gyms";
import { cancelJob, createJob, pauseJob, retryJob, runDueJobs } from "@/lib/services/gym-intel/jobs";
import { assignPromotedByArea, promoteGym, type PromoteAction } from "@/lib/services/gym-intel/promote";
import { UserError } from "@/lib/services/errors";

// Every action finds out who is asking from the session; the services check the permission and write the audit entry.

const s = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? (fd.get(k) as string).trim() : "");
const all = (fd: FormData, k: string) => fd.getAll(k).filter((v): v is string => typeof v === "string");
const run = async (fn: (u: Awaited<ReturnType<typeof requireCrm>>) => Promise<unknown>, ok: string | ((r: unknown) => string), paths: string[]): Promise<FormState> => {
  const u = await requireCrm("intel.view");
  let out: unknown;
  const r = await simpleAction(async () => {
    out = await fn(u);
  }, "Done.");
  for (const p of paths) revalidatePath(p);
  return r?.ok ? { ...r, message: typeof ok === "function" ? ok(out) : ok } : r;
};
const intel = ["/crm/intel", "/crm/intel/discovery", "/crm/intel/gyms", "/crm/intel/phones", "/crm/intel/coverage", "/crm/intel/duplicates", "/crm/intel/sources"];

export async function createJobAction(_: FormState, fd: FormData): Promise<FormState> {
  const everything = s(fd, "scope") === "all";
  const states = everything ? INDIA_STATES.map((x) => x.code) : all(fd, "states");
  const r = await run((u) => createJob(u, { source: s(fd, "source"), states, categories: all(fd, "categories"), onlyMissingPhone: fd.get("onlyMissingPhone") === "on", confirmed: fd.get("confirmed") === "on" }), `Job queued and started${states.length ? ` for ${states.length} area${states.length === 1 ? "" : "s"}` : ""}. It works in the background and the table below updates by itself; the scheduled worker carries on every half hour if it is interrupted.`, intel);
  // Start straight away, after the answer has been sent, so nobody has to find a second button.
  if (r?.ok) after(() => runDueJobs(240_000).catch(() => undefined));
  return r;
}

export async function jobControlAction(_: FormState, fd: FormData): Promise<FormState> {
  const id = s(fd, "id");
  const op = s(fd, "op");
  return run(async (u) => {
    if (op === "cancel") return cancelJob(u, id);
    if (op === "pause") return pauseJob(u, id, true);
    if (op === "resume") return pauseJob(u, id, false);
    if (op === "retry") return retryJob(u, id);
    throw new UserError("Unknown action.");
  }, "Done.", intel);
}

export async function runNowAction(): Promise<FormState> {
  return run(async (u) => {
    if (!u.can("intel.manage")) throw new UserError("Only the Super Admin can run collection.");
    return runDueJobs(200_000);
  }, (r) => ((r as { id: string }[]).length ? `Advanced ${(r as { id: string }[]).length} job${(r as { id: string }[]).length === 1 ? "" : "s"}.` : "Nothing was waiting to run."), intel);
}

export async function setSourceAction(_: FormState, fd: FormData): Promise<FormState> {
  const rpm = s(fd, "rpm");
  return run((u) => setSource(u, s(fd, "key"), { enabled: s(fd, "enabled") === "1", reviewedTerms: fd.get("reviewed") === "on", requestsPerMinute: rpm ? Number(rpm) : undefined, endpoint: s(fd, "endpoint") || undefined }), "Source updated.", intel);
}

export async function saveSettingsAction(_: FormState, fd: FormData): Promise<FormState> {
  const n = (k: string) => Number(s(fd, k));
  const data = {
    categories: all(fd, "categories"),
    requestsPerMinute: n("requestsPerMinute"), concurrency: n("concurrency"), retryAttempts: n("retryAttempts"), retryBackoffSeconds: n("retryBackoffSeconds"),
    cacheHours: n("cacheHours"), batchSize: n("batchSize"), staleAfterDays: n("staleAfterDays"), retentionDays: n("retentionDays"), confirmAbove: n("confirmAbove"),
    sameNameThreshold: n("sameNameThreshold"), ambiguousNameThreshold: n("ambiguousNameThreshold"), nearMeters: n("nearMeters"),
    aiEnabled: fd.get("aiEnabled") === "on", aiDailyCap: n("aiDailyCap"),
    enrichMissingPhones: fd.get("enrichMissingPhones") === "on", recheckDuplicates: fd.get("recheckDuplicates") === "on", acceptTollFree: fd.get("acceptTollFree") === "on",
    exportDefaults: { onlyWithPhone: fd.get("onlyWithPhone") === "on", includeConflicts: fd.get("includeConflicts") === "on" },
  };
  void SettingsSchema;
  return run((u) => saveSettings(u, data), "Settings saved.", ["/crm/intel/settings"]);
}

export async function decideDupAction(_: FormState, fd: FormData): Promise<FormState> {
  const action = s(fd, "action") as "MERGE" | "KEEP_SEPARATE" | "DISMISS";
  return run((u) => decideDup(u, s(fd, "id"), action, s(fd, "survivor") || undefined), action === "MERGE" ? "Merged. All the evidence was kept." : "Decision recorded.", ["/crm/intel/duplicates", "/crm/intel", "/crm/intel/gyms"]);
}

export async function promoteAction(_: FormState, fd: FormData): Promise<FormState> {
  const id = s(fd, "id");
  return run((u) => promoteGym(u, id, { action: s(fd, "action") as PromoteAction, leadId: s(fd, "leadId") || undefined }), (r) => {
    const x = r as { result: string; leadId?: string; reason?: string };
    return x.result === "CREATED" ? `Lead ${x.leadId} created.` : x.result === "LINKED" ? `Linked to lead ${x.leadId}.` : x.result === "ALREADY_PROMOTED" ? `Already lead ${x.leadId}.` : x.result === "SKIPPED" ? "Skipped." : (x.reason ?? "Flagged as a possible duplicate.");
  }, [`/crm/intel/gyms/${id}`, ...intel, "/crm/leads"]);
}

export async function reviewAction(_: FormState, fd: FormData): Promise<FormState> {
  const id = s(fd, "id");
  return run((u) => setReview(u, id, s(fd, "status") as "REVIEWED" | "REJECTED" | "NEW"), "Saved.", [`/crm/intel/gyms/${id}`]);
}

export async function reachabilityAction(_: FormState, fd: FormData): Promise<FormState> {
  const id = s(fd, "id");
  return run((u) => recordReachability(u, id, s(fd, "result") as "CONFIRMED" | "UNREACHABLE" | "NOT_TESTED", s(fd, "evidence")), "Recorded.", [`/crm/intel/gyms/${id}`, "/crm/intel/phones"]);
}

export async function suppressAction(_: FormState, fd: FormData): Promise<FormState> {
  const id = s(fd, "id");
  return run((u) => suppressNumber(u, id, s(fd, "reason")), "Added to the do-not-contact list.", [`/crm/intel/gyms/${id}`, "/crm/intel/gyms"]);
}

export async function addGymAction(_: FormState, fd: FormData): Promise<FormState> {
  return run((u) => addManualGym(u, { name: s(fd, "name"), phone: s(fd, "phone"), website: s(fd, "website"), address: s(fd, "address"), state: s(fd, "state"), district: s(fd, "district"), city: s(fd, "city"), pin: s(fd, "pin"), evidence: s(fd, "evidence") }), (r) => `Saved as ${(r as { gymId: string }).gymId}.`, ["/crm/intel/gyms", "/crm/intel"]);
}

export async function assignAreaAction(_: FormState, fd: FormData): Promise<FormState> {
  return run((u) => assignPromotedByArea(u, { state: s(fd, "state") || undefined, district: s(fd, "district") || undefined, city: s(fd, "city") || undefined }, s(fd, "owner")), (r) => `Assigned ${(r as { assigned: number }).assigned} lead${(r as { assigned: number }).assigned === 1 ? "" : "s"}.`, ["/crm/leads", "/crm/intel/gyms"]);
}

