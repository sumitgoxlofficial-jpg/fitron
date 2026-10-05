import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ErrorScreen } from "./error-screen";

const show = (error: Error & { digest?: string }, home = { href: "/dashboard", label: "Go to the dashboard" }) =>
  renderToStaticMarkup(createElement(ErrorScreen, { error, retry: () => {}, where: "app", home }));

describe("the error screen", () => {
  it("shows the reference to quote, a way to try again, a way out and a way to ask for help", () => {
    const html = show(Object.assign(new Error("hidden"), { digest: "ref-4821" }));
    for (const s of ["ref-4821", "Try again", 'href="/dashboard"', "Go to the dashboard", 'href="/contact?topic=support"', 'role="alert"']) expect(html, s).toContain(s);
  });

  it("never shows the error's own message, which can hold details of the data involved", () => {
    expect(show(Object.assign(new Error("duplicate key asha@example.com"), { digest: "d" }))).not.toContain("asha@example.com");
  });

  it("is still complete when the error has no digest (it came from the browser)", () => {
    const html = show(new Error("x"), { href: "/", label: "Back to fitron.in" });
    expect(html).not.toContain("Reference");
    expect(html).toContain("Back to fitron.in");
  });
});
