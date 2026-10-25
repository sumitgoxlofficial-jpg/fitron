import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { parseProviderEvent } from "@/lib/domain/ai-calling/events";
import { AcSettingsSchema } from "@/lib/domain/ai-calling/settings";
import { callToken } from "@/lib/domain/ai-calling/signature";
import { hasDb } from "@/test/db";
import { CrmDenied, loadCrmUser, nextEmpId, teamOrg, teamRoleId, type CrmUser } from "../crm-access";
import { createLead } from "../crm-leads";
import { campaignPreview, campaignStep, createCampaign } from "./campaigns";
import { getAcSettings, saveAcSettings, setEmergencyStop } from "./core";
import { placeCall, runDialer, whyNot } from "./dialer";
import { addSuppressionByAdmin, recordConsent, removeSuppression } from "./people";
import type { Provider } from "./provider";
import { callingOverview } from "./reports";
import { executeTool } from "./tools";
import { handleProviderEvent, purgeTranscripts } from "./webhook";

// These use a fake provider: they prove FITRON's own logic (what is allowed, what is saved, what is refused). They do not show
// that Voice Link or ElevenLabs places a call; that is the live test in docs/AI_CALLING.md.

const SECRET = "test-secret-test-secret-test-secret";
const mobile = () => `9${randomInt(100_000_000, 999_999_999)}`;
const staff = async (role: "admin" | "sales"): Promise<CrmUser> => {
  const [orgId, roleId] = await Promise.all([teamOrg(), teamRoleId()]);
  const user = await db.user.create({ data: { orgId, roleId, name: `${role} ${randomUUID().slice(0, 4)}`, email: `${randomUUID()}@test.local`, phone: "", passwordHash: "x", emailVerifiedAt: new Date() } });
  await db.crmStaff.create({ data: { userId: user.id, empId: await nextEmpId(), role } });
  return (await loadCrmUser(user.id))!;
};
/** 11:00 on a weekday in India: inside every calling window */
const noon = new Date(Date.UTC(2026, 9, 26, 5, 30));
/** A future weekday slot the demo rules accept (Tuesday 3 pm India) */
const slot = "2026-10-27T15:00:00+05:30";

type Dial = Parameters<Provider["dial"]>[0];
const fake = () => {
  const dialed: Dial[] = [];
  return { dialed, provider: { dial: async (r: Dial) => { dialed.push(r); return { conversationId: `conv_${randomUUID().slice(0, 8)}`, sipCallId: "sip_1" }; } } satisfies Provider };
};

