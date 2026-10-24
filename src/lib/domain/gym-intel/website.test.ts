import { describe, expect, it } from "vitest";
import { contactLinks, extractFromHtml, robotsAllows } from "./website";

describe("robots.txt", () => {
  const robots = `User-agent: *\nDisallow: /admin\nAllow: /admin/public\nDisallow: /private/\n\nUser-agent: BadBot\nDisallow: /\n`;
  it("follows the rules for everyone, longest rule wins", () => {
    expect(robotsAllows(robots, "/contact")).toBe(true);
    expect(robotsAllows(robots, "/admin/x")).toBe(false);
    expect(robotsAllows(robots, "/admin/public/x")).toBe(true);
    expect(robotsAllows(robots, "/private/a")).toBe(false);
  });
  it("allows everything with no file, and honours a rule naming us", () => {
    expect(robotsAllows(null, "/x")).toBe(true);
    expect(robotsAllows("User-agent: FitronContactBot\nDisallow: /\n", "/contact")).toBe(false);
    expect(robotsAllows("User-agent: *\nDisallow: /\n", "/")).toBe(false);
  });
});

describe("a gym's page", () => {
  const html = `<html><head><title> Iron Paradise – Ranchi </title><script type="application/ld+json">{"@type":"HealthClub","telephone":"+91 98765 43210"}</script></head>
  <body><a href="tel:+916512345678">Call</a><p>Open 5am–10pm. Order no 123456.</p><script>var x="9999999999"</script><a href="/contact-us">Contact</a><a href="https://other.example/contact">x</a></body></html>`;
  it("finds the numbers it publishes and ignores script contents and other numbers", () => {
    const r = extractFromHtml(html);
    expect(r.title).toBe("Iron Paradise – Ranchi");
    expect(r.phones.map((p) => p.e164).sort()).toEqual(["+916512345678", "+919876543210"]);
  });
  it("offers only same-site contact pages", () => {
    expect(contactLinks(html, "https://ironparadise.example/")).toEqual(["https://ironparadise.example/contact-us"]);
  });
});
