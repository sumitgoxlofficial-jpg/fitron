import { elevenLabsProvider } from "@/lib/services/ai-calling/provider";

// Temporary: one-shot outbound call for SIP trunk verification. Remove after testing.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("token") !== "fitron-sip-test-0x9a2f") return Response.json({ error: "Forbidden" }, { status: 403 });
  const to = searchParams.get("to") ?? "7320001062";
  const to10 = to.replace(/\D/g, "").slice(-10);
  try {
    const r = await elevenLabsProvider().dial({ to10, callId: `test-${Date.now()}`, callToken: "test", gymName: "FITRON", contactName: "Test" });
    return Response.json({ ok: true, ...r });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { token?: string; to?: string };
  if (body.token !== "fitron-sip-test-0x9a2f") return Response.json({ error: "Forbidden" }, { status: 403 });

  const to10 = (body.to ?? "7320001062").replace(/\D/g, "").slice(-10);
  try {
    const r = await elevenLabsProvider().dial({
      to10,
      callId: `test-${Date.now()}`,
      callToken: "test",
      gymName: "FITRON",
      contactName: "Test",
    });
    return Response.json({ ok: true, ...r });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
