import { describe, expect, it } from "vitest";
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

  it.each(["/dashboard", "/members", "/members/abc", "/settings/billing", "/invoices/new"])("guards %s", (path) => expect(guarded(path)).toBe(true));
});
