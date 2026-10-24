import { cronAuthorised } from "@/lib/services/cron-auth";
import { runDueJobs } from "@/lib/services/gym-intel/jobs";

// The Gym Intelligence worker: advances every queued collection job a step at a time until the time is spent, and picks up
// jobs that were interrupted (their lease has run out). Call it every 30 minutes with "Authorization: Bearer $CRON_SECRET".
// Calling it again is harmless: a step records the same observations once.
export const maxDuration = 300;

async function handle(req: Request) {
  if (!cronAuthorised(req)) return Response.json({ error: "Unauthorised" }, { status: 401 });
  const ran = await runDueJobs(240_000);
  return Response.json({ ok: true, jobs: ran.length, steps: ran.reduce((n, j) => n + j.steps, 0) });
}

export const GET = handle;
export const POST = handle;
