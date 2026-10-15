import { afterEach, describe, expect, it, vi } from "vitest";
import { TRAINER_HREF } from "@/lib/domain/site-links";
import { isGuardedPath, isPublicPath } from "@/lib/public-paths";
import { GET } from "./route";

const PUBLIC_APK = "https://github.com/sumit4411suman/fitron-ai-coach-apk/releases/download/build-72/Fitron-AI-Coach.apk";
const API_APK = "https://api.github.com/repos/sumit4411suman/fitron-ai-coach-apk/releases/assets/643306897";
const SIGNED = "https://release-assets.githubusercontent.com/github-production-release-asset/1/abc?sig=x";
const RELEASE = { assets: [{ name: "Fitron-AI-Coach.apk", browser_download_url: PUBLIC_APK, url: API_APK }] };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("fitron.in/download/android", () => {
  it("is open to visitors who are not signed in", () => {
    expect(isPublicPath("/download/android")).toBe(true);
    expect(isGuardedPath("/download/android")).toBe(false);
  });

  it("downloads the latest release's .apk from its public address when there is no token", async () => {
    vi.stubEnv("ANDROID_APK_GITHUB_TOKEN", "");
    const fetch = vi.fn(async () => Response.json(RELEASE));
    vi.stubGlobal("fetch", fetch);
    const r = await GET();
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe(PUBLIC_APK);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("with a token, sends the visitor to GitHub's short-lived download address and keeps the token on the server", async () => {
    vi.stubEnv("ANDROID_APK_GITHUB_TOKEN", "ghp_secret");
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer ghp_secret");
      if (url === API_APK) return new Response(null, { status: 302, headers: { location: SIGNED } });
      return Response.json(RELEASE);
    });
    vi.stubGlobal("fetch", fetch);
    const r = await GET();
    expect(r.headers.get("location")).toBe(SIGNED);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("opens the AI Trainer in the browser when GitHub does not answer, or there is no .apk", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("ANDROID_APK_GITHUB_TOKEN", "");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Not Found", { status: 404 })));
    expect((await GET()).headers.get("location")).toBe(TRAINER_HREF);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    expect((await GET()).headers.get("location")).toBe(TRAINER_HREF);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ assets: [{ name: "notes.txt", browser_download_url: PUBLIC_APK, url: API_APK }] })));
    expect((await GET()).headers.get("location")).toBe(TRAINER_HREF);
    vi.stubEnv("ANDROID_APK_GITHUB_TOKEN", "ghp_expired");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url === API_APK ? new Response("Bad credentials", { status: 401 }) : Response.json(RELEASE))));
    expect((await GET()).headers.get("location")).toBe(TRAINER_HREF);
  });
});
