import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const ANDROID_PACKAGE = "in.fitron.trainer";

const A = Array.from({ length: 32 }, () => "AB").join(":");
const B = Array.from({ length: 32 }, () => "0c").join(":");

describe("/.well-known/assetlinks.json", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("lists the app with each valid fingerprint", async () => {
    vi.stubEnv("ANDROID_CERT_SHA256", ` ${A}, ${B} ,not-a-fingerprint`);
    const body = await GET().json();
    expect(body).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: { namespace: "android_app", package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: [A, B.toUpperCase()] },
      },
    ]);
  });

  it("is an empty list without a fingerprint", async () => {
    vi.stubEnv("ANDROID_CERT_SHA256", "");
    expect(await GET().json()).toEqual([]);
  });
});
