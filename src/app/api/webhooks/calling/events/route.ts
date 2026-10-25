import { parseProviderEvent } from "@/lib/domain/ai-calling/events";
import { verifyElevenSignature } from "@/lib/domain/ai-calling/signature";
import { log } from "@/lib/log";
import { handleProviderEvent } from "@/lib/services/ai-calling/webhook";

// ElevenLabs → FITRON, after each call (post-call webhook). Set the address https://<your-domain>/api/webhooks/calling/events and
// the signing secret ELEVENLABS_WEBHOOK_SECRET in ElevenLabs. A forged or stale request is refused before anything is read.
export const maxDuration = 30;

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyElevenSignature(raw, req.headers.get("elevenlabs-signature"), process.env.ELEVENLABS_WEBHOOK_SECRET?.trim())) return Response.json({ error: "bad_signature" }, { status: 401 });
  let ev;
  try {
    ev = parseProviderEvent(JSON.parse(raw));
  } catch {
    return Response.json({ error: "bad_payload" }, { status: 400 });
  }
  try {
    const matched = await handleProviderEvent(ev);
    // 200 even for a call that isn't ours, so the provider doesn't retry it
    return Response.json({ ok: true, matched });
  } catch (e) {
    log.error("calling.event_failed", e);
    return Response.json({ error: "server_error" }, { status: 500 }); // the provider retries
  }
}
