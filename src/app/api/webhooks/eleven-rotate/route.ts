// Temporary: reads the signing_secret for the existing ElevenLabs ConvAI post-call webhook.
// Authenticated via ?secret=<WEBHOOK_SETUP_KEY>. DELETE THIS FILE once ELEVENLABS_WEBHOOK_SECRET is confirmed.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const WEBHOOK_ID = "653e8bf91a264df2b940617941b8186b";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const setupKey = process.env.WEBHOOK_SETUP_KEY ?? process.env.CRON_SECRET;
  if (!setupKey || url.searchParams.get("secret") !== setupKey) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const apiBase = process.env.ELEVENLABS_API_BASE ?? "https://api.elevenlabs.io";
  if (!apiKey) return Response.json({ error: "ELEVENLABS_API_KEY not set" }, { status: 500 });

  const h = { "xi-api-key": apiKey, "Content-Type": "application/json" };

  // Read-only: GET the existing webhook detail — signing_secret is returned if the API exposes it
  const detailRes = await fetch(`${apiBase}/v1/convai/webhooks/${WEBHOOK_ID}`, { headers: h });
  const detailStatus = detailRes.status;
  const detailData = await detailRes.json().catch(() => null);

  const signingSecret: string | null = (detailData as { signing_secret?: string })?.signing_secret ?? null;

  return Response.json({
    webhook_id: WEBHOOK_ID,
    status: detailStatus,
    detail: detailData,
    signingSecret,
    action: signingSecret
      ? `Set ELEVENLABS_WEBHOOK_SECRET=${signingSecret} in Vercel`
      : "signing_secret not in API response — get it from the ElevenLabs dashboard under ConvAI > Webhooks",
  });
}
