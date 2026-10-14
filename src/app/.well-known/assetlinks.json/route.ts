// Digital Asset Links for the FITRON AI Coach Android app (package in.fitron.trainer): it tells Chrome the app belongs to
// fitron.in, so the app opens the AI Trainer full screen and the AI Trainer's links open in it. ANDROID_CERT_SHA256 holds the
// SHA-256 fingerprints of the keys that sign the app, comma-separated (the upload key and, on Google Play, Play's signing
// key). Without it the list is empty and the app still works, with an address bar.
export const dynamic = "force-dynamic";

const ANDROID_PACKAGE = "in.fitron.trainer";
const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

export function GET() {
  const fingerprints = (process.env.ANDROID_CERT_SHA256 ?? "")
    .split(",")
    .map((f) => f.trim().toUpperCase())
    .filter((f) => FINGERPRINT.test(f));
  const statements = fingerprints.length
    ? [
        {
          relation: ["delegate_permission/common.handle_all_urls"],
          target: { namespace: "android_app", package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: fingerprints },
        },
      ]
    : [];
  return Response.json(statements, { headers: { "cache-control": "public, max-age=3600" } });
}
