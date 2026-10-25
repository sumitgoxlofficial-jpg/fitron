import { z } from "zod";
import "@/lib/zod-config";

// What ElevenLabs sends after a call, read defensively: only fields this system uses, all optional, extra fields ignored. A
// shape that doesn't fit is refused, not guessed at.

const Turn = z.object({ role: z.string(), message: z.string().nullish(), time_in_call_secs: z.number().nullish() });

const Transcription = z.object({
  type: z.literal("post_call_transcription"),
  event_timestamp: z.number().optional(),
  data: z.object({
    conversation_id: z.string(),
    status: z.string().optional(),
    transcript: z.array(Turn).default([]),
    metadata: z.object({ call_duration_secs: z.number().nullish(), start_time_unix_secs: z.number().nullish(), cost: z.number().nullish() }).partial().passthrough().optional(),
    analysis: z.object({ transcript_summary: z.string().nullish(), call_successful: z.string().nullish() }).partial().passthrough().optional(),
    conversation_initiation_client_data: z.object({ dynamic_variables: z.record(z.string(), z.unknown()).optional() }).partial().passthrough().optional(),
  }),
});

const Failure = z.object({
  type: z.literal("call_initiation_failure"),
  event_timestamp: z.number().optional(),
  data: z.object({
    conversation_id: z.string().nullish(),
    failure_reason: z.string().nullish(),
    conversation_initiation_client_data: z.object({ dynamic_variables: z.record(z.string(), z.unknown()).optional() }).partial().passthrough().optional(),
  }),
});

export type ProviderEvent =
  | { kind: "ended"; conversationId: string; callId: string | null; durationSec: number | null; summary: string | null; turns: { role: string; text: string; at: number | null }[]; heardOwner: boolean; costRaw: number | null }
  | { kind: "failed"; conversationId: string | null; callId: string | null; status: "BUSY" | "NO_ANSWER" | "FAILED"; reason: string }
  | { kind: "ignored"; type: string };

const dyn = (d?: { dynamic_variables?: Record<string, unknown> }) => (typeof d?.dynamic_variables?.call_id === "string" ? d.dynamic_variables.call_id : null);

export function parseProviderEvent(json: unknown): ProviderEvent {
  const type = typeof (json as { type?: unknown })?.type === "string" ? (json as { type: string }).type : "unknown";
  if (type === "post_call_transcription") {
    const p = Transcription.parse(json).data;
    const turns = p.transcript.filter((t) => t.message).map((t) => ({ role: t.role, text: t.message as string, at: t.time_in_call_secs ?? null }));
    return { kind: "ended", conversationId: p.conversation_id, callId: dyn(p.conversation_initiation_client_data), durationSec: p.metadata?.call_duration_secs != null ? Math.round(p.metadata.call_duration_secs) : null, summary: p.analysis?.transcript_summary ?? null, turns, heardOwner: turns.some((t) => t.role === "user"), costRaw: p.metadata?.cost ?? null };
  }
  if (type === "call_initiation_failure") {
    const p = Failure.parse(json).data;
    const r = (p.failure_reason ?? "unknown").toLowerCase();
    return { kind: "failed", conversationId: p.conversation_id ?? null, callId: dyn(p.conversation_initiation_client_data), status: r.includes("busy") ? "BUSY" : r.includes("no-answer") || r.includes("no_answer") || r.includes("noanswer") ? "NO_ANSWER" : "FAILED", reason: r.slice(0, 200) };
  }
  return { kind: "ignored", type };
}
