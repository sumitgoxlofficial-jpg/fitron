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

  // Step 2: register the webhook — ElevenLabs returns a webhook_id and signing_secret
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
    note: "If createWebhook succeeded and returned a signing_secret, update ELEVENLABS_WEBHOOK_SECRET in Vercel with that value.",
  });
}
