import { NextResponse, type NextRequest } from "next/server";
import { GOOGLE_FLOWS, GOOGLE_FLOW_COOKIE, authUrl, googleBackUrl, googleReady, newPkce, sign, type GoogleFlow } from "@/lib/integrations/google";
import { appUrl } from "@/lib/services/accounts";
import { safeNext } from "@/lib/auth/next";

// Starts "Continue with Google". ?for=staff (console login), signup (new gym) or trainer (AI Trainer member).

export function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  // Google always comes back to APP_URL, and the flow cookie only goes back to the host that set it. Started from
  // another address of the same app (www., the *.vercel.app one), the callback found no cookie and every attempt
  // ended in "took too long". Start again on APP_URL's own host first.
  const home = new URL(appUrl());
  if (req.nextUrl.host !== home.host) return NextResponse.redirect(new URL(`/auth/google${req.nextUrl.search}`, home));
  const flow: GoogleFlow = (GOOGLE_FLOWS as readonly string[]).includes(q.get("for") ?? "") ? (q.get("for") as GoogleFlow) : "staff";
  const next = safeNext(q.get("next"), "");
  const plan = q.get("plan") ?? "";
  const cycle = q.get("cycle") ?? "";
  if (!googleReady()) return NextResponse.redirect(new URL(googleBackUrl(flow, "off", { plan, cycle }), appUrl()));

  const pkce = newPkce();
  const { verifier, challenge } = pkce;
  // The flow rides in the state too, so if the cookie has expired the callback still knows where to send them back.
  const state = `${flow}.${pkce.state}`;
  const res = NextResponse.redirect(authUrl({ redirectUri: `${appUrl()}/auth/google/callback`, state, challenge }));
  res.cookies.set(GOOGLE_FLOW_COOKIE, sign({ state, verifier, flow, next, plan, cycle }, 10 * 60_000), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/auth/google",
    maxAge: 600,
  });
  return res;
}
