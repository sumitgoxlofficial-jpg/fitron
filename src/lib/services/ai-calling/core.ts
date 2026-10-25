import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { AcSettingsSchema, DEFAULT_AC_SETTINGS, liveReady, type AcSettings } from "@/lib/domain/ai-calling/settings";
import { crmAudit, need, type CrmUser } from "../crm-access";
import { UserError } from "../errors";

// AI Calling: settings, the emergency stop and audit. Super Admin work throughout (permission calling.manage); the
// agent's own actions are audited under the actor below.

/** The audit actor for things the AI agent did on a call */
export const AI_ACTOR = "ai-caller";

export const callAudit = (tx: Prisma.TransactionClient | typeof db, actorId: string, text: string, meta?: Prisma.InputJsonValue, leadId?: string | null) => crmAudit(tx, { actorId, leadId, kind: "calling", text, meta });

export async function getAcSettings(): Promise<AcSettings> {
  const row = await db.acSetting.findUnique({ where: { id: "default" } });
  const parsed = AcSettingsSchema.safeParse(row?.data ?? {});
  return parsed.success ? parsed.data : DEFAULT_AC_SETTINGS;
}

/** Saves settings after checking every value. Going live is refused unless all three telecom confirmations are ticked; ticking them records who did and when. */
export async function saveAcSettings(u: CrmUser, input: unknown) {
  need(u, "calling.manage");
  const before = await getAcSettings();
  const parsed = AcSettingsSchema.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues.map((i) => `${i.path.join(".") || "settings"}: ${i.message}`).slice(0, 3).join("; "));
  const next = parsed.data;
  next.emergencyStop = before.emergencyStop; // the stop has its own control and audit line
  const a = next.attest;
  const changed = a.telemarketerRegistered !== before.attest.telemarketerRegistered || a.routeAllowsAiPromotionalCalls !== before.attest.routeAllowsAiPromotionalCalls || a.dndScrubbed !== before.attest.dndScrubbed;
  if (changed) next.attest = { ...a, by: u.name, at: new Date().toISOString() };
  else next.attest = { ...a, by: before.attest.by, at: before.attest.at };
  if (next.mode === "live" && !liveReady(next)) throw new UserError("Live calling needs all three telecom confirmations ticked first.", "mode");
  await db.$transaction(async (tx) => {
    await tx.acSetting.upsert({ where: { id: "default" }, create: { id: "default", data: next }, update: { data: next } });
    await callAudit(tx, u.id, `AI calling settings changed${next.mode !== before.mode ? ` · mode ${before.mode} → ${next.mode}` : ""}${changed ? " · telecom confirmations updated" : ""}`);
  });
  return next;
}

/** The global emergency stop: no new call starts anywhere while it is on, queued calls are cancelled, and running campaigns pause. A call already connected finishes (the provider documents no way to cut one from here). */
export async function setEmergencyStop(u: CrmUser, on: boolean) {
  need(u, "calling.manage");
  await db.$transaction(async (tx) => {
    const cur = await getAcSettings();
    await tx.acSetting.upsert({ where: { id: "default" }, create: { id: "default", data: { ...cur, emergencyStop: on } }, update: { data: { ...cur, emergencyStop: on } } });
    if (on) {
      const q = await tx.acCall.updateMany({ where: { status: "QUEUED" }, data: { status: "CANCELLED", error: "Emergency stop" } });
      const c = await tx.acCampaign.updateMany({ where: { status: "RUNNING" }, data: { status: "PAUSED" } });
      await callAudit(tx, u.id, `EMERGENCY STOP on · ${c.count} running campaign${c.count === 1 ? "" : "s"} paused, ${q.count} queued call${q.count === 1 ? "" : "s"} cancelled`);
    } else await callAudit(tx, u.id, "Emergency stop released (campaigns stay paused until someone resumes them)");
  });
}
