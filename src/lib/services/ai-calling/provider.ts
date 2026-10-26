import "server-only";
import { UserError } from "../errors";

// The telephony side. Calls are placed through ElevenLabs' SIP-trunk outbound-call API (POST /v1/convai/sip-trunk/outbound-call,
// header xi-api-key; body agent_id, agent_phone_number_id, to_number, conversation_initiation_client_data), which dials through the
// SIP trunk imported into ElevenLabs. Nothing here speaks to Voice Link directly: its API and WebSocket protocol could not be
// verified (docs/AI_CALLING.md), and none is invented.

export type DialRequest = { to10: string; callId: string; callToken: string; gymName: string; contactName: string };
export type Dialed = { conversationId: string | null; sipCallId: string | null };
export type Provider = { dial(r: DialRequest): Promise<Dialed> };

export class ProviderError extends UserError {}

const env = (k: string) => process.env[k]?.trim() || "";

/** Which settings are in place, never their values */
export function providerStatus() {
  const checks = [
    { key: "ELEVENLABS_API_KEY", what: "ElevenLabs API key", ok: !!env("ELEVENLABS_API_KEY") },
    { key: "ELEVENLABS_AGENT_ID", what: "The FITRON AI Sales Agent's id", ok: !!env("ELEVENLABS_AGENT_ID") },
    { key: "ELEVENLABS_PHONE_NUMBER_ID", what: "The phone number id (the SIP-trunk number imported into ElevenLabs)", ok: !!env("ELEVENLABS_PHONE_NUMBER_ID") },
    { key: "ELEVENLABS_WEBHOOK_SECRET", what: "Post-call webhook signing secret", ok: !!env("ELEVENLABS_WEBHOOK_SECRET") },
    { key: "CALLING_TOOL_SECRET", what: "Secret the agent's tools send (and that signs each call's key)", ok: env("CALLING_TOOL_SECRET").length >= 24 },
  ];
  return { checks, ready: checks.every((c) => c.ok), apiBase: env("ELEVENLABS_API_BASE") || "https://api.elevenlabs.io" };
}

export const callingSecret = () => env("CALLING_TOOL_SECRET");

export function elevenLabsProvider(fetchFn: typeof fetch = fetch): Provider {
  return {
    async dial(r) {
      const st = providerStatus();
      if (!st.ready) throw new ProviderError("The calling provider isn't fully set up: " + st.checks.filter((c) => !c.ok).map((c) => c.key).join(", ") + " missing.");
      let res: Response;
      try {
        res = await fetchFn(`${st.apiBase.replace(/\/$/, "")}/v1/convai/sip-trunk/outbound-call`, {
          method: "POST",
          headers: { "xi-api-key": env("ELEVENLABS_API_KEY"), "content-type": "application/json" },
          body: JSON.stringify({
            agent_id: env("ELEVENLABS_AGENT_ID"),
            agent_phone_number_id: env("ELEVENLABS_PHONE_NUMBER_ID"),
            to_number: `+91${r.to10}`,
            conversation_initiation_client_data: { dynamic_variables: { call_id: r.callId, call_token: r.callToken, gym_name: r.gymName, owner_name: r.contactName } },
          }),
          signal: AbortSignal.timeout(20_000),
        });
      } catch (e) {
        throw new ProviderError(`The calling provider didn't answer (${e instanceof Error ? e.name : "error"}).`);
      }
      const body = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string; conversation_id?: string | null; sip_call_id?: string | null; detail?: unknown };
      if (!res.ok || body.success === false) {
        const why = typeof body.message === "string" ? body.message : typeof body.detail === "string" ? body.detail : typeof body.detail !== "undefined" ? JSON.stringify(body.detail).slice(0, 300) : `HTTP ${res.status}`;
        throw new ProviderError(`The calling provider refused the call: ${why.slice(0, 300)}`);
      }
      return { conversationId: body.conversation_id ?? null, sipCallId: body.sip_call_id ?? null };
    },
  };
}
