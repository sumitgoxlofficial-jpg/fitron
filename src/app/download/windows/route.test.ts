import { afterEach, describe, expect, it, vi } from "vitest";
import { WINDOWS_APP_HREF } from "@/lib/domain/site-links";
import { isGuardedPath, isPublicPath } from "@/lib/public-paths";
import { GET } from "./route";

const INSTALLER = "https://github.com/sumit4411suman/fitron-windows-app/releases/download/v0.1.2/FITRON-Gym-Accounting-Setup-0.1.2.exe";

afterEach(() => vi.unstubAllGlobals());

describe("fitron.in/download/windows", () => {
  it("is open to visitors who are not signed in", () => {
    expect(isPublicPath("/download/windows")).toBe(true);
    expect(isGuardedPath("/download/windows")).toBe(false);
  });

  it("downloads the latest release's installer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ assets: [{ name: "FITRON-Gym-Accounting-Setup-0.1.2.exe", browser_download_url: INSTALLER }] })));
    const r = await GET();
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe(INSTALLER);
  });

  it("opens the release page when GitHub does not answer, or there is no installer yet", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 403 })));
    expect((await GET()).headers.get("location")).toBe(WINDOWS_APP_HREF);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    expect((await GET()).headers.get("location")).toBe(WINDOWS_APP_HREF);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ assets: [] })));
    expect((await GET()).headers.get("location")).toBe(WINDOWS_APP_HREF);
  });
});
