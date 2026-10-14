import { WINDOWS_APP_HREF, WINDOWS_LATEST_RELEASE_API, windowsInstallerUrl } from "@/lib/domain/site-links";
import { log } from "@/lib/log";

// fitron.in/download/windows: downloads the newest FITRON for Windows installer straight away, so the address can be shared
// and keeps working when a new version is released. The latest release is asked of GitHub at most every 10 minutes; if
// GitHub does not answer, or the release has no installer yet, the visitor gets the release page instead.
export async function GET() {
  let to = WINDOWS_APP_HREF;
  try {
    const res = await fetch(WINDOWS_LATEST_RELEASE_API, {
      headers: { accept: "application/vnd.github+json", "user-agent": "fitron.in" },
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    to = windowsInstallerUrl(await res.json()) ?? WINDOWS_APP_HREF;
  } catch (e) {
    log.warn("windows_download.latest_release", e);
  }
  return new Response(null, { status: 302, headers: { location: to, "cache-control": "no-store" } });
}
