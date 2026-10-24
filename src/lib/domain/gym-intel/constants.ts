// Gym Intelligence: the fixed vocabularies. Pure; shared by the services, the pages and the tests.

export const PHONE_STATUSES = ["UNTESTED", "FORMAT_VALID", "SOURCE_CONFIRMED", "REACHABILITY_CONFIRMED", "INVALID_FORMAT", "CONFLICTING_SOURCES", "STALE", "UNAVAILABLE"] as const;
export type PhoneStatus = (typeof PHONE_STATUSES)[number];

export const PHONE_STATUS_LABEL: Record<PhoneStatus, string> = {
  UNTESTED: "Untested",
  FORMAT_VALID: "Valid format",
  SOURCE_CONFIRMED: "Source confirmed",
  REACHABILITY_CONFIRMED: "Reachability confirmed",
  INVALID_FORMAT: "Invalid format",
  CONFLICTING_SOURCES: "Conflicting sources",
  STALE: "Stale",
  UNAVAILABLE: "Unavailable",
};

export const GEO_STATUSES = ["NOT_STARTED", "QUEUED", "IN_PROGRESS", "COMPLETED_WITH_RESULTS", "COMPLETED_NO_RESULTS", "PARTIALLY_COMPLETED", "FAILED", "REQUIRES_REVIEW"] as const;
export type GeoStatus = (typeof GEO_STATUSES)[number];

export const JOB_STATUSES = ["DRAFT", "QUEUED", "RUNNING", "PAUSED", "COMPLETED", "FAILED", "CANCELLED"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const JOB_KINDS = ["DISCOVERY", "ENRICHMENT", "REFRESH", "IMPORT"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const PROMOTION_STATES = ["NOT_PROMOTED", "PROMOTED", "SKIPPED", "DUPLICATE_FLAGGED", "DO_NOT_CONTACT"] as const;
export type Promotion = (typeof PROMOTION_STATES)[number];
export const PHONE_KINDS = ["MOBILE", "LANDLINE", "TOLL_FREE", "OTHER"] as const;
export type PhoneKind = (typeof PHONE_KINDS)[number];
export const ASSOCIATIONS = ["GENERAL_BUSINESS", "OWNER_DIRECT", "UNKNOWN"] as const;

/** The gym categories a job can search for. The OpenStreetMap tags each one looks for are in osm.ts. */
export const GYM_CATEGORIES = [
  ["gym", "Gym"],
  ["fitness_centre", "Fitness centre"],
  ["health_club", "Health club"],
  ["bodybuilding", "Bodybuilding gym"],
  ["strength", "Strength training gym"],
  ["womens", "Women's gym"],
  ["functional", "Functional fitness centre"],
  ["personal_training", "Personal training studio"],
  ["crossfit", "Cross-training gym"],
] as const;
export type GymCategory = (typeof GYM_CATEGORIES)[number][0];

/** The 28 states and 8 union territories, by ISO 3166-2:IN code. */
export const INDIA_STATES: readonly { code: string; name: string; ut: boolean }[] = [
  { code: "IN-AP", name: "Andhra Pradesh", ut: false },
  { code: "IN-AR", name: "Arunachal Pradesh", ut: false },
  { code: "IN-AS", name: "Assam", ut: false },
  { code: "IN-BR", name: "Bihar", ut: false },
  { code: "IN-CT", name: "Chhattisgarh", ut: false },
  { code: "IN-GA", name: "Goa", ut: false },
  { code: "IN-GJ", name: "Gujarat", ut: false },
  { code: "IN-HR", name: "Haryana", ut: false },
  { code: "IN-HP", name: "Himachal Pradesh", ut: false },
  { code: "IN-JH", name: "Jharkhand", ut: false },
  { code: "IN-KA", name: "Karnataka", ut: false },
  { code: "IN-KL", name: "Kerala", ut: false },
  { code: "IN-MP", name: "Madhya Pradesh", ut: false },
  { code: "IN-MH", name: "Maharashtra", ut: false },
  { code: "IN-MN", name: "Manipur", ut: false },
  { code: "IN-ML", name: "Meghalaya", ut: false },
  { code: "IN-MZ", name: "Mizoram", ut: false },
  { code: "IN-NL", name: "Nagaland", ut: false },
  { code: "IN-OD", name: "Odisha", ut: false },
  { code: "IN-PB", name: "Punjab", ut: false },
  { code: "IN-RJ", name: "Rajasthan", ut: false },
  { code: "IN-SK", name: "Sikkim", ut: false },
  { code: "IN-TN", name: "Tamil Nadu", ut: false },
  { code: "IN-TG", name: "Telangana", ut: false },
  { code: "IN-TR", name: "Tripura", ut: false },
  { code: "IN-UP", name: "Uttar Pradesh", ut: false },
  { code: "IN-UT", name: "Uttarakhand", ut: false },
  { code: "IN-WB", name: "West Bengal", ut: false },
  { code: "IN-AN", name: "Andaman and Nicobar Islands", ut: true },
  { code: "IN-CH", name: "Chandigarh", ut: true },
  { code: "IN-DH", name: "Dadra and Nagar Haveli and Daman and Diu", ut: true },
  { code: "IN-DL", name: "Delhi", ut: true },
  { code: "IN-JK", name: "Jammu and Kashmir", ut: true },
  { code: "IN-LA", name: "Ladakh", ut: true },
  { code: "IN-LD", name: "Lakshadweep", ut: true },
  { code: "IN-PY", name: "Puducherry", ut: true },
];

export const stateByCode = (code: string) => INDIA_STATES.find((s) => s.code === code);
/** Matches the way places write a state (case, "&", old names) to the reference list. */
export function stateByName(raw: string | null | undefined) {
  const k = String(raw ?? "").toLowerCase().replace(/&/g, "and").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  if (!k) return undefined;
  const alias: Record<string, string> = { orissa: "Odisha", uttaranchal: "Uttarakhand", "nct of delhi": "Delhi", "new delhi": "Delhi", pondicherry: "Puducherry", "jammu and kashmir": "Jammu and Kashmir", "dadra and nagar haveli": "Dadra and Nagar Haveli and Daman and Diu", "daman and diu": "Dadra and Nagar Haveli and Daman and Diu", "andaman and nicobar": "Andaman and Nicobar Islands" };
  const name = alias[k] ?? k;
  return INDIA_STATES.find((s) => s.name.toLowerCase() === name.toLowerCase());
}
