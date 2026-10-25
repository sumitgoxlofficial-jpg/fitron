import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { DISPOSITION_EFFECT, type Disposition } from "@/lib/domain/ai-calling/constants";
import { OPEN_STAGES, STAGES } from "@/lib/domain/crm";
import { activeAdmins, notify } from "../crm-access";
import { istInstant, todayIso } from "../time";
import { AI_ACTOR, callAudit } from "./core";

type Tx = Prisma.TransactionClient;
const rank = (s: string) => STAGES.indexOf(s as (typeof STAGES)[number]);
const clip = (s: string, n: number) => s.replace(/\s+/g, " ").trim().slice(0, n);

/** The person who should hear about this lead: its owner, else the Super Admins */
const people = async (tx: Tx, ownerId: string | null) => (ownerId ? [ownerId] : await activeAdmins(tx));

/**
 * Writes what a conversation came to into the CRM lead: a logged call, a stage that only ever moves forward, a follow-up task
 * and a notice where a person is needed. Only the backend calls this, with the disposition the agent reported.
 */
export async function applyOutcome(tx: Tx, lead: { id: string; gymName: string; stage: string; ownerId: string | null }, d: Disposition, summary: string, o: { callId: string; followUpDate?: string; test?: boolean }) {
  const fx = DISPOSITION_EFFECT[d];
  const now = new Date();
  await tx.crmActivity.create({ data: { leadId: lead.id, actorId: AI_ACTOR, type: "call", outcome: fx.outcome, notes: clip(`AI call · ${d.toLowerCase().replace(/_/g, " ")} · ${summary}`, 1000), at: now } });
  const data: Prisma.CrmLeadUncheckedUpdateManyInput = { lastContactAt: now, version: { increment: 1 } };
  let to: string | null = null;
  const open = (OPEN_STAGES as readonly string[]).includes(lead.stage);
  if (open && fx.stage && rank(fx.stage) > rank(lead.stage) && fx.stage !== "Disqualified") to = fx.stage;
  if (open && d === "INVALID_NUMBER") {
    to = "Disqualified";
    data.lossReason = "Not a gym / invalid lead";
  }
  if (open && !to && lead.stage === "New Lead" && fx.outcome === "Connected") to = "Contacted";
  if (to) data.stage = to;
  if (d === "DO_NOT_CONTACT") data.priority = "Low";
  await tx.crmLead.update({ where: { id: lead.id }, data });
  if (to) await tx.crmAudit.create({ data: { actorId: AI_ACTOR, leadId: lead.id, kind: "stage", text: `Stage: ${lead.stage} → ${to} (AI call)`, meta: { from: lead.stage, to, callId: o.callId } } });
  await callAudit(tx, AI_ACTOR, `Call result saved · ${d}`, { callId: o.callId, disposition: d }, lead.id);

  if (fx.followUp && !o.test) {
    const who = (await people(tx, lead.ownerId))[0];
    const exists = await tx.crmTask.findFirst({ where: { leadId: lead.id, done: false, type: { in: ["Follow-up", "Call"] } }, select: { id: true } });
    if (who && !exists) {
      const day = o.followUpDate && o.followUpDate > todayIso(now) ? o.followUpDate : todayIso(new Date(now.getTime() + 86_400_000));
      await tx.crmTask.create({ data: { leadId: lead.id, ownerId: who, type: d === "HUMAN_HANDOFF" ? "Call" : "Follow-up", dueAt: istInstant(day, "10:00"), priority: d === "HUMAN_HANDOFF" ? "High" : "Medium" } });
    }
  }
  if (d === "HUMAN_HANDOFF" || d === "DEMO_REQUESTED" || d === "INTERESTED") await notify(tx, await people(tx, lead.ownerId), `${lead.gymName}: the AI call ended "${d.toLowerCase().replace(/_/g, " ")}". Please follow up.`, lead.id);
}
