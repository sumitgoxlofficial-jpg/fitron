import { ANDROID_LATEST_RELEASE_API, androidApk, TRAINER_HREF } from "@/lib/domain/site-links";
import { log } from "@/lib/log";

// fitron.in/download/android: downloads the newest FITRON AI Coach Android app (.apk) straight to the phone, so the address
// can be shared and keeps working when a new build is released. The latest release is asked of GitHub at most every 10
// minutes. The app's repository is private, so ANDROID_APK_GITHUB_TOKEN (a token that can read it) lets fitron.in fetch a
// short-lived download address for the file; without a token the file's public address is used, which works once the
// repository is public. If neither works, the visitor gets the AI Trainer in the browser instead of an error.
export const dynamic = "force-dynamic";

export async function GET() {
  const token = process.env.ANDROID_APK_GITHUB_TOKEN?.trim();
  const headers: Record<string, string> = { "user-agent": "fitron.in", ...(token ? { authorization: `Bearer ${token}` } : {}) };
  let to = TRAINER_HREF;
  try {
    const res = await fetch(ANDROID_LATEST_RELEASE_API, {
      headers: { ...headers, accept: "application/vnd.github+json" },
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const apk = androidApk(await res.json());
    if (!apk) throw new Error("the latest release has no .apk");
    to = token ? await signedDownload(apk.api, headers) : apk.download;
  } catch (e) {
    log.warn("android_download.latest_release", e);
  }
  return new Response(null, { status: 302, headers: { location: to, "cache-control": "no-store" } });
}

// A private repository's file: GitHub answers the API address with a redirect to a download address that works without
// the token for a few minutes, so the visitor is sent there and the token never leaves the server.
async function signedDownload(api: string, headers: Record<string, string>): Promise<string> {
  const res = await fetch(api, {
    headers: { ...headers, accept: "application/octet-stream" },
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  await res.body?.cancel();
  const location = res.headers.get("location");
  if (res.status < 300 || res.status >= 400 || !location?.startsWith("https://")) throw new Error(`GitHub answered ${res.status} for the .apk`);
  return location;
}
