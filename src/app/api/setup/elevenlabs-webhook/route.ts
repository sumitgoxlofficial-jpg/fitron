// One-time setup route: configures the ElevenLabs ConvAI post-call webhook.
// Caller must pass ?secret=<CRON_SECRET> to authenticate.
// DELETE THIS FILE after the webhook is confirmed working.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || url.searchParams.get("secret") !== cronSecret) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const apiBase = process.env.ELEVENLABS_API_BASE ?? "https://api.elevenlabs.io";
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  const webhookUrl = "https://fitron.in/api/webhooks/calling/events";

  if (!apiKey) return Response.json({ error: "ELEVENLABS_API_KEY not set" }, { status: 500 });

  const headers = { "xi-api-key": apiKey, "Content-Type": "application/json" };

  // Step 1: get current workspace ConvAI settings to see if a webhook already exists
  const settingsRes = await fetch(`${apiBase}/v1/convai/settings`, { headers });
  const settings = await settingsRes.json().catch(() => null);

  // Step 2: try to create/register the webhook via the ConvAI webhooks endpoint
  const createRes = await fetch(`${apiBase}/v1/convai/webhooks`, {
    method: "POST",
    headers,
    body: JSON.stringify({ url: webhookUrl }),
  });
  const createData = await createRes.json().catch(() => null);

  // Step 3: if webhook was created, update the agent to reference it
  let agentUpdateResult = null;
  if (createRes.ok && createData?.webhook_id && agentId) {
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
              post_call_webhook_id: createData.webhook_id,
            },
          },
        },
      }),
    });
    agentUpdateResult = await agentRes.json().catch(() => null);
  }

  // Step 4: also try PATCH /v1/convai/settings directly (alternative approach)
  const patchSettingsRes = await fetch(`${apiBase}/v1/convai/settings`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ post_call_webhook_url: webhookUrl }),
  });
  const patchSettingsData = await patchSettingsRes.json().catch(() => null);

  return Response.json({
    settings: { status: settingsRes.status, data: settings },
    createWebhook: { status: createRes.status, data: createData },
    agentUpdate: agentUpdateResult,
    patchSettings: { status: patchSettingsRes.status, data: patchSettingsData },
  });
}
