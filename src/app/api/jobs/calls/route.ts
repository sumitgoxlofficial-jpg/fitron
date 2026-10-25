import { cronAuthorised } from "@/lib/services/cron-auth";
import { runDialer } from "@/lib/services/ai-calling/dialer";
import { purgeTranscripts } from "@/lib/services/ai-calling/webhook";

// The AI caller's worker: places the next calls of every running campaign (within permitted hours, concurrency and the call
// limit), closes calls that never reported back, and deletes transcripts past their retention date. Call it every 10 minutes
// with "Authorization: Bearer $CRON_SECRET". It does nothing while the emergency stop is on or no campaign is running.
export const maxDuration = 120;

async function handle(req: Request) {
  if (!cronAuthorised(req)) return Response.json({ error: "Unauthorised" }, { status: 401 });
  const r = await runDialer();
  const purged = await purgeTranscripts();
  return Response.json({ ok: true, ...r, purged });
}

export const GET = handle;
export const POST = handle;
