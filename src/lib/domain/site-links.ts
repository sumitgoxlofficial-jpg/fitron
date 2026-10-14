// Where each part of FITRON sends a visitor, so the landing page, the gym console's sign-in and the
// AI Trainer open each other's pages from one place.

/** The AI Trainer member app (public/trainer). It has its own sign-in and plan choice inside. */
export const TRAINER_HREF = "/trainer";

/** The gym console's sign-in page. */
export const GYM_SIGNIN_HREF = "/login";

/**
 * The gym console's "Create account" tab, with the plan picked on fitron.in. `google` is a code or "1"
 * for a visitor coming back from Google (see googleMessage and the sign-up form).
 */
export function gymSignupHref(o: { plan?: string | null; cycle?: string | null; google?: string | null } = {}): string {
  const q = new URLSearchParams({ tab: "up" });
  if (o.plan) q.set("plan", o.plan);
  if (o.cycle) q.set("cycle", o.cycle);
  if (o.google) q.set("google", o.google);
  return `${GYM_SIGNIN_HREF}?${q}`;
}

/** The AI Trainer's sign-in and sign-up, with the tier picked on fitron.in remembered by the app. */
export function trainerHref(plan?: string | null): string {
  return plan ? `${TRAINER_HREF}?${new URLSearchParams({ plan })}` : TRAINER_HREF;
}

/**
 * FITRON Windows, the optional desktop app for gyms (built in its own repository): the latest release, where the installer
 * is. The home page's "Download for Windows" button opens it (WINDOWS_APP_URL in scripts/site_patches.py, kept equal to
 * this by landing-page.test.ts).
 */
export const WINDOWS_APP_HREF = "https://github.com/sumit4411suman/fitron-windows-app/releases/latest";

/**
 * The GitHub API's answer for the Windows app's latest published release, where the installer is one of the files.
 * fitron.in/download/windows (src/app/download/windows/route.ts) asks it which file to download.
 */
export const WINDOWS_LATEST_RELEASE_API = "https://api.github.com/repos/sumit4411suman/fitron-windows-app/releases/latest";

type ReleaseAsset = { name?: unknown; browser_download_url?: unknown };

/**
 * The installer's download address in a release (the GitHub API's answer), or null when it has none: the .exe file,
 * the one named "Setup" if there are several (FITRON-Gym-Accounting-Setup-0.1.2.exe).
 */
export function windowsInstallerUrl(release: unknown): string | null {
  const assets = (release as { assets?: unknown } | null)?.assets;
  if (!Array.isArray(assets)) return null;
  const exes = (assets as ReleaseAsset[]).filter(
    (a): a is { name: string; browser_download_url: string } =>
      typeof a?.name === "string" && /\.exe$/i.test(a.name) && typeof a.browser_download_url === "string" && a.browser_download_url.startsWith("https://github.com/"),
  );
  return (exes.find((a) => /setup/i.test(a.name)) ?? exes[0])?.browser_download_url ?? null;
}
