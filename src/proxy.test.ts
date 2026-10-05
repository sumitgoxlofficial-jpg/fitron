import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GYM_PAGES } from "@/lib/domain/gym-pages";
import { config } from "./proxy";

// The proxy runs on every path the matcher matches and sends visitors without a session to /login,
// so a public page missing from the matcher's exclusions silently turns into the console's sign-in.
const matcher = new RegExp(`^${config.matcher[0]}$`);
const guarded = (path: string) => matcher.test(path);

describe("proxy matcher", () => {
  it.each(["/signin", "/login", "/signup", "/trainer", "/contact", "/privacy", "/terms", "/refund", "/verify-email", "/forgot-password", "/auth/google/callback", "/api/health"])(
    "leaves %s public",
    (path) => expect(guarded(path)).toBe(false),
  );

  it.each(GYM_PAGES.map((p) => p.path))("leaves the public page %s open to visitors who are not signed in", (path) => expect(guarded(path)).toBe(false));

  it("leaves every page of the public website open: each folder of src/app/(site) that has a page", () => {
    const site = path.join(__dirname, "app/(site)");
    const pages = readdirSync(site, { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(path.join(site, e.name, "page.tsx"))).map((e) => `/${e.name}`);
    expect(pages.length).toBeGreaterThan(8);
    expect(pages.filter(guarded)).toEqual([]);
  });

  it.each(["/dashboard", "/members", "/members/abc", "/settings/billing", "/invoices/new"])("guards %s", (path) => expect(guarded(path)).toBe(true));
});
