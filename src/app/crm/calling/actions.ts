"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireCrm } from "@/lib/auth/crm";
import { simpleAction } from "@/lib/form-action";
import type { FormState } from "@/lib/validation/common";
import { createCampaign, campaignStep } from "@/lib/services/ai-calling/campaigns";
import { getAcSettings, saveAcSettings, setEmergencyStop } from "@/lib/services/ai-calling/core";
import { placeCall, runDialer } from "@/lib/services/ai-calling/dialer";
import { addSuppressionByAdmin, ensureTestConsent, recordConsent, removeSuppression } from "@/lib/services/ai-calling/people";
import { createLead } from "@/lib/services/crm-leads";
import { UserError } from "@/lib/services/errors";
import { db } from "@/lib/db";

// Every action finds out who is asking from the session; the services check the permission and write the audit entry.
const s = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? (fd.get(k) as string).trim() : "");
const all = (fd: FormData, k: string) => fd.getAll(k).filter((v): v is string => typeof v === "string");
const run = async (fn: (u: Awaited<ReturnType<typeof requireCrm>>) => Promise<unknown>, ok: string | ((r: unknown) => string), paths: string[]): Promise<FormState> => {
  const u = await requireCrm("calling.manage");
  let out: unknown;
  const r = await simpleAction(async () => { out = await fn(u); }, "Done.");
  for (const p of paths) revalidatePath(p);
  return r?.ok ? { ...r, message: typeof ok === "function" ? ok(out) : ok } : r;
};
const base = ["/crm/calling", "/crm/calling/campaigns", "/crm/calling/settings", "/crm/calling/calls", "/crm/calling/dnc"];

export async function saveSettingsAction(_: FormState, fd: FormData): Promise<FormState> {
  const n = (k: string) => Number(s(fd, k));
  const data = {
    mode: s(fd, "mode"),
    testNumbers: s(fd, "testNumbers").split(/[\s,;]+/).map((x) => x.replace(/^\+?91(?=\d{10}$)/, "")).filter(Boolean),
    attest: { telemarketerRegistered: fd.get("a1") === "on", routeAllowsAiPromotionalCalls: fd.get("a2") === "on", dndScrubbed: fd.get("a3") === "on" },
    maxAttempts: n("maxAttempts"), retryGapMinutes: n("retryGapMinutes"), dailyCallCap: n("dailyCallCap"), storeTranscripts: fd.get("storeTranscripts") === "on", retentionDays: n("retentionDays"),
    demoDays: all(fd, "demoDays").map(Number), demoFrom: s(fd, "demoFrom"), demoTo: s(fd, "demoTo"), demoMinHours: n("demoMinHours"),
    offer: { active: fd.get("offerActive") === "on", freeMonths: n("freeMonths"), percentOff: n("percentOff"), plan: s(fd, "plan"), slotsTotal: n("slotsTotal"), slotsClaimed: n("slotsClaimed"), terms: s(fd, "terms") },
  };
  return run((u) => saveAcSettings(u, data), "Settings saved.", base);
}

export async function emergencyStopAction(_: FormState, fd: FormData): Promise<FormState> {
  const on = s(fd, "on") === "1";
  return run((u) => setEmergencyStop(u, on), on ? "EMERGENCY STOP is on. No new call will start." : "Emergency stop released. Paused campaigns stay paused until you resume them.", base);
}

export async function createCampaignAction(_: FormState, fd: FormData): Promise<FormState> {
  return run((u) => createCampaign(u, {
    name: s(fd, "name"), states: s(fd, "states").split(",").map((x) => x.trim()).filter(Boolean), stages: all(fd, "stages"),
    maxCalls: Number(s(fd, "maxCalls")), concurrency: Number(s(fd, "concurrency") || 1), from: s(fd, "from") || "10:00", to: s(fd, "to") || "18:00", testMode: s(fd, "testMode") !== "live",
  }), "Campaign created as a draft. Review it, then approve it.", base);
}

export async function campaignStepAction(_: FormState, fd: FormData): Promise<FormState> {
  const id = s(fd, "id");
  const step = s(fd, "step") as "approve" | "start" | "pause" | "resume" | "stop";
  const r = await run((u) => campaignStep(u, id, step, { reviewed: fd.get("reviewed") === "on" }), { approve: "Approved. It has not started.", start: "Started. Calls begin within the permitted hours.", pause: "Paused.", resume: "Resumed.", stop: "Stopped for good." }[step] ?? "Done.", [...base, `/crm/calling/campaigns/${id}`]);
  if (r?.ok && (step === "start" || step === "resume")) after(() => runDialer().catch(() => undefined));
  return r;
}

export async function testCallAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async (u) => {
    const phone = s(fd, "phone").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
    const st = await getAcSettings();
    if (!st.testNumbers.includes(phone)) throw new UserError("That number isn't in the authorised test numbers (Settings). Add it there first. Only people who agreed to the test should be listed.", "phone");
    let lead = await db.crmLead.findUnique({ where: { phone } });
    lead ??= await createLead(u, { contactName: "Test call", gymName: "FITRON test line", phone, plan: "professional", source: "Other" });
    await ensureTestConsent(phone);
    const r = await placeCall({ leadId: lead.id, campaignId: null, test: true, actorId: u.id });
    if (!r.placed) throw new UserError(r.failed ?? r.blockers.join(" "));
    return r;
  }, "Test call started. Your phone should ring within a few seconds. The result appears under Calls once it ends.", base);
}

export async function addSuppressionAction(_: FormState, fd: FormData): Promise<FormState> {
  return run((u) => addSuppressionByAdmin(u, s(fd, "phone"), s(fd, "reason")), "Added. This number will never be called.", base);
}
export async function removeSuppressionAction(_: FormState, fd: FormData): Promise<FormState> {
  return run((u) => removeSuppression(u, s(fd, "phone"), s(fd, "reason")), "Removed, and the audit trail has the reason.", base);
}
export async function recordConsentAction(_: FormState, fd: FormData): Promise<FormState> {
  const ids = s(fd, "leads").split(/[\s,;]+/).filter(Boolean);
  return run((u) => recordConsent(u, ids, s(fd, "basis"), s(fd, "note")), (n) => `Recorded for ${n} lead${n === 1 ? "" : "s"}.`, base);
}
