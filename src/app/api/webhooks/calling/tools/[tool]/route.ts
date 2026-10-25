import { safeEqual } from "@/lib/domain/ai-calling/signature";
import { log } from "@/lib/log";
import { callingSecret } from "@/lib/services/ai-calling/provider";
import { executeTool } from "@/lib/services/ai-calling/tools";

// The AI agent's tools (ElevenLabs "server tools"), one address each: POST /api/webhooks/calling/tools/<name>.
// Two proofs are needed: the shared header below (so only our agent can reach this at all), and the call's own key in the
// body (so the agent can only act on the call it is on). Neither is ever shown to a browser.
export const maxDuration = 30;

export async function POST(req: Request, ctx: { params: Promise<{ tool: string }> }) {
  const secret = callingSecret();
  const given = req.headers.get("x-fitron-tool-secret") ?? "";
  if (secret.length < 24 || !given || !safeEqual(secret, given)) return Response.json({ error: "unauthorised" }, { status: 401 });
  const raw = await req.text();
  if (raw.length > 20_000) return Response.json({ error: "too_large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }
  const { tool } = await ctx.params;
  try {
    const r = await executeTool(tool, body);
    return Response.json(r.body, { status: r.status });
  } catch (e) {
    log.error("calling.tool_failed", e, { tool });
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
