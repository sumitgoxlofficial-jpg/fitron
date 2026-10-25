import { Badge, type Tone } from "@/components/ui";
import { DISPOSITION_LABEL, isDisposition } from "@/lib/domain/ai-calling/constants";

const CALL_TONE: Record<string, Tone> = { COMPLETED: "ok", IN_PROGRESS: "accent", DIALING: "accent", QUEUED: "neutral", NO_ANSWER: "neutral", BUSY: "neutral", FAILED: "alert", CANCELLED: "neutral" };
export const CallStatusBadge = ({ s }: { s: string }) => <Badge tone={CALL_TONE[s] ?? "neutral"}>{s.replace(/_/g, " ").toLowerCase()}</Badge>;

const DISP_TONE: Record<string, Tone> = { INTERESTED: "ok", DEMO_REQUESTED: "ok", DEMO_BOOKED: "ok", FOLLOW_UP: "accent", HUMAN_HANDOFF: "accent", NOT_INTERESTED: "neutral", NO_ANSWER: "neutral", BUSY: "neutral", INVALID_NUMBER: "alert", DO_NOT_CONTACT: "alert" };
export const DispositionBadge = ({ d }: { d: string | null }) => (d ? <Badge tone={DISP_TONE[d] ?? "neutral"}>{isDisposition(d) ? DISPOSITION_LABEL[d] : d}</Badge> : <span className="text-[var(--muted)]">—</span>);

const CAMP_TONE: Record<string, Tone> = { RUNNING: "ok", APPROVED: "accent", PAUSED: "neutral", DRAFT: "neutral", STOPPED: "alert", COMPLETED: "ok", PENDING: "accent" };
export const CampaignBadge = ({ s }: { s: string }) => <Badge tone={CAMP_TONE[s] ?? "neutral"}>{s.toLowerCase()}</Badge>;

export const when = (d: Date | null | undefined) => (d ? new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) : "—");
export const mmss = (s: number | null | undefined) => (s == null ? "—" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