describe.skipIf(!hasDb)("AI calling", () => {
  let admin: CrmUser;
  let sales: CrmUser;
  const savedSecret = process.env.CALLING_TOOL_SECRET;

  const liveSettings = (o: Record<string, unknown> = {}) => saveAcSettings(admin, { ...AcSettingsSchema.parse({}), mode: "live", attest: { telemarketerRegistered: true, routeAllowsAiPromotionalCalls: true, dndScrubbed: true }, offer: { active: true, freeMonths: 1, percentOff: 50, plan: "professional", slotsTotal: 100, slotsClaimed: 0, terms: "" }, ...o });
  const lead = async (o: { owner?: CrmUser; consent?: boolean } = {}) => {
    const l = await createLead(o.owner ?? sales, { contactName: "Ravi", gymName: `Iron House ${randomUUID().slice(0, 4)}`, phone: mobile(), city: "Ranchi", state: "Jharkhand", plan: "professional" });
    if (o.consent !== false) await recordConsent(admin, [l.id], "ENQUIRY", "Enquiry form on fitron.in, October");
    return l;
  };
  const tokenFor = (id: string) => callToken(SECRET, id);
  const tool = (name: string, callId: string, body: Record<string, unknown> = {}, token = tokenFor(callId)) => executeTool(name, { call_id: callId, call_token: token, ...body }, noon);

  beforeAll(async () => {
    process.env.CALLING_TOOL_SECRET = SECRET;
    admin = await staff("admin");
    sales = await staff("sales");
  });
  afterAll(() => { if (savedSecret === undefined) delete process.env.CALLING_TOOL_SECRET; else process.env.CALLING_TOOL_SECRET = savedSecret; });
  beforeEach(async () => {
    await db.acSetting.deleteMany();
    await db.acCampaign.updateMany({ where: { status: { in: ["RUNNING", "PAUSED", "APPROVED"] } }, data: { status: "STOPPED" } });
    await db.acCall.updateMany({ where: { status: { in: ["DIALING", "IN_PROGRESS", "QUEUED"] } }, data: { status: "CANCELLED" } });
  });

  it("only the Super Admin can use it", async () => {
    await expect(saveAcSettings(sales, {})).rejects.toBeInstanceOf(CrmDenied);
    await expect(setEmergencyStop(sales, true)).rejects.toBeInstanceOf(CrmDenied);
    await expect(callingOverview(sales)).rejects.toBeInstanceOf(CrmDenied);
    await expect(recordConsent(sales, ["x"], "ENQUIRY", "something long enough")).rejects.toBeInstanceOf(CrmDenied);
  });

  it("refuses to go live without the telecom confirmations, and records who confirmed", async () => {
    await expect(saveAcSettings(admin, { mode: "live" })).rejects.toThrow(/three telecom confirmations/);
    const s = await liveSettings();
    expect(s.attest.by).toBe(admin.name);
    expect((await getAcSettings()).mode).toBe("live");
  });

  it("a call goes out only with a consent record: a public listing is not enough", async () => {
    await liveSettings();
    const l = await lead({ consent: false });
    const f = fake();
    const c = await createCampaign(admin, { name: "Ranchi live", states: ["Jharkhand"], maxCalls: 5, testMode: false });
    await campaignStep(admin, c.id, "approve", { reviewed: true });
    await campaignStep(admin, c.id, "start");
    const r = await placeCall({ leadId: l.id, campaignId: c.id, actorId: admin.id, provider: f.provider, now: noon });
    expect(r).toMatchObject({ placed: false });
    expect((r as { blockers: string[] }).blockers.join()).toMatch(/why this number may be called/);
    expect(f.dialed).toHaveLength(0);
    await recordConsent(admin, [l.id], "ENQUIRY", "Enquiry form on fitron.in, October");
    const ok = await placeCall({ leadId: l.id, campaignId: c.id, actorId: admin.id, provider: f.provider, now: noon });
    expect(ok.placed).toBe(true);
    expect(f.dialed).toHaveLength(1);
    expect(f.dialed[0]!.to10).toBe((await db.crmLead.findUniqueOrThrow({ where: { id: l.id } })).phone);
  });

  it("a duplicate request for the same call is refused by the database", async () => {
    await liveSettings();
    const l = await lead();
    const f = fake();
    const c = await createCampaign(admin, { name: "Dup", maxCalls: 5, testMode: false });
    await campaignStep(admin, c.id, "approve", { reviewed: true });
    await campaignStep(admin, c.id, "start");
    // Two workers decide at once: only one call is created
    const both = await Promise.all([1, 2].map(() => placeCall({ leadId: l.id, campaignId: c.id, actorId: admin.id, provider: f.provider, now: noon })));
    expect(both.filter((r) => r.placed)).toHaveLength(1);
    expect(f.dialed).toHaveLength(1);
    expect(await db.acCall.count({ where: { leadId: l.id } })).toBe(1);
  });

  it("the emergency stop blocks new calls, pauses campaigns and cancels queued calls; releasing it does not restart anything", async () => {
    await liveSettings();
    const l = await lead();
    const f = fake();
    const c = await createCampaign(admin, { name: "Stoppable", maxCalls: 5, testMode: false });
    await campaignStep(admin, c.id, "approve", { reviewed: true });
    await campaignStep(admin, c.id, "start");
    await setEmergencyStop(admin, true);
    expect((await db.acCampaign.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("PAUSED");
    expect(await whyNot(l.id, c.id, noon)).toContain("The emergency stop is on.");
    expect(await runDialer({ provider: f.provider, now: noon })).toMatchObject({ placed: 0 });
    await expect(campaignStep(admin, c.id, "resume")).rejects.toThrow(/emergency stop/);
    await setEmergencyStop(admin, false);
    expect((await db.acCampaign.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("PAUSED");
    expect(f.dialed).toHaveLength(0);
  });

  it("test mode dials only the authorised numbers, and a test call works from the readiness page path", async () => {
    const mine = mobile();
    await saveAcSettings(admin, { ...AcSettingsSchema.parse({}), testNumbers: [mine] });
    const stranger = await lead();
    const f = fake();
    const no = await placeCall({ leadId: stranger.id, campaignId: null, test: true, actorId: admin.id, provider: f.provider, now: noon });
    expect((no as { blockers: string[] }).blockers.join()).toMatch(/authorised test numbers/);
    const t = await createLead(admin, { contactName: "Test", gymName: "Test line", phone: mine, plan: "professional" });
    const ok = await placeCall({ leadId: t.id, campaignId: null, test: true, actorId: admin.id, provider: f.provider, now: noon });
    expect(ok.placed).toBe(true);
    const call = await db.acCall.findFirstOrThrow({ where: { leadId: t.id } });
    expect(call.test).toBe(true);
  });

  it("provider failures are recorded, not swallowed, and never leak the key", async () => {
    await liveSettings();
    const l = await lead();
    const c = await createCampaign(admin, { name: "Fails", maxCalls: 5, testMode: false });
    await campaignStep(admin, c.id, "approve", { reviewed: true });
    await campaignStep(admin, c.id, "start");
    const { ProviderError } = await import("./provider");
    const bad: Provider = { dial: async () => { throw new ProviderError("The calling provider refused the call: invalid number"); } };
    const r = await placeCall({ leadId: l.id, campaignId: c.id, actorId: admin.id, provider: bad, now: noon });
    expect(r).toMatchObject({ placed: false, failed: expect.stringContaining("refused") });
    expect((await db.acCall.findFirstOrThrow({ where: { leadId: l.id } })).status).toBe("FAILED");
  });

  describe("on a call", () => {
    let callId: string;
    let leadId: string;
    beforeEach(async () => {
      await db.acDemo.deleteMany({ where: { slotAt: new Date(slot) } }); // earlier runs may have filled the slot
      await liveSettings();
      const l = await lead({ owner: sales });
      leadId = l.id;
      const c = await createCampaign(admin, { name: `Call ${randomUUID().slice(0, 4)}`, maxCalls: 5, testMode: false });
      await campaignStep(admin, c.id, "approve", { reviewed: true });
      await campaignStep(admin, c.id, "start");
      const f = fake();
      const r = await placeCall({ leadId, campaignId: c.id, actorId: admin.id, provider: f.provider, now: noon });
      if (!r.placed) throw new Error(r.blockers.join());
      callId = r.callId;
    });

    it("rejects a wrong key, a key for another call, a bad tool name and bad input — and says the same thing for each", async () => {
      expect((await tool("get_gym_details", callId, {}, "x".repeat(64))).status).toBe(401);
      expect((await tool("get_gym_details", "no-such-call", {})).status).toBe(401);
      expect((await tool("drop_tables", callId)).status).toBe(404);
      expect((await tool("save_call_disposition", callId, { disposition: "SOLD", summary: "x" })).status).toBe(400);
      const other = await lead();
      const f = fake();
      const c2 = await db.acCampaign.findFirstOrThrow({ where: { status: "RUNNING" } });
      const r2 = await placeCall({ leadId: other.id, campaignId: c2.id, actorId: admin.id, provider: f.provider, now: noon });
      expect(r2.placed).toBe(true);
      // The first call's key cannot act on the second call
      expect((await executeTool("get_gym_details", { call_id: (r2 as { callId: string }).callId, call_token: tokenFor(callId) }, noon)).status).toBe(401);
    });

    it("tells the agent the gym, the facts and the offer from the backend", async () => {
      const g = await tool("get_gym_details", callId);
      expect(g.body).toMatchObject({ contact_name: "Ravi", city: "Ranchi" });
      expect(JSON.stringify(g.body)).not.toMatch(/\d{10}/);
      expect((await tool("get_fitron_product_information", callId, { topic: "plans" })).body.facts).toEqual(expect.arrayContaining([expect.stringContaining("₹1,999")]));
      const o = await tool("get_current_offer", callId);
      expect(o.body).toMatchObject({ offer_active: true });
      expect(JSON.stringify(o.body)).toContain("₹999.50");
      expect((await db.acCall.findUniqueOrThrow({ where: { id: callId } })).status).toBe("IN_PROGRESS");
    });

    it("books a demo only when the backend succeeds, and writes the CRM", async () => {
      const r = await tool("schedule_demo", callId, { slot_start: slot, attendee_name: "Ravi" });
      expect(r.body.booked).toBe(true);
      const demo = await db.acDemo.findFirstOrThrow({ where: { leadId } });
      expect(demo.slotAt.toISOString()).toBe(new Date(slot).toISOString());
      const l = await db.crmLead.findUniqueOrThrow({ where: { id: leadId } });
      expect(l.stage).toBe("Demo Scheduled");
      const task = await db.crmTask.findFirstOrThrow({ where: { leadId, type: "Demo" } });
      expect(task.ownerId).toBe(sales.id);
      expect((await db.acCall.findUniqueOrThrow({ where: { id: callId } })).disposition).toBe("DEMO_BOOKED");
      expect(await db.crmActivity.count({ where: { leadId, actorId: "ai-caller" } })).toBe(1);
      expect(await db.crmNotification.count({ where: { userId: sales.id, leadId } })).toBeGreaterThan(0);
      // Asking again for the same time is the same booking, not a second one
      expect((await tool("schedule_demo", callId, { slot_start: slot })).body).toMatchObject({ booked: true, already: true });
      expect(await db.acDemo.count({ where: { leadId } })).toBe(1);
    });

    it("does not book an impossible time, and offers real alternatives", async () => {
      const sunday = await tool("schedule_demo", callId, { slot_start: "2026-11-01T11:00:00+05:30" });
      expect(sunday.body.booked).toBe(false);
      expect(sunday.body.available).toHaveLength(3);
      expect(await db.acDemo.count({ where: { leadId } })).toBe(0);
      expect((await db.crmLead.findUniqueOrThrow({ where: { id: leadId } })).stage).not.toBe("Demo Scheduled");
    });

    it("stops a third demo in one slot", async () => {
      const slotAt = new Date(slot);
      await db.acDemo.createMany({ data: [{ leadId: "FL-x1", slotAt }, { leadId: "FL-x2", slotAt }] });
      const r = await tool("schedule_demo", callId, { slot_start: slot });
      expect(r.body.booked).toBe(false);
      await db.acDemo.deleteMany({ where: { leadId: { in: ["FL-x1", "FL-x2"] } } });
    });

    it("saves a disposition into the CRM and never moves a stage backwards", async () => {
      const r = await tool("save_call_disposition", callId, { disposition: "INTERESTED", summary: "Uses a notebook; wants to see reports", follow_up_date: "2026-11-02" });
      expect(r.body).toEqual({ saved: true });
      const l = await db.crmLead.findUniqueOrThrow({ where: { id: leadId } });
      expect(l.stage).toBe("Interested");
      expect(await db.crmTask.count({ where: { leadId, type: "Follow-up", ownerId: sales.id } })).toBe(1);
      await tool("save_call_disposition", callId, { disposition: "FOLLOW_UP", summary: "Call back later" });
      expect((await db.crmLead.findUniqueOrThrow({ where: { id: leadId } })).stage).toBe("Interested");
    });

    it("a human handoff makes a call task and tells the owner", async () => {
      expect((await tool("request_human_followup", callId, { reason: "Asked about multi-branch pricing", preferred_time: "tomorrow evening" })).body).toEqual({ requested: true });
      expect(await db.crmTask.count({ where: { leadId, type: "Call", ownerId: sales.id } })).toBe(1);
      expect((await db.acCall.findUniqueOrThrow({ where: { id: callId } })).disposition).toBe("HUMAN_HANDOFF");
    });

    it("an opt-out is enforced at once, everywhere, and cannot be undone by a later answer", async () => {
      expect((await tool("record_opt_out", callId, { reason: "Do not call again" })).body).toEqual({ recorded: true });
      const phone = (await db.crmLead.findUniqueOrThrow({ where: { id: leadId } })).phone;
      expect(await db.acSuppression.findUnique({ where: { phoneNorm: phone } })).not.toBeNull();
      expect(await db.giSuppression.findUnique({ where: { phoneNorm: `+91${phone}` } })).not.toBeNull();
      await tool("save_call_disposition", callId, { disposition: "INTERESTED", summary: "changed mind?" });
      expect((await db.acCall.findUniqueOrThrow({ where: { id: callId } })).disposition).toBe("DO_NOT_CONTACT");
      expect(await whyNot(leadId, null, noon)).toContain("This number is on the do-not-call list.");
      await expect(removeSuppression(admin, phone, "short")).rejects.toThrow(/at least 10/);
    });

    it("tools stop working once the call has ended", async () => {
      await db.acCall.update({ where: { id: callId }, data: { status: "COMPLETED" } });
      expect((await tool("get_gym_details", callId)).status).toBe(409);
    });

    it("the provider's report closes the call, stores the transcript and is safe to receive twice", async () => {
      await tool("save_call_disposition", callId, { disposition: "INTERESTED", summary: "Wants a demo" });
      const conv = (await db.acCall.findUniqueOrThrow({ where: { id: callId } })).conversationId!;
      const ev = parseProviderEvent({ type: "post_call_transcription", data: { conversation_id: conv, transcript: [{ role: "agent", message: "Hello", time_in_call_secs: 0 }, { role: "user", message: "Call me on 9876543210 or a@b.com", time_in_call_secs: 6 }], metadata: { call_duration_secs: 64 }, analysis: { transcript_summary: "provider summary" } } });
      expect(await handleProviderEvent(ev, noon)).toBe(true);
      expect(await handleProviderEvent(ev, noon)).toBe(true);
      const c = await db.acCall.findUniqueOrThrow({ where: { id: callId } });
      expect(c).toMatchObject({ status: "COMPLETED", durationSec: 64, disposition: "INTERESTED", summary: "Wants a demo" });
      const text = JSON.stringify(c.transcript);
      expect(text).not.toMatch(/9876543210|a@b\.com/);
      expect(c.transcriptExpiresAt!.getTime()).toBeGreaterThan(noon.getTime() + 80 * 86_400_000);
      expect(await db.crmActivity.count({ where: { leadId, actorId: "ai-caller" } })).toBe(1);
    });

    it("a conversation that ended with no saved result becomes a human follow-up, not a guess", async () => {
      const conv = (await db.acCall.findUniqueOrThrow({ where: { id: callId } })).conversationId!;
      await handleProviderEvent(parseProviderEvent({ type: "post_call_transcription", data: { conversation_id: conv, transcript: [{ role: "user", message: "hello?", time_in_call_secs: 4 }], metadata: { call_duration_secs: 30 } } }), noon);
      const c = await db.acCall.findUniqueOrThrow({ where: { id: callId } });
      expect(c.disposition).toBe("FOLLOW_UP");
      expect(await db.crmTask.count({ where: { leadId } })).toBe(1);
    });

    it("an unanswered call is No answer, and is tried again later but not past the limit", async () => {
      const conv = (await db.acCall.findUniqueOrThrow({ where: { id: callId } })).conversationId!;
      await handleProviderEvent(parseProviderEvent({ type: "post_call_transcription", data: { conversation_id: conv, transcript: [{ role: "agent", message: "Hello", time_in_call_secs: 0 }], metadata: { call_duration_secs: 5 } } }), noon);
      const c = await db.acCall.findUniqueOrThrow({ where: { id: callId } });
      expect(c).toMatchObject({ status: "NO_ANSWER", disposition: "NO_ANSWER" });
      expect(await whyNot(leadId, c.campaignId, noon)).toContain("Tried too recently.");
      const later = new Date(noon.getTime() + 5 * 3_600_000 - 60 * 60_000 * 0);
      // 16:00 India time, past the retry gap
      expect(await whyNot(leadId, c.campaignId, later)).toEqual([]);
      await db.acCall.create({ data: { leadId, phone: c.phone, idempotencyKey: `x:${randomUUID()}`, status: "NO_ANSWER", tokenHash: "x", dialedAt: new Date(noon.getTime() - 86_400_000), campaignId: c.campaignId, attempt: 2 } });
      expect((await whyNot(leadId, c.campaignId, later)).join()).toMatch(/Already tried/);
    });

    it("busy and failed-to-connect reports are recorded", async () => {
      const conv = (await db.acCall.findUniqueOrThrow({ where: { id: callId } })).conversationId!;
      await handleProviderEvent(parseProviderEvent({ type: "call_initiation_failure", data: { conversation_id: conv, failure_reason: "busy" } }), noon);
      expect(await db.acCall.findUniqueOrThrow({ where: { id: callId } })).toMatchObject({ status: "BUSY", disposition: "BUSY" });
    });
  });

  it("a campaign needs a reviewed approval, respects concurrency and the call limit, and completes", async () => {
    await liveSettings({ dailyCallCap: 100 });
    const leads = await Promise.all([lead(), lead(), lead()]);
    const mark = `Cap ${randomUUID().slice(0, 4)}`;
    const c = await createCampaign(admin, { name: mark, stages: ["New Lead"], states: ["Jharkhand"], maxCalls: 2, concurrency: 1, testMode: false });
    await expect(campaignStep(admin, c.id, "start")).rejects.toThrow(/can't be/);
    await expect(campaignStep(admin, c.id, "approve", {})).rejects.toThrow(/reviewed/);
    const pv = await campaignPreview(admin, c.id);
    expect(pv.callable).toBeGreaterThanOrEqual(3);
    await campaignStep(admin, c.id, "approve", { reviewed: true });
    await campaignStep(admin, c.id, "start");
    const f = fake();
    // Only this campaign's leads should be dialled, one line at a time
    await db.acCampaign.updateMany({ where: { id: { not: c.id }, status: "RUNNING" }, data: { status: "STOPPED" } });
    expect((await runDialer({ provider: f.provider, now: noon })).placed).toBe(1);
    expect((await runDialer({ provider: f.provider, now: noon })).placed).toBe(0); // the line is still busy
    await db.acCall.updateMany({ where: { campaignId: c.id }, data: { status: "COMPLETED", disposition: "NOT_INTERESTED", endedAt: noon } });
    expect((await runDialer({ provider: f.provider, now: noon })).placed).toBe(1);
    await db.acCall.updateMany({ where: { campaignId: c.id }, data: { status: "COMPLETED", disposition: "NOT_INTERESTED", endedAt: noon } });
    await runDialer({ provider: f.provider, now: noon });
    expect(f.dialed).toHaveLength(2);
    expect((await db.acCampaign.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("COMPLETED");
    expect(leads).toHaveLength(3);
  });

  it("does not dial outside permitted hours", async () => {
    await liveSettings();
    await lead();
    const c = await createCampaign(admin, { name: "Hours", states: ["Jharkhand"], maxCalls: 3, testMode: false });
    await campaignStep(admin, c.id, "approve", { reviewed: true });
    await campaignStep(admin, c.id, "start");
    await db.acCampaign.updateMany({ where: { id: { not: c.id }, status: "RUNNING" }, data: { status: "STOPPED" } });
    const f = fake();
    const night = new Date(Date.UTC(2026, 9, 26, 17, 0)); // 22:30 India
    expect((await runDialer({ provider: f.provider, now: night })).placed).toBe(0);
    expect(f.dialed).toHaveLength(0);
  });

  it("the dashboard counts what is stored and shows no cost the provider didn't report", async () => {
    const o = await callingOverview(admin);
    expect(o.costPaise).toBeNull();
    expect(typeof o.total).toBe("number");
    expect(o.provider.checks.map((c) => c.key)).toContain("ELEVENLABS_API_KEY");
  });

  it("the do-not-call list is added to by hand, audited, and removal needs a reason", async () => {
    const p = mobile();
    await addSuppressionByAdmin(admin, p, "Owner phoned to complain");
    expect(await db.acSuppression.findUnique({ where: { phoneNorm: p } })).not.toBeNull();
    await removeSuppression(admin, p, "Owner asked in writing to be called again");
    expect(await db.acSuppression.findUnique({ where: { phoneNorm: p } })).toBeNull();
    expect(await db.crmAudit.count({ where: { kind: "calling", actorId: admin.id } })).toBeGreaterThan(0);
  });

  it("old transcripts are deleted", async () => {
    const l = await lead();
    const c = await db.acCall.create({ data: { leadId: l.id, phone: "9000000000", idempotencyKey: `p:${randomUUID()}`, status: "COMPLETED", tokenHash: "x", transcript: [{ role: "user", text: "hi", at: 1 }], transcriptExpiresAt: new Date(Date.now() - 1000) } });
    expect(await purgeTranscripts()).toBeGreaterThanOrEqual(1);
    expect((await db.acCall.findUniqueOrThrow({ where: { id: c.id } })).transcript).toBeNull();
  });
});
