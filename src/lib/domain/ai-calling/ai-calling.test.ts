import { describe, expect, it } from "vitest";
import { callBlockers, type CallFacts } from "./compliance";
import { DEFAULT_AC_SETTINGS, AcSettingsSchema } from "./settings";
import { callToken, hashToken, safeEqual, signElevenBody, verifyElevenSignature } from "./signature";
import { currentOffer } from "./offer";
import { TOOL_SCHEMAS, TOOL_NAMES, toolParamsJson } from "./tools";
import { demoSlotProblem, nextSlots } from "./demo";
import { parseProviderEvent } from "./events";
import { productInfo } from "./knowledge";
import { AGENT_PROMPT } from "./prompt";
import { DISPOSITIONS, DISPOSITION_EFFECT } from "./constants";

const at = (hhmm: string, day = "2026-10-26") => new Date(new Date(`${day}T${hhmm}:00.000Z`).getTime() - 330 * 60_000); // India time
const live = AcSettingsSchema.parse({ mode: "live", attest: { telemarketerRegistered: true, routeAllowsAiPromotionalCalls: true, dndScrubbed: true } });
const facts = (o: Partial<CallFacts> = {}): CallFacts => ({
  settings: live, campaign: { status: "RUNNING", testMode: false, hoursFrom: 600, hoursTo: 1080 }, phone: "9876543210", suppressed: false, consentBasis: "ENQUIRY",
  leadOpen: true, attemptsMade: 0, lastAttemptAt: null, callsToday: 0, now: at("11:00"), ...o,
});

describe("callBlockers", () => {
  it("lets a consented, unsuppressed lead be called in hours on a live, confirmed system", () => expect(callBlockers(facts())).toEqual([]));
  it("the emergency stop beats everything", () => expect(callBlockers(facts({ settings: { ...live, emergencyStop: true } }))[0]).toMatch(/emergency stop/));
  it("a public listing is not consent", () => expect(callBlockers(facts({ consentBasis: null })).join()).toMatch(/why this number may be called/));
  it("a suppressed number is never called", () => expect(callBlockers(facts({ suppressed: true })).join()).toMatch(/do-not-call/));
  it("live calling needs the telecom checks", () => expect(callBlockers(facts({ settings: { ...live, attest: { ...live.attest, dndScrubbed: false } } })).join()).toMatch(/telecom checks/));
  it("test mode only dials the allow-list", () => {
    const t = { ...live, mode: "test" as const, testNumbers: ["9000000001"] };
    expect(callBlockers(facts({ settings: t, consentBasis: null })).join()).toMatch(/authorised test numbers/);
    expect(callBlockers(facts({ settings: t, phone: "9000000001", consentBasis: null }))).toEqual([]);
  });
  it("a test campaign is test-only even when the system is live", () => expect(callBlockers(facts({ campaign: { status: "RUNNING", testMode: true, hoursFrom: 540, hoursTo: 1260 } })).join()).toMatch(/authorised test numbers/));
  it("keeps to 9 am to 9 pm India time even if the campaign asks for more", () => {
    const wide = { status: "RUNNING", testMode: false, hoursFrom: 0, hoursTo: 1440 };
    expect(callBlockers(facts({ campaign: wide, now: at("08:30") })).join()).toMatch(/hours/);
    expect(callBlockers(facts({ campaign: wide, now: at("21:00") })).join()).toMatch(/hours/);
    expect(callBlockers(facts({ campaign: wide, now: at("20:59") }))).toEqual([]);
  });
  it("a paused campaign, a closed lead, too many or too recent attempts, and the daily cap", () => {
    expect(callBlockers(facts({ campaign: { status: "PAUSED", testMode: false, hoursFrom: 600, hoursTo: 1080 } })).join()).toMatch(/paused/);
    expect(callBlockers(facts({ leadOpen: false })).join()).toMatch(/closed/);
    expect(callBlockers(facts({ attemptsMade: 2 })).join()).toMatch(/Already tried/);
    expect(callBlockers(facts({ attemptsMade: 1, lastAttemptAt: at("10:00") })).join()).toMatch(/too recently/);
    expect(callBlockers(facts({ attemptsMade: 1, lastAttemptAt: at("06:00") }))).toEqual([]);
    expect(callBlockers(facts({ callsToday: live.dailyCallCap })).join()).toMatch(/limit/);
  });
  it("no valid number", () => expect(callBlockers(facts({ phone: null })).join()).toMatch(/valid 10-digit/));
  it("defaults are safe: test mode, stop off, nothing attested", () => {
    expect(DEFAULT_AC_SETTINGS.mode).toBe("test");
    expect(DEFAULT_AC_SETTINGS.offer.active).toBe(false);
    expect(callBlockers(facts({ settings: DEFAULT_AC_SETTINGS })).length).toBeGreaterThan(0);
  });
});

