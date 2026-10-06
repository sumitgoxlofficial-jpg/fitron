import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GOOGLE_FLOW_COOKIE } from "@/lib/integrations/google";
import { GET } from "./route";

// Google returns to APP_URL only, and the flow cookie belongs to the host that set it, so the flow has to start there.
beforeEach(() => {
  vi.stubEnv("APP_URL", "https://fitron.in");
  vi.stubEnv("GOOGLE_CLIENT_ID", "id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
  vi.stubEnv("AUTH_SECRET", "test-secret");
});
afterEach(() => vi.unstubAllEnvs());

describe("/auth/google", () => {
  it("moves a sign-in started on another address of the app to APP_URL, keeping the query", () => {
    const res = GET(new NextRequest("https://www.fitron.in/auth/google?for=trainer&next=/trainer"));
    expect(res.headers.get("location")).toBe("https://fitron.in/auth/google?for=trainer&next=/trainer");
    expect(res.cookies.get(GOOGLE_FLOW_COOKIE)).toBeUndefined();
  });

  it("goes to Google with the flow cookie when started on APP_URL", () => {
    const res = GET(new NextRequest("https://fitron.in/auth/google?for=staff"));
    const to = new URL(res.headers.get("location")!);
    expect(to.origin).toBe("https://accounts.google.com");
    expect(to.searchParams.get("redirect_uri")).toBe("https://fitron.in/auth/google/callback");
    expect(res.cookies.get(GOOGLE_FLOW_COOKIE)?.value).toBeTruthy();
  });
});
