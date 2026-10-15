import { ANDROID_LATEST_RELEASE_API, androidApk, TRAINER_HREF } from "@/lib/domain/site-links";
import { log } from "@/lib/log";

// fitron.in/download/android: downloads the newest FITRON AI Coach Android app (.apk) straight to the phone, so the address
// can be shared and keeps working when a new build is released. The app's repository is private, so
// ANDROID_APK_GITHUB_TOKEN (a token that can read it) lets fitron.in fetch a short-lived download address for the file;
// without a token the file's public address is used, which works once the repository is public. If neither works, the
// visitor gets the AI Trainer in the browser instead of an error.
// fitron.in/download/android?check says in plain words which step fails (never the token or the download address).
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const check = new URL(request.url).searchParams.has("check");
  const token = readToken();
  let to = TRAINER_HREF;
  let problem: string | null = null;
  try {
    to = await apkAddress(token);
  } catch (e) {
    problem = e instanceof Error ? e.message : String(e);
    log.warn("android_download.latest_release", e);
  }
  if (check) {
    const lines = [
      `Token (ANDROID_APK_GITHUB_TOKEN): ${token ? "set" : "not set on this deployment. Add it in Vercel for Production, then redeploy."}`,
      problem ? `Download: not working. ${problem}` : "Download: working. The button downloads the newest .apk.",
    ];
    return new Response(`${lines.join("\n")}\n`, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }
  return new Response(null, { status: 302, headers: { location: to, "cache-control": "no-store" } });
}

// The token as pasted into the host's settings, without the quotes or "Bearer " that sometimes come along with it.
function readToken(): string | undefined {
  const raw = (process.env.ANDROID_APK_GITHUB_TOKEN ?? "").trim().replace(/^["']|["']$/g, "").replace(/^Bearer\s+/i, "").trim();
  return raw || undefined;
}

async function apkAddress(token: string | undefined): Promise<string> {
  const headers: Record<string, string> = { "user-agent": "fitron.in", ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const res = await fetch(ANDROID_LATEST_RELEASE_API, {
    headers: { ...headers, accept: "application/vnd.github+json" },
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(releaseProblem(res.status, !!token));
  const apk = androidApk(await res.json());
  if (!apk) throw new Error("The latest release of fitron-ai-coach-apk has no .apk file.");
  return token ? signedDownload(apk.api, headers) : apk.download;
}

function releaseProblem(status: number, withToken: boolean): string {
  if (status === 401) return "GitHub did not accept the token (401): it is mistyped, expired or deleted. Make a new one.";
  if (status === 404)
    return withToken
      ? "GitHub answered 404: the token can't see sumit4411suman/fitron-ai-coach-apk. Give it that repository with Contents: Read-only (made by the sumit4411suman account)."
      : "GitHub answered 404: the repository is private and no token is set.";
  if (status === 403) return "GitHub answered 403: the token lacks Contents: Read-only, or GitHub's rate limit was reached (try again in an hour).";
  return `GitHub answered ${status} for the latest release.`;
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
  if (res.status < 300 || res.status >= 400 || !location?.startsWith("https://")) throw new Error(`GitHub answered ${res.status} for the .apk file.`);
  return location;
}