describe("signatures", () => {
  const body = '{"type":"post_call_transcription"}';
  it("accepts a good ElevenLabs signature and rejects forgeries, old ones and a changed body", () => {
    const now = Date.now();
    const h = signElevenBody(body, "whsec", now);
    expect(verifyElevenSignature(body, h, "whsec", now)).toBe(true);
    expect(verifyElevenSignature(body + " ", h, "whsec", now)).toBe(false);
    expect(verifyElevenSignature(body, h, "other", now)).toBe(false);
    expect(verifyElevenSignature(body, signElevenBody(body, "whsec", now - 3_600_000), "whsec", now)).toBe(false);
    expect(verifyElevenSignature(body, null, "whsec", now)).toBe(false);
    expect(verifyElevenSignature(body, h, undefined, now)).toBe(false);
    expect(verifyElevenSignature(body, "garbage", "whsec", now)).toBe(false);
  });
  it("a call token is tied to its call", () => {
    expect(callToken("s", "a")).not.toBe(callToken("s", "b"));
    expect(safeEqual(hashToken(callToken("s", "a")), hashToken(callToken("s", "a")))).toBe(true);
  });
});

describe("offer", () => {
  const on = { ...DEFAULT_AC_SETTINGS.offer, active: true };
  it("is off by default and says there is none", () => {
    const o = currentOffer(DEFAULT_AC_SETTINGS.offer);
    expect(o.active).toBe(false);
    expect(o.lines.join(" ")).toMatch(/no introductory offer/);
  });
  it("50% off the Professional plan is ₹999.50, 'about ₹1,000'", () => {
    const o = currentOffer(on);
    expect(o.listMonthlyPaise).toBe(1_99_900);
    expect(o.discountedMonthlyPaise).toBe(99_950);
    expect(o.lines.join(" ")).toContain("₹999.50");
    expect(o.lines.join(" ")).toContain("about ₹1,000");
    expect(o.lines.join(" ")).toContain("1 month free");
  });
  it("stops quoting once the first-100 places are gone", () => {
    const o = currentOffer({ ...on, slotsClaimed: 100 });
    expect(o.active).toBe(false);
    expect(o.lines.join(" ")).toMatch(/fully claimed/);
  });
  it("an unknown plan quotes nothing", () => expect(currentOffer({ ...on, plan: "nope" }).active).toBe(false));
});

describe("tools", () => {
  const ids = { call_id: "c1", call_token: "t".repeat(64) };
  it("has the eight tools", () => expect([...TOOL_NAMES].sort()).toEqual(["end_call", "get_current_offer", "get_fitron_product_information", "get_gym_details", "record_opt_out", "request_human_followup", "save_call_disposition", "schedule_demo"]));
  it("validates inputs", () => {
    expect(TOOL_SCHEMAS.save_call_disposition.safeParse({ ...ids, disposition: "INTERESTED", summary: "Wants a demo" }).success).toBe(true);
    expect(TOOL_SCHEMAS.save_call_disposition.safeParse({ ...ids, disposition: "SOLD", summary: "x" }).success).toBe(false);
    expect(TOOL_SCHEMAS.schedule_demo.safeParse({ ...ids, slot_start: "tomorrow at 5" }).success).toBe(false);
    expect(TOOL_SCHEMAS.schedule_demo.safeParse({ ...ids, slot_start: "2026-10-27T11:00:00+05:30" }).success).toBe(true);
    expect(TOOL_SCHEMAS.get_fitron_product_information.safeParse({ ...ids, topic: "integrations" }).success).toBe(false);
    expect(TOOL_SCHEMAS.get_gym_details.safeParse({ call_id: "c1", call_token: "short" }).success).toBe(false);
  });
  it("the JSON given to ElevenLabs omits the ids the model must not choose", () => {
    const j = toolParamsJson("schedule_demo") as { properties: Record<string, unknown>; required: string[] };
    expect(Object.keys(j.properties)).toEqual(["slot_start", "attendee_name", "note"]);
    expect(j.required).toEqual(["slot_start"]);
  });
});

