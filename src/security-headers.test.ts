import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

const root = path.join(__dirname, "..");
const all = async () => {
  const rules = await nextConfig.headers!();
  return Object.fromEntries(rules.find((r) => r.source === "/:path*")!.headers.map((h) => [h.key, h.value]));
};

describe("headers sent with every page", () => {
  it("keeps the device camera available to our own pages: the attendance QR scanner needs it", async () => {
    const policy = (await all())["Permissions-Policy"]!;
    expect(policy.split(",").map((s) => s.trim())).toContain("camera=(self)");
    // The scanner really does ask for the camera; if it stops, this reminder can go.
    expect(readFileSync(path.join(root, "src/app/(app)/attendance/attendance-forms.tsx"), "utf8").includes("getUserMedia")).toBe(true);
  });

  it("still denies the microphone and location to every page, and framing by other sites", async () => {
    const h = await all();
    const policy = h["Permissions-Policy"]!;
    for (const p of ["microphone=()", "geolocation=()"]) expect(policy.includes(p), p).toBe(true);
    expect(h["X-Frame-Options"]).toBe("DENY");
  });
});
