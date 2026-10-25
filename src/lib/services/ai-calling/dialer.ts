import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { FINAL_STATUSES, LIVE_STATUSES, NEVER_AGAIN, RETRYABLE } from "@/lib/domain/ai-calling/constants";
import { callBlockers, type CallFacts } from "@/lib/domain/ai-calling/compliance";
import { callToken, hashToken } from "@/lib/domain/ai-calling/signature";
import { OPEN_STAGES } from "@/lib/domain/crm";
import { log } from "@/lib/log";
import { isUniqueViolation } from "../errors";
import { istInstant, todayIso } from "../time";
import { AI_ACTOR, callAudit, getAcSettings } from "./core";
import { callingSecret, elevenLabsProvider, ProviderError, type Provider } from "./provider";

// Placing calls. Every call, whoever or whatever asks for it, goes through placeCall: the compliance rules are re-run on fresh
// data immediately before dialling, the database refuses a second call with the same key, and the emergency stop is read again
// right before the provider is contacted.

export type PlaceResult = { placed: true; callId: string } | { placed: false; blockers: string[]; duplicate?: boolean; failed?: string };

const latest = (calls: { dialedAt: Date | null; createdAt: Date }[]) => calls.reduce<Date | null>((m, c) => { const t = c.dialedAt ?? c.createdAt; return !m || t > m ? t : m; }, null);
const e164 = (p: string) => `+91${p}`;

export async function suppressedNumbers(phones: string[]): Promise<Set<string>> {
  if (!phones.length) return new Set();
  const [a, b] = await Promise.all([
    db.acSuppression.findMany({ where: { phoneNorm: { in: phones } }, select: { phoneNorm: true } }),
    db.giSuppression.findMany({ where: { phoneNorm: { in: phones.map(e164) } }, select: { phoneNorm: true } }),
  ]);
  return new Set([...a.map((x) => x.phoneNorm), ...b.map((x) => x.phoneNorm.replace(/^\+91/, ""))]);
}

async function factsFor(leadId: string, campaignId: string | null, now: Date, test: boolean): Promise<{ facts: CallFacts; lead: { id: string; gymName: string; contactName: string; phone: string } } | null> {
  const [settings, lead, campaign] = await Promise.all([getAcSettings(), db.crmLead.findUnique({ where: { id: leadId } }), campaignId ? db.acCampaign.findUnique({ where: { id: campaignId } }) : null]);
  if (!lead) return null;
  const phone = /^[6-9]\d{9}$/.test(lead.phone) ? lead.phone : null;
  const dayStart = istInstant(todayIso(now), "00:00");
  const [sup, consent, prior, today] = await Promise.all([
    phone ? suppressedNumbers([phone]) : new Set<string>(),
    phone ? db.acConsent.findUnique({ where: { phoneNorm: phone } }) : null,
    test ? [] : db.acCall.findMany({ where: { leadId, status: { not: "CANCELLED" }, test: false }, select: { dialedAt: true, createdAt: true } }),
    db.acCall.count({ where: { dialedAt: { gte: dayStart }, status: { not: "CANCELLED" } } }),
  ]);
  const last = latest(prior);
  return {
    lead: { id: lead.id, gymName: lead.gymName, contactName: lead.contactName, phone: lead.phone },
    facts: {
      settings, phone, suppressed: phone ? sup.has(phone) : false, consentBasis: consent?.basis ?? null, leadOpen: (OPEN_STAGES as readonly string[]).includes(lead.stage),
      campaign: campaign ? { status: campaign.status, testMode: campaign.testMode, hoursFrom: campaign.hoursFrom, hoursTo: campaign.hoursTo } : test ? { status: "RUNNING", testMode: true, hoursFrom: 0, hoursTo: 1440 } : null,
      attemptsMade: prior.length, lastAttemptAt: last, callsToday: today, now,
    },
  };
}

/** The reasons a lead could not be called right now, without calling it */
export async function whyNot(leadId: string, campaignId: string | null, now = new Date()) {
  const f = await factsFor(leadId, campaignId, now, false);
  return f ? callBlockers(f.facts) : ["The lead no longer exists."];
}

