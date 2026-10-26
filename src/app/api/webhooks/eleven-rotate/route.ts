// Temporary: creates an ElevenLabs ConvAI post-call webhook and returns the signing_secret.
// Authenticated via ?secret=<WEBHOOK_SETUP_KEY>. DELETE THIS FILE once ELEVENLABS_WEBHOOK_SECRET is confirmed.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const WEBHOOK_URL = "https://fitron.in/api/webhooks/calling/events";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const setupKey = process.env.WEBHOOK_SETUP_KEY ?? process.env.CRON_SECRET;
  if (!setupKey || url.searchParams.get("secret") !== setupKey) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const apiBase = process.env.ELEVENLABS_API_BASE ?? "https://api.elevenlabs.io";
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  if (!apiKey) return Response.json({ error: "ELEVENLABS_API_KEY not set" }, { status: 500 });

  const h = { "xi-api-key": apiKey, "Content-Type": "application/json" };

  // Step 1: list existing webhooks to see if API is available
  const listRes = await fetch(`${apiBase}/v1/convai/webhooks`, { headers: h });
  const listStatus = listRes.status;
  const listData = await listRes.json().catch(() => null);

  // Step 2: find existing webhook for our URL
  const existing = Array.isArray(listData?.webhooks)
    ? listData.webhooks.find((w: { url?: string }) => w.url === WEBHOOK_URL)
    : null;

  // Step 3: if there's an existing webhook, try to GET its full detail (may include signing_secret)
  let existingDetail: unknown = null;
  if (existing?.webhook_id) {
    const detailRes = await fetch(`${apiBase}/v1/convai/webhooks/${existing.webhook_id}`, { headers: h });
    existingDetail = await detailRes.json().catch(() => null);
  }

  // Step 4: try to CREATE a new webhook — response includes signing_secret if API is available
  const createRes = await fetch(`${apiBase}/v1/convai/webhooks`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ url: WEBHOOK_URL }),
  });
  const createStatus = createRes.status;
  const createData = await createRes.json().catch(() => null);

  const newWebhookId: string | null = (createData as { webhook_id?: string })?.webhook_id ?? null;
  const signingSecret: string | null =
    (existingDetail as { signing_secret?: string })?.signing_secret ??
    (createData as { signing_secret?: string })?.signing_secret ??
    null;

  // Step 5: wire agent to new webhook_id if created
  let agentUpdate: unknown = null;
  if (newWebhookId && agentId) {
    const patchRes = await fetch(`${apiBase}/v1/convai/agents/${agentId}`, {
      method: "PATCH",
      headers: h,
      body: JSON.stringify({
        platform_settings: {
          workspace_overrides: {
            webhooks: {
              events: ["transcript"],
              transcript_format: "json",
              exclude_transcript: false,
              send_audio: false,
              post_call_webhook_id: newWebhookId,
            },
          },
        },
      }),
    });
    agentUpdate = await patchRes.json().catch(() => null);
  }

  return Response.json({
    list: { status: listStatus, data: listData },
    existing,
    existingDetail,
    create: { status: createStatus, data: createData },
    newWebhookId,
    signingSecret,
    agentUpdate,
    action: signingSecret
      ? `Set ELEVENLABS_WEBHOOK_SECRET=${signingSecret} in Vercel`
      : "Webhook API not available — check ElevenLabs dashboard for signing_secret",
  });
}
