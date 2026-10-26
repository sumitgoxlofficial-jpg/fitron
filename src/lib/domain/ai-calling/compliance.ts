import { istClockMinutes } from "./time";
import type { AcSettings } from "./settings";
import { liveReady } from "./settings";

// The one place that decides whether a number may be called right now. It is run again, with fresh data, immediately before
// every call; a campaign's approval never replaces it. Pure: the caller loads the facts.

/** Promotional calls are only made between these India times, whatever a campaign asks for (TRAI's window for promotional communication: 9 am to 9 pm). */
export const LEGAL_FROM = 9 * 60;
export const LEGAL_TO = 21 * 60;

export type CallFacts = {
  settings: AcSettings;
  /** null for a test call placed from the readiness page */
  campaign: { status: string; testMode: boolean; hoursFrom: number; hoursTo: number } | null;
  /** 10-digit number, or null if the lead's number isn't a valid mobile */
  phone: string | null;
  suppressed: boolean;
  consentBasis: string | null;
  leadOpen: boolean;
  attemptsMade: number;
  lastAttemptAt: Date | null;
  callsToday: number;
  now: Date;
};

/** Everything that stops this call, in plain words. Empty means the call may go ahead. */
export function callBlockers(f: CallFacts): string[] {
  const out: string[] = [];
  const s = f.settings;
  if (s.emergencyStop) out.push("The emergency stop is on.");
  if (f.campaign && f.campaign.status !== "RUNNING") out.push(`The campaign is ${f.campaign.status.toLowerCase()}, not running.`);
  if (!f.phone) out.push("The lead has no valid 10-digit mobile number.");
  if (f.suppressed) out.push("This number is on the do-not-call list.");
  const testOnly = s.mode === "test" || (f.campaign?.testMode ?? true);
  if (testOnly) {
    if (f.phone && !s.testNumbers.includes(f.phone)) out.push("Test mode: only the authorised test numbers can be called.");
  } else {
    if (!liveReady(s)) out.push("Live calling needs the telecom checks confirmed in Settings.");
    if (!f.consentBasis) out.push("No record of why this number may be called with a sales message.");
  }
  if (!f.leadOpen) out.push("The lead is already closed.");
  // Test calls placed from the settings page (campaign === null) are internal checks,
  // not promotional messages, so the TRAI window doesn't apply to them.
  if (f.campaign !== null) {
    const mins = istClockMinutes(f.now);
    const from = Math.max(LEGAL_FROM, f.campaign.hoursFrom);
    const to = Math.min(LEGAL_TO, f.campaign.hoursTo);
    if (mins < from || mins >= to) out.push("Outside the permitted calling hours.");
  }
  if (f.attemptsMade >= s.maxAttempts) out.push(`Already tried ${f.attemptsMade} time${f.attemptsMade === 1 ? "" : "s"}.`);
  else if (f.lastAttemptAt && f.now.getTime() - f.lastAttemptAt.getTime() < s.retryGapMinutes * 60_000) out.push("Tried too recently.");
  if (f.callsToday >= s.dailyCallCap) out.push("Today's call limit is reached.");
  return out;
}
