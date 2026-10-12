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
