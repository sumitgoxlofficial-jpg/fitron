// AI Calling: the words the system uses. Nothing here touches a database or the network.

export const DISPOSITIONS = ["INTERESTED", "DEMO_REQUESTED", "DEMO_BOOKED", "FOLLOW_UP", "NOT_INTERESTED", "NO_ANSWER", "BUSY", "INVALID_NUMBER", "HUMAN_HANDOFF", "DO_NOT_CONTACT"] as const;
export type Disposition = (typeof DISPOSITIONS)[number];
export const DISPOSITION_LABEL: Record<Disposition, string> = {
  INTERESTED: "Interested", DEMO_REQUESTED: "Demo requested", DEMO_BOOKED: "Demo booked", FOLLOW_UP: "Follow-up required", NOT_INTERESTED: "Not interested",
  NO_ANSWER: "No answer", BUSY: "Busy", INVALID_NUMBER: "Invalid number", HUMAN_HANDOFF: "Human handoff requested", DO_NOT_CONTACT: "Do not contact",
};
export const isDisposition = (v: unknown): v is Disposition => typeof v === "string" && (DISPOSITIONS as readonly string[]).includes(v);

export const CALL_STATUSES = ["QUEUED", "DIALING", "IN_PROGRESS", "COMPLETED", "NO_ANSWER", "BUSY", "FAILED", "CANCELLED"] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];
/** A call in one of these is still using a line, so it counts against a campaign's concurrency */
export const LIVE_STATUSES: readonly CallStatus[] = ["DIALING", "IN_PROGRESS"];
export const FINAL_STATUSES: readonly CallStatus[] = ["COMPLETED", "NO_ANSWER", "BUSY", "FAILED", "CANCELLED"];

export const CAMPAIGN_STATUSES = ["DRAFT", "PENDING", "APPROVED", "RUNNING", "PAUSED", "STOPPED", "COMPLETED"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** Why a number may be called with a sales message. Being listed publicly is not on this list on purpose. */
export const CONSENT_BASES = ["ENQUIRY", "EXISTING_CUSTOMER", "OPTED_IN", "TEST"] as const;
export type ConsentBasis = (typeof CONSENT_BASES)[number];
export const CONSENT_LABEL: Record<ConsentBasis, string> = {
  ENQUIRY: "The gym enquired about FITRON", EXISTING_CUSTOMER: "Existing FITRON customer", OPTED_IN: "Agreed to receive calls from FITRON", TEST: "Authorised test number",
};

/** What a finished conversation does to the CRM lead: the call outcome logged, and the stage it moves to (null = leave the stage alone; a person closes a lost deal, not a phone call). */
export const DISPOSITION_EFFECT: Record<Disposition, { outcome: string; stage: string | null; followUp: boolean }> = {
  INTERESTED: { outcome: "Connected", stage: "Interested", followUp: true },
  DEMO_REQUESTED: { outcome: "Connected", stage: "Interested", followUp: true },
  DEMO_BOOKED: { outcome: "Connected", stage: "Demo Scheduled", followUp: false },
  FOLLOW_UP: { outcome: "Callback requested", stage: "Contacted", followUp: true },
  NOT_INTERESTED: { outcome: "Connected", stage: null, followUp: false },
  NO_ANSWER: { outcome: "No answer", stage: null, followUp: false },
  BUSY: { outcome: "Busy", stage: null, followUp: false },
  INVALID_NUMBER: { outcome: "Wrong number", stage: "Disqualified", followUp: false },
  HUMAN_HANDOFF: { outcome: "Callback requested", stage: "Contacted", followUp: true },
  DO_NOT_CONTACT: { outcome: "Connected", stage: null, followUp: false },
};

/** Calls worth trying again later */
export const RETRYABLE: readonly Disposition[] = ["NO_ANSWER", "BUSY"];
/** Dispositions that mean "never call this number again" */
export const NEVER_AGAIN: readonly Disposition[] = ["DO_NOT_CONTACT", "INVALID_NUMBER"];
