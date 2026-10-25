import "@/lib/zod-config";
import { z } from "zod";

const phone10 = z.string().regex(/^[6-9]\d{9}$/, "10-digit mobile number");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM");

/** Switches and limits for the AI caller. Anything saved is checked against this; a bad value is refused, never quietly changed. */
export const AcSettingsSchema = z.object({
  /** Stops every new call at once, whatever any campaign says */
  emergencyStop: z.boolean().default(false),
  /** test: only the numbers below can be dialled. live: leads with a consent record, once the checks below are confirmed. */
  mode: z.enum(["test", "live"]).default("test"),
  testNumbers: z.array(phone10).max(20).default([]),
  /** The Super Admin's confirmation of the telecom requirements (docs/AI_CALLING.md §Compliance). Live mode needs all three. */
  attest: z.object({
    telemarketerRegistered: z.boolean().default(false),
    routeAllowsAiPromotionalCalls: z.boolean().default(false),
    dndScrubbed: z.boolean().default(false),
    by: z.string().optional(),
    at: z.string().optional(),
  }).default({ telemarketerRegistered: false, routeAllowsAiPromotionalCalls: false, dndScrubbed: false }),
  maxAttempts: z.number().int().min(1).max(5).default(2),
  retryGapMinutes: z.number().int().min(60).max(7 * 24 * 60).default(240),
  dailyCallCap: z.number().int().min(1).max(5000).default(200),
  storeTranscripts: z.boolean().default(true),
  retentionDays: z.number().int().min(1).max(730).default(90),
  /** Demos can be booked on these days (0 = Sunday) between these India times */
  demoDays: z.array(z.number().int().min(0).max(6)).min(1).default([1, 2, 3, 4, 5, 6]),
  demoFrom: hhmm.default("10:00"),
  demoTo: hhmm.default("18:00"),
  demoMinHours: z.number().int().min(1).max(168).default(4),
  offer: z.object({
    active: z.boolean().default(false),
    freeMonths: z.number().int().min(0).max(12).default(1),
    percentOff: z.number().int().min(0).max(100).default(50),
    /** The plan the discount applies to: a key from src/lib/domain/pricing.ts */
    plan: z.string().default("professional"),
    slotsTotal: z.number().int().min(0).default(100),
    slotsClaimed: z.number().int().min(0).default(0),
    terms: z.string().max(600).default(""),
  }).default({ active: false, freeMonths: 1, percentOff: 50, plan: "professional", slotsTotal: 100, slotsClaimed: 0, terms: "" }),
});
export type AcSettings = z.infer<typeof AcSettingsSchema>;
export const DEFAULT_AC_SETTINGS: AcSettings = AcSettingsSchema.parse({});

export const liveReady = (s: AcSettings) => s.attest.telemarketerRegistered && s.attest.routeAllowsAiPromotionalCalls && s.attest.dndScrubbed;
