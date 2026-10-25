import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { ProviderEvent } from "@/lib/domain/ai-calling/events";
import { FINAL_STATUSES, type Disposition } from "@/lib/domain/ai-calling/constants";
import { scrub } from "../crm-access";
import { getAcSettings } from "./core";
import { applyOutcome } from "./outcome";

/** A call that connected but where the owner never spoke, or lasted only moments, was not answered by a person */
const NOT_ANSWERED_SECS = 8;

/**
 * Applies what the provider reported after a call. Safe to receive twice: a call that already has a final status is left as it is.
 * Returns false when no call of ours matches (an event for something else).
 */
export async function handleProviderEvent(ev: ProviderEvent, now = new Date()): Promise<boolean> {
  if (ev.kind === "ignored") return true;
  const call = await db.acCall.findFirst({ where: { OR: [...(ev.conversationId ? [{ conversationId: ev.conversationId }] : []), ...(ev.callId ? [{ id: ev.callId }] : [])] } });
  if (!call) return false;
  if ((FINAL_STATUSES as readonly string[]).includes(call.status) && call.status !== "FAILED") return true;
  const lead = await db.crmLead.findUnique({ where: { id: call.leadId } });
  const settings = await getAcSettings();

  if (ev.kind === "failed") {
    const d: Disposition | null = ev.status === "BUSY" ? "BUSY" : ev.status === "NO_ANSWER" ? "NO_ANSWER" : null;
    await db.$transaction(async (tx) => {
      await tx.acCall.update({ where: { id: call.id }, data: { status: ev.status, endedAt: now, error: ev.status === "FAILED" ? `Provider: ${ev.reason}` : null, ...(d ? { disposition: d } : {}), ...(ev.conversationId && !call.conversationId ? { conversationId: ev.conversationId } : {}) } });
      if (d && lead && !call.test) await applyOutcome(tx, lead, d, ev.status === "BUSY" ? "The line was busy." : "Nobody answered.", { callId: call.id, test: call.test });
    });
    return true;
  }

  const answered = ev.heardOwner && (ev.durationSec ?? NOT_ANSWERED_SECS + 1) > NOT_ANSWERED_SECS;
  await db.$transaction(async (tx) => {
    const fresh = await tx.acCall.findUniqueOrThrow({ where: { id: call.id } });
    let disposition = fresh.disposition as Disposition | null;
    const summary = fresh.summary ?? (ev.summary ? scrub(ev.summary).slice(0, 600) : null);
    if (!answered && !disposition) {
      disposition = "NO_ANSWER";
      if (lead && !call.test) await applyOutcome(tx, lead, "NO_ANSWER", "Nobody spoke on the call.", { callId: call.id, test: call.test });
    } else if (!disposition && lead) {
      // They spoke but the agent never saved a result: say so, and give a person the follow-up rather than guess what was decided.
      disposition = "FOLLOW_UP";
      await applyOutcome(tx, lead, "FOLLOW_UP", "The conversation ended without a saved result. Please read the transcript.", { callId: call.id, test: call.test });
    }
    await tx.acCall.update({
      where: { id: call.id },
      data: {
        status: answered ? "COMPLETED" : "NO_ANSWER", endedAt: now, durationSec: ev.durationSec, disposition, summary, error: null,
        ...(ev.conversationId && !call.conversationId ? { conversationId: ev.conversationId } : {}),
        ...(settings.storeTranscripts ? { transcript: ev.turns.map((t) => ({ role: t.role, text: scrub(t.text).slice(0, 1500), at: t.at })), transcriptExpiresAt: new Date(now.getTime() + settings.retentionDays * 86_400_000) } : {}),
      },
    });
  });
  return true;
}

/** Deletes transcripts past their retention date. Run by the daily job. */
export async function purgeTranscripts(now = new Date()) {
  const r = await db.acCall.updateMany({ where: { transcriptExpiresAt: { lt: now } }, data: { transcript: Prisma.DbNull, transcriptExpiresAt: null } });
  return r.count;
}