describe("demo slots", () => {
  const s = DEFAULT_AC_SETTINGS;
  const now = at("09:00"); // Monday 26 Oct 2026
  it("accepts a working-hours half-hour slot with notice", () => expect(demoSlotProblem(at("15:00"), s, now)).toBeNull());
  it("refuses too soon, a Sunday, out of hours and odd minutes", () => {
    expect(demoSlotProblem(at("10:00"), s, now)).toMatch(/notice/);
    expect(demoSlotProblem(at("11:00", "2026-11-01"), s, now)).toMatch(/day/);
    expect(demoSlotProblem(at("19:00", "2026-10-27"), s, now)).toMatch(/between/);
    expect(demoSlotProblem(at("11:10", "2026-10-27"), s, now)).toMatch(/half hour/);
    expect(demoSlotProblem(new Date("x"), s, now)).toMatch(/valid/);
  });
  it("suggests free slots, skipping taken ones", () => {
    const first = nextSlots([], s, now)[0]!;
    const next = nextSlots([first], s, now);
    expect(next).toHaveLength(3);
    expect(next.some((d) => d.getTime() === first.getTime())).toBe(false);
  });
});

describe("provider events", () => {
  it("reads a post-call transcript", () => {
    const e = parseProviderEvent({ type: "post_call_transcription", data: { conversation_id: "conv_1", transcript: [{ role: "agent", message: "Hello", time_in_call_secs: 0 }, { role: "user", message: "Yes", time_in_call_secs: 3 }], metadata: { call_duration_secs: 41.4 }, analysis: { transcript_summary: "Owner agreed" }, conversation_initiation_client_data: { dynamic_variables: { call_id: "abc" } } } });
    expect(e).toMatchObject({ kind: "ended", conversationId: "conv_1", callId: "abc", durationSec: 41, heardOwner: true, summary: "Owner agreed" });
  });
  it("reads failures", () => {
    expect(parseProviderEvent({ type: "call_initiation_failure", data: { conversation_id: "c", failure_reason: "busy" } })).toMatchObject({ kind: "failed", status: "BUSY" });
    expect(parseProviderEvent({ type: "call_initiation_failure", data: { failure_reason: "no-answer" } })).toMatchObject({ status: "NO_ANSWER" });
    expect(parseProviderEvent({ type: "call_initiation_failure", data: { failure_reason: "weird" } })).toMatchObject({ status: "FAILED" });
  });
  it("ignores other events and refuses a malformed one", () => {
    expect(parseProviderEvent({ type: "post_call_audio", data: {} })).toEqual({ kind: "ignored", type: "post_call_audio" });
    expect(() => parseProviderEvent({ type: "post_call_transcription", data: {} })).toThrow();
  });
});

describe("what the agent may say", () => {
  it("product facts come from the price list", () => {
    expect(productInfo("plans").join(" ")).toContain("₹1,999");
    expect(productInfo("trial")[0]).toMatch(/7-day/);
    expect(productInfo("features").some((f) => /Payment and outstanding fee/.test(f))).toBe(true);
  });
  it("the instructions forbid inventing facts and require disclosure", () => {
    expect(AGENT_PROMPT).toMatch(/AI calling assistant/);
    expect(AGENT_PROMPT).toMatch(/Never invent/);
    expect(AGENT_PROMPT).toMatch(/record_opt_out/);
    expect(AGENT_PROMPT).toMatch(/booked: true/);
  });
  it("every disposition has a CRM effect", () => { for (const d of DISPOSITIONS) expect(DISPOSITION_EFFECT[d]).toBeDefined(); });
});
