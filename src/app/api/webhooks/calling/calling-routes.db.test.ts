import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { callToken, hashToken, signElevenBody } from "@/lib/domain/ai-calling/signature";
import { hasDb } from "@/test/db";
import { POST as tools } from "./tools/[tool]/route";
import { POST as events } from "./events/route";
import { GET as jobGet } from "../../jobs/calls/route";

// The HTTP layer of the AI caller: what is refused before any logic runs, and one real request each way.

const TOOL = "route-test-tool-secret-0123456789";
const HOOK = "route-test-webhook-secret";
const saved = { t: process.env.CALLING_TOOL_SECRET, h: process.env.ELEVENLABS_WEBHOOK_SECRET, c: process.env.CRON_SECRET };

const toolReq = (body: unknown, secret?: string) => new Request("http://x/api/webhooks/calling/tools/t", { method: "POST", headers: { "content-type": "application/json", ...(secret ? { "x-fitron-tool-secret": secret } : {}) }, body: typeof body === "string" ? body : JSON.stringify(body) });
const ctx = (tool: string) => ({ params: Promise.resolve({ tool }) });
const evReq = (body: string, sig?: string) => new Request("http://x/api/webhooks/calling/events", { method: "POST", headers: sig ? { "elevenlabs-signature": sig } : {}, body });

describe.skipIf(!hasDb)("AI calling HTTP routes", () => {
  let callId: string;
  let conv: string;
  beforeAll(async () => {
    process.env.CALLING_TOOL_SECRET = TOOL;
    process.env.ELEVENLABS_WEBHOOK_SECRET = HOOK;
    process.env.CRON_SECRET = "cron-route-test-secret";
    const phone = `9${randomInt(100_000_000, 999_999_999)}`;
    const lead = await db.crmLead.create({ data: { id: `FL-r${randomUUID().slice(0, 6)}`, contactName: "Asha", gymName: "Route Gym", phone, source: "Other", product: "SaaS", createdById: "route-test" } });
    callId = randomUUID();
    conv = `conv_${randomUUID().slice(0, 8)}`;
    await db.acCall.create({ data: { id: callId, leadId: lead.id, phone, idempotencyKey: `r:${callId}`, status: "DIALING", tokenHash: hashToken(callToken(TOOL, callId)), conversationId: conv, test: true } });
  });
  afterAll(() => {
    for (const [k, v] of [["CALLING_TOOL_SECRET", saved.t], ["ELEVENLABS_WEBHOOK_SECRET", saved.h], ["CRON_SECRET", saved.c]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  it("tools: refuses a missing or wrong header before reading anything", async () => {
    expect((await tools(toolReq({}), ctx("get_gym_details"))).status).toBe(401);
    expect((await tools(toolReq({}, "wrong-wrong-wrong-wrong-wrong-"), ctx("get_gym_details"))).status).toBe(401);
  });
  it("tools: bad JSON, unknown tool and a wrong call key are refused", async () => {
    expect((await tools(toolReq("{nope", TOOL), ctx("get_gym_details"))).status).toBe(400);
    expect((await tools(toolReq({}, TOOL), ctx("delete_everything"))).status).toBe(404);
    expect((await tools(toolReq({ call_id: callId, call_token: "f".repeat(64) }, TOOL), ctx("get_gym_details"))).status).toBe(401);
  });
  it("tools: a real request answers with the gym, and nothing sensitive", async () => {
    const r = await tools(toolReq({ call_id: callId, call_token: callToken(TOOL, callId) }, TOOL), ctx("get_gym_details"));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({ gym_name: "Route Gym", contact_name: "Asha" });
    expect(JSON.stringify(j)).not.toMatch(/\d{10}/);
  });
  it("events: a forged, unsigned, stale or tampered report is refused", async () => {
    const body = JSON.stringify({ type: "post_call_transcription", data: { conversation_id: conv, transcript: [], metadata: { call_duration_secs: 3 } } });
    expect((await events(evReq(body))).status).toBe(401);
    expect((await events(evReq(body, signElevenBody(body, "not-the-secret")))).status).toBe(401);
    expect((await events(evReq(body, signElevenBody(body, HOOK, Date.now() - 3 * 3_600_000)))).status).toBe(401);
    expect((await events(evReq(body + " ", signElevenBody(body, HOOK)))).status).toBe(401);
    expect((await db.acCall.findUniqueOrThrow({ where: { id: callId } })).status).toBe("IN_PROGRESS"); // untouched: the tool call above started it, the forged reports did nothing
  });
  it("events: a malformed but correctly signed report is a 400; other event kinds and other people's calls are accepted quietly", async () => {
    const bad = JSON.stringify({ type: "post_call_transcription", data: {} });
    expect((await events(evReq(bad, signElevenBody(bad, HOOK)))).status).toBe(400);
    const audio = JSON.stringify({ type: "post_call_audio", data: {} });
    expect((await events(evReq(audio, signElevenBody(audio, HOOK)))).status).toBe(200);
    const other = JSON.stringify({ type: "post_call_transcription", data: { conversation_id: "conv_not_ours", transcript: [] } });
    expect(await (await events(evReq(other, signElevenBody(other, HOOK)))).json()).toMatchObject({ ok: true, matched: false });
  });
  it("events: a signed report closes the call", async () => {
    const body = JSON.stringify({ type: "post_call_transcription", data: { conversation_id: conv, transcript: [{ role: "agent", message: "Hello", time_in_call_secs: 0 }, { role: "user", message: "Yes, tell me more", time_in_call_secs: 5 }], metadata: { call_duration_secs: 45 }, analysis: { transcript_summary: "Asked for details" } } });
    expect((await events(evReq(body, signElevenBody(body, HOOK)))).status).toBe(200);
    expect(await db.acCall.findUniqueOrThrow({ where: { id: callId } })).toMatchObject({ status: "COMPLETED", durationSec: 45 });
  });
  it("job: needs the cron secret", async () => {
    expect((await jobGet(new Request("http://x/api/jobs/calls"))).status).toBe(401);
    const ok = await jobGet(new Request("http://x/api/jobs/calls", { headers: { authorization: "Bearer cron-route-test-secret" } }));
    expect(ok.status).toBe(200);
  });
});