export async function placeCall(o: { leadId: string; campaignId: string | null; test?: boolean; actorId: string; provider?: Provider; now?: Date }): Promise<PlaceResult> {
  const now = o.now ?? new Date();
  const test = !!o.test;
  const f = await factsFor(o.leadId, o.campaignId, now, test);
  if (!f) return { placed: false, blockers: ["The lead no longer exists."] };
  // A test call goes to an authorised number only, whatever else is true; it skips the retry and daily limits because it is not a sales attempt.
  const blockers = callBlockers(test ? { ...f.facts, settings: { ...f.facts.settings, mode: "test" } } : f.facts).filter((b) => !test || !/Already tried|Tried too recently|limit is reached/.test(b));
  if (blockers.length) return { placed: false, blockers };

  const id = randomUUID();
  const token = callToken(callingSecret() || "unset", id);
  const attempt = f.facts.attemptsMade + 1;
  const key = test ? `test:${o.leadId}:${Math.floor(now.getTime() / 60_000)}` : `c:${o.campaignId ?? "-"}:${o.leadId}:${attempt}`;
  try {
    await db.$transaction(async (tx) => {
      await tx.acCall.create({ data: { id, campaignId: o.campaignId, leadId: o.leadId, phone: f.lead.phone, idempotencyKey: key, status: "DIALING", attempt, tokenHash: hashToken(token), test, dialedAt: now } });
      await callAudit(tx, o.actorId, `${test ? "Test call" : "Call"} started · ${f.lead.gymName}`, { callId: id, campaignId: o.campaignId }, o.leadId);
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { placed: false, blockers: ["This call was already started (duplicate protection)."], duplicate: true };
    throw e;
  }

  // The stop may have been pressed since the checks above: read it again before touching the provider.
  if ((await getAcSettings()).emergencyStop) {
    await db.acCall.update({ where: { id }, data: { status: "CANCELLED", error: "Emergency stop" } });
    return { placed: false, blockers: ["The emergency stop is on."] };
  }
  try {
    const d = await (o.provider ?? elevenLabsProvider()).dial({ to10: f.lead.phone, callId: id, callToken: token, gymName: f.lead.gymName, contactName: f.lead.contactName });
    await db.acCall.update({ where: { id }, data: { conversationId: d.conversationId, sipCallId: d.sipCallId } });
    return { placed: true, callId: id };
  } catch (e) {
    const msg = e instanceof ProviderError ? e.message : "The provider call failed.";
    log.warn("calling.dial_failed", e, { callId: id });
    await db.acCall.update({ where: { id }, data: { status: "FAILED", endedAt: new Date(), error: msg.slice(0, 300) } });
    if (!(e instanceof ProviderError)) throw e;
    return { placed: false, blockers: [], failed: msg };
  }
}

// ── Campaign audience ──────────────────────────────────────────────────────

export type AudienceFilter = { states?: string[]; stages?: string[]; ownerId?: string | null; limit?: number };

function leadWhere(f: AudienceFilter, testNumbers: string[] | null): Prisma.CrmLeadWhereInput {
  const stages = (f.stages?.length ? f.stages.filter((s) => (OPEN_STAGES as readonly string[]).includes(s)) : [...OPEN_STAGES]) as string[];
  return {
    stage: { in: stages },
    ...(f.states?.length ? { state: { in: f.states } } : {}),
    ...(f.ownerId ? { ownerId: f.ownerId } : {}),
    ...(testNumbers ? { phone: { in: testNumbers } } : { phone: { gte: "6000000000", lte: "9999999999" } }),
  };
}

export type AudienceRow = { id: string; gymName: string; state: string | null; city: string | null; stage: string; callable: boolean; reasons: string[] };

/** Who a campaign would call right now, and who is held back and why. Uses the same rules as the dialer. */
export async function audience(f: AudienceFilter, testMode: boolean, hours: { from: number; to: number }, now = new Date()) {
  const settings = await getAcSettings();
  const testOnly = testMode || settings.mode === "test";
  const leads = await db.crmLead.findMany({ where: leadWhere(f, testOnly ? settings.testNumbers : null), orderBy: [{ priority: "desc" }, { createdAt: "asc" }], take: Math.min(f.limit ?? 2000, 5000), select: { id: true, gymName: true, state: true, city: true, stage: true, phone: true } });
  const phones = leads.map((l) => l.phone);
  const [sup, consents, calls] = await Promise.all([
    suppressedNumbers(phones),
    db.acConsent.findMany({ where: { phoneNorm: { in: phones } }, select: { phoneNorm: true, basis: true } }),
    db.acCall.findMany({ where: { leadId: { in: leads.map((l) => l.id) }, status: { not: "CANCELLED" }, test: false }, select: { leadId: true, dialedAt: true, createdAt: true, disposition: true, status: true } }),
  ]);
  const basis = new Map(consents.map((c) => [c.phoneNorm, c.basis]));
  const byLead = new Map<string, typeof calls>();
  for (const c of calls) byLead.set(c.leadId, [...(byLead.get(c.leadId) ?? []), c]);
  const rows: AudienceRow[] = leads.map((l) => {
    const prior = byLead.get(l.id) ?? [];
    const last = latest(prior);
    const reasons = callBlockers({
      settings, phone: l.phone, suppressed: sup.has(l.phone), consentBasis: basis.get(l.phone) ?? null, leadOpen: true, attemptsMade: prior.length, lastAttemptAt: last, callsToday: 0,
      campaign: { status: "RUNNING", testMode, hoursFrom: hours.from, hoursTo: hours.to }, now,
    }).filter((r) => !/Outside the permitted|Tried too recently|emergency/.test(r));
    // A lead whose last real conversation reached a final answer isn't called again
    const done = prior.some((c) => c.status === "COMPLETED" && c.disposition && !(RETRYABLE as readonly string[]).includes(c.disposition)) || prior.some((c) => c.disposition && (NEVER_AGAIN as readonly string[]).includes(c.disposition));
    if (done) reasons.push("Already had a conversation with a result.");
    return { id: l.id, gymName: l.gymName, state: l.state, city: l.city, stage: l.stage, callable: reasons.length === 0, reasons };
  });
  return rows;
}

// ── The worker ─────────────────────────────────────────────────────────────

/** Calls that never reported back (no webhook) are closed, so they stop holding a line */
export async function reapStaleCalls(now = new Date(), maxMinutes = 45) {
  const cutoff = new Date(now.getTime() - maxMinutes * 60_000);
  const r = await db.acCall.updateMany({ where: { status: { in: [...LIVE_STATUSES] }, createdAt: { lt: cutoff } }, data: { status: "FAILED", endedAt: now, error: "No result was reported by the provider" } });
  return r.count;
}

/** One pass over every running campaign: place as many calls as the free lines allow. Safe to run twice at once: the call key is unique. */
export async function runDialer(o: { provider?: Provider; now?: Date } = {}) {
  const now = o.now ?? new Date();
  await reapStaleCalls(); // real time: it is about how long a call has actually been silent
  const settings = await getAcSettings();
  if (settings.emergencyStop) return { placed: 0, campaigns: 0 };
  const running = await db.acCampaign.findMany({ where: { status: "RUNNING" } });
  let placed = 0;
  for (const c of running) {
    const [live, made] = await Promise.all([db.acCall.count({ where: { campaignId: c.id, status: { in: [...LIVE_STATUSES] } } }), db.acCall.count({ where: { campaignId: c.id, status: { not: "CANCELLED" } } })]);
    let free = Math.min(c.concurrency - live, c.maxCalls - made);
    const rows = await audience(c.filter as AudienceFilter, c.testMode, { from: c.hoursFrom, to: c.hoursTo }, now);
    const remaining = rows.filter((r) => r.callable);
    for (const r of remaining) {
      if (free <= 0) break;
      const res = await placeCall({ leadId: r.id, campaignId: c.id, actorId: AI_ACTOR, provider: o.provider, now });
      if (res.placed) {
        placed++;
        free--;
      }
    }
    // Finished: the cap is reached, or nobody is left to call, and no line is in use
    const liveNow = await db.acCall.count({ where: { campaignId: c.id, status: { in: [...LIVE_STATUSES] } } });
    if (liveNow === 0 && (made + placed >= c.maxCalls || remaining.length === 0)) {
      await db.$transaction(async (tx) => {
        const r = await tx.acCampaign.updateMany({ where: { id: c.id, status: "RUNNING" }, data: { status: "COMPLETED", endedAt: now } });
        if (r.count) await callAudit(tx, AI_ACTOR, `Campaign completed · ${c.name}`, { campaignId: c.id });
      });
    }
  }
  return { placed, campaigns: running.length };
}

export { FINAL_STATUSES };
