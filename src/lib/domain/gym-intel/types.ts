import type { SourceKey } from "./sources";

/** One source's account of one gym, before it is matched to a gym record. */
export type Observation = {
  source: SourceKey;
  sourceUrl: string;
  sourceRecordId: string;
  name: string;
  /** Exactly as the source published them */
  phonesRaw: string[];
  address?: string | null;
  state?: string | null;
  district?: string | null;
  city?: string | null;
  locality?: string | null;
  pin?: string | null;
  website?: string | null;
  lat?: number | null;
  lon?: number | null;
  category?: string | null;
  /** The few source fields kept as evidence */
  evidence?: Record<string, unknown>;
};
