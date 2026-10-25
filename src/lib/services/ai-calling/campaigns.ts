import "server-only";
import "@/lib/zod-config";
import { z } from "zod";
import { db } from "@/lib/db";
import { fmtMinutes, parseHHMM } from "@/lib/domain/ai-calling/time";
import { LEGAL_FROM, LEGAL_TO } from "@/lib/domain/ai-calling/compliance";
import { currentOffer } from "@/lib/domain/ai-calling/offer";
import { liveReady } from "@/lib/domain/ai-calling/settings";
import { OPEN_STAGES } from "@/lib/domain/crm";
import { need, type CrmUser } from "../crm-access";
import { UserError } from "../errors";
import { callAudit, getAcSettings } from "./core";
import { audience, type AudienceFilter } from "./dialer";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const CampaignInput = z.object({
  name: z.string().trim().min(3, "Give the campaign a name.").max(80),
  states: z.array(z.string().trim().min(2).max(60)).max(40).default([]),
  stages: z.array(z.string()).default([]),
  maxCalls: z.number().int().min(1, "Set a call limit.").max(5000),
  concurrency: z.number().int().min(1).max(5).default(1),
  from: hhmm.default("10:00"),
  to: hhmm.default("18:00"),
  testMode: z.boolean().default(true),
});
export type CampaignInput = z.infer<typeof CampaignInput>;

const filterOf = (i: Pick<CampaignInput, "states" | "stages">): AudienceFilter => ({ states: i.states, stages: i.stages.filter((s) => (OPEN_STAGES as readonly string[]).includes(s)) });

export async function createCampaign(u: CrmUser, raw: unknown) {
  need(u, "calling.manage");
  const p = CampaignInput.safeParse(raw);
  if (!p.success) throw new UserError(p.error.issues[0]!.message);
  const i = p.data;
  const from = Math.max(parseHHMM(i.from), LEGAL_FROM);
  const to = Math.min(parseHHMM(i.to), LEGAL_TO);
  if (to - from < 60) throw new UserError(`Choose at least an hour between ${fmtMinutes(LEGAL_FROM)} and ${fmtMinutes(LEGAL_TO)} India time (promotional calls are not made outside those hours).`, "from");
  const settings = await getAcSettings();
  return db.$transaction(async (tx) => {
    const c = await tx.acCampaign.create({ data: { name: i.name, filter: filterOf(i), maxCalls: i.maxCalls, concurrency: i.concurrency, hoursFrom: from, hoursTo: to, testMode: i.testMode, offer: currentOffer(settings.offer), createdById: u.id } });
    await callAudit(tx, u.id, `Campaign created · ${c.name}${c.testMode ? " (test)" : ""}`, { campaignId: c.id });
    return c;
  });
}

export async function campaignPreview(u: CrmUser, id: string) {
  need(u, "calling.view");
  const c = await db.acCampaign.findUnique({ where: { id } });
  if (!c) throw new UserError("That campaign doesn't exist.");
  const rows = await audience(c.filter as AudienceFilter, c.testMode, { from: c.hoursFrom, to: c.hoursTo });
  const held = new Map<string, number>();
  for (const r of rows) for (const why of r.reasons) held.set(why, (held.get(why) ?? 0) + 1);
  return { campaign: c, total: rows.length, callable: rows.filter((r) => r.callable).length, held: [...held].sort((a, b) => b[1] - a[1]), sample: rows.slice(0, 12) };
}

type Step = "approve" | "start" | "pause" | "resume" | "stop";
const FROM: Record<Step, string[]> = { approve: ["DRAFT"], start: ["APPROVED"], pause: ["RUNNING"], resume: ["PAUSED"], stop: ["DRAFT", "APPROVED", "RUNNING", "PAUSED"] };
const TO: Record<Step, string> = { approve: "APPROVED", start: "RUNNING", pause: "PAUSED", resume: "RUNNING", stop: "STOPPED" };

/** Moves a campaign along. Approval needs the Super Admin to say they have reviewed the script, the offer and the audience; going live needs the telecom confirmations. */
export async function campaignStep(u: CrmUser, id: string, step: Step, o: { reviewed?: boolean } = {}) {
  need(u, "calling.manage");
  const settings = await getAcSettings();
  const c = await db.acCampaign.findUnique({ where: { id } });
  if (!c) throw new UserError("That campaign doesn't exist.");
  if (!FROM[step].includes(c.status)) throw new UserError(`A ${c.status.toLowerCase()} campaign can't be ${step === "stop" ? "stopped" : step === "approve" ? "approved" : step + "ed"}.`);
  if (step === "approve") {
    if (!o.reviewed) throw new UserError("Tick that you have reviewed the script, the offer and the audience.");
    if (!c.testMode && !(settings.mode === "live" && liveReady(settings))) throw new UserError("A live campaign needs live mode and the three telecom confirmations (Settings). Make it a test campaign, or finish those first.");
  }
  if ((step === "start" || step === "resume") && settings.emergencyStop) throw new UserError("The emergency stop is on. Release it first.");
  if ((step === "start" || step === "resume") && !c.testMode && !(settings.mode === "live" && liveReady(settings))) throw new UserError("Live calling is not switched on.");
  await db.$transaction(async (tx) => {
    const r = await tx.acCampaign.updateMany({
      where: { id, status: { in: FROM[step] } },
      data: { status: TO[step], ...(step === "approve" ? { approvedById: u.id, approvedAt: new Date(), offer: currentOffer(settings.offer) } : {}), ...(step === "start" ? { startedAt: new Date() } : {}), ...(step === "stop" ? { endedAt: new Date() } : {}) },
    });
    if (r.count !== 1) throw new UserError("Someone else just changed this campaign.");
    if (step === "stop") await tx.acCall.updateMany({ where: { campaignId: id, status: "QUEUED" }, data: { status: "CANCELLED", error: "Campaign stopped" } });
    await callAudit(tx, u.id, `Campaign ${TO[step].toLowerCase()} · ${c.name}`, { campaignId: id, step });
  });
}

export async function listCampaigns(u: CrmUser) {
  need(u, "calling.view");
  const rows = await db.acCampaign.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  const counts = await db.acCall.groupBy({ by: ["campaignId", "status"], where: { campaignId: { in: rows.map((r) => r.id) } }, _count: true });
  return rows.map((c) => {
    const mine = counts.filter((x) => x.campaignId === c.id);
    const n = (...s: string[]) => mine.filter((x) => s.includes(x.status)).reduce((t, x) => t + x._count, 0);
    return { ...c, made: n("DIALING", "IN_PROGRESS", "COMPLETED", "NO_ANSWER", "BUSY", "FAILED"), done: n("COMPLETED"), failed: n("FAILED"), live: n("DIALING", "IN_PROGRESS") };
  });
}
