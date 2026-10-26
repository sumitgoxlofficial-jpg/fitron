// One-time setup route: registers the ElevenLabs ConvAI post-call webhook and updates Vercel env.
// Caller must pass ?secret=<WEBHOOK_SETUP_KEY> to authenticate.
// DELETE THIS FILE after the webhook is confirmed working.
// Lives under api/webhooks/ so the proxy middleware doesn't block it (same as other webhook routes).
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const setupKey = process.env.WEBHOOK_SETUP_KEY ?? process.env.CRON_SECRET;
  if (!setupKey || url.searchParams.get("secret") !== setupKey) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const apiBase = process.env.ELEVENLABS_API_BASE ?? "https://api.elevenlabs.io";
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  const webhookUrl = "https://fitron.in/api/webhooks/calling/events";

  if (!apiKey) return Response.json({ error: "ELEVENLABS_API_KEY not set" }, { status: 500 });

  const headers = { "xi-api-key": apiKey, "Content-Type": "application/json" };

  // Step 1: get current workspace ConvAI settings
  const settingsRes = await fetch(`${apiBase}/v1/convai/settings`, { headers });
  const settings = await settingsRes.json().catch(() => null);

  // Step 2: list existing webhooks
  const listRes = await fetch(`${apiBase}/v1/convai/webhooks`, { headers });
  const listData = await listRes.json().catch(() => null);

  // Step 3: find or create the webhook for our URL
  const existingWebhook = Array.isArray(listData?.webhooks)
    ? listData.webhooks.find((w: { url?: string }) => w.url === webhookUrl)
    : null;

  let webhookId: string | null = existingWebhook?.webhook_id ?? settings?.webhooks?.post_call_webhook_id ?? null;
  let webhookDetail: unknown = null;

  // Step 4: if we have a webhook_id, get its full details (including signing_secret if returned)
  if (webhookId) {
    const detailRes = await fetch(`${apiBase}/v1/convai/webhooks/${webhookId}`, { headers });
    webhookDetail = await detailRes.json().catch(() => null);
  }

  // Step 5: if no webhook exists for our URL, create one
  let createData: unknown = null;
  if (!existingWebhook) {
    const createRes = await fetch(`${apiBase}/v1/convai/webhooks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: webhookUrl }),
    });
    createData = await createRes.json().catch(() => null);
    if ((createData as { webhook_id?: string })?.webhook_id) {
      webhookId = (createData as { webhook_id: string }).webhook_id;
    }
  }

  // Step 6: ensure the agent is wired to this webhook_id
  let agentUpdateResult = null;
  if (webhookId && agentId) {
    const agentRes = await fetch(`${apiBase}/v1/convai/agents/${agentId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        platform_settings: {
          workspace_overrides: {
            webhooks: {
              events: ["transcript"],
              transcript_format: "json",
              exclude_transcript: false,
              send_audio: false,
              post_call_webhook_id: webhookId,
            },
          },
        },
      }),
    });
    agentUpdateResult = await agentRes.json().catch(() => null);
  }

  return Response.json({
    settings: { status: settingsRes.status, data: settings },
    listWebhooks: { status: listRes.status, data: listData },
    existingWebhook,
    webhookId,
    webhookDetail,
    createWebhook: createData,
    agentUpdate: agentUpdateResult,
    note: "Check webhookDetail.signing_secret — if present, set that as ELEVENLABS_WEBHOOK_SECRET in Vercel.",
  });
}
