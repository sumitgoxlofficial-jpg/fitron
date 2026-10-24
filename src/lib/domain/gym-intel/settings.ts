import "@/lib/zod-config";
import { z } from "zod";
import { GYM_CATEGORIES } from "./constants";
import { DEFAULT_MATCH } from "./match";

const categories = GYM_CATEGORIES.map((c) => c[0]) as [string, ...string[]];

/** Collection settings, with safe defaults. Anything the browser sends is checked against this before it is kept. */
export const SettingsSchema = z.object({
  categories: z.array(z.enum(categories)).min(1).default(["gym", "fitness_centre"]),
  requestsPerMinute: z.number().int().min(1).max(60).default(6),
  concurrency: z.number().int().min(1).max(4).default(1),
  retryAttempts: z.number().int().min(0).max(6).default(3),
  retryBackoffSeconds: z.number().int().min(5).max(3600).default(60),
  cacheHours: z.number().int().min(1).max(24 * 90).default(24 * 7),
  batchSize: z.number().int().min(1).max(200).default(25),
  enrichMissingPhones: z.boolean().default(true),
  recheckDuplicates: z.boolean().default(true),
  staleAfterDays: z.number().int().min(30).max(1825).default(365),
  /** Names this alike (0–1) at the same place are one business; this alike with something shared go to a person */
  sameNameThreshold: z.number().min(0.7).max(1).default(DEFAULT_MATCH.sameName),
  ambiguousNameThreshold: z.number().min(0.5).max(0.99).default(DEFAULT_MATCH.ambiguousName),
  nearMeters: z.number().int().min(20).max(1000).default(DEFAULT_MATCH.nearMeters),
  /** Only mobile and landline numbers that parse as Indian numbers are format-valid */
  acceptTollFree: z.boolean().default(false),
  exportDefaults: z.object({ onlyWithPhone: z.boolean().default(true), includeConflicts: z.boolean().default(false) }).default({ onlyWithPhone: true, includeConflicts: false }),
  /** Let Claude find websites and choose between a page's numbers; it can never supply a number */
  aiEnabled: z.boolean().default(false),
  /** Most Claude calls in one India day, so a nationwide job can't run up a bill */
  aiDailyCap: z.number().int().min(0).max(5000).default(200),
  retentionDays: z.number().int().min(90).max(3650).default(1095),
  confirmAbove: z.number().int().min(1).max(36).default(3),
});
export type GiSettings = z.infer<typeof SettingsSchema>;
export const DEFAULT_SETTINGS: GiSettings = SettingsSchema.parse({});
