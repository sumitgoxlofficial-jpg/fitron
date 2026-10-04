import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { NAV } from "@/lib/nav";
import { PLANS } from "./pricing";

const root = path.join(__dirname, "../../..");
const html = readFileSync(path.join(root, "public/site/index.html"), "utf8");
/** The page's visible words: scripts and styles removed, tags stripped, entities decoded for the few we use. */
const text = html
  .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/\s+/g, " ");

describe("what the home page promises matches the product", () => {
  it("does not promise a Tally file: Gym Accounting exports Excel and CSV", () => {
    expect(html).not.toMatch(/tally/i);
    expect(text).toContain("Excel or CSV files for your accountant");
  });

  it("counts the gym modules the way the sidebar does", () => {
    const sections = NAV.flatMap((g) => g.items).length;
    expect(text).toMatch(new RegExp(`\\b${sections} Gym modules`));
  });
});

describe("home page files", () => {
  it("every local image, script and font it uses exists", () => {
    const refs = [...html.matchAll(/(?:src|href)="(\/[^"#?]+\.(?:png|webp|jpg|svg|js|woff2|ico))/g)].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThan(5);
    for (const r of new Set(refs)) expect(existsSync(path.join(root, "public", r)), r).toBe(true);
  });

  it("serves the product screenshots as WebP, with real alt text on the AI Trainer one", () => {
    expect(html).toContain("/site/app-dashboard.webp");
    expect(html).toContain("/site/console-dashboard.webp");
    expect(html).not.toMatch(/(app|console)-dashboard\.png/);
    const alt = html.match(/<img data-gallery-img="" src="[^"]+" alt="([^"]*)"/)?.[1] ?? "";
    expect(alt.length).toBeGreaterThan(30);
  });

  it("downloads the 3D logo library only for visitors who haven't asked for less motion or data, and only when idle", () => {
    expect([...html.matchAll(/import\('\/site\/fitron-3d\.js'\)/g)]).toHaveLength(1);
    for (const needle of ["prefers-reduced-motion", "saveData", "requestIdleCallback", "const load3d"]) expect(html, needle).toContain(needle);
  });

  it("keeps the cookie banner and the WhatsApp button off the open phone menu", () => {
    expect(html).toMatch(/body\.menu-open \.consent,body\.menu-open \.wa-float\{[^}]*pointer-events:none/);
  });

  it("lays the hero out in one column on phones (the design's own rule was overridden, so the text ran off the screen)", () => {
    expect(html).toContain("@media (max-width:900px){body .hero{grid-template-columns:minmax(0,1fr)}");
    expect(html).toContain("body .hero-copy{min-width:0}");
    expect(html).toContain("body .float-card.fc-1{left:0}body .float-card.fc-2{right:0}");
  });

  it("links to the company details on the Contact page", () => {
    expect(html).toContain('href="/contact#company"');
  });
});

describe("home page structured data", () => {
  const raw = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? "";
  const graph = (JSON.parse(raw || "{}")["@graph"] ?? []) as { "@type": string; name?: string; offers?: { name: string; price: number; priceCurrency: string }[]; mainEntity?: { name: string; acceptedAnswer: { text: string } }[] }[];
  const ofType = (t: string) => graph.filter((g) => g["@type"] === t);

  it("describes the organisation, both products and the FAQ", () => {
    expect(ofType("Organization")).toHaveLength(1);
    expect(ofType("SoftwareApplication").map((a) => a.name)).toEqual(["FITRON AI Trainer", "FITRON Gym Accounting"]);
    expect(ofType("FAQPage")).toHaveLength(1);
  });

  it("lists every plan at its real monthly price in rupees before GST", () => {
    const offers = ofType("SoftwareApplication").flatMap((a) => a.offers ?? []);
    const plans = PLANS.filter((p) => p.product !== "PARTNER");
    expect(offers.map((o) => o.name)).toEqual(plans.map((p) => p.name));
    for (const p of plans) expect(offers.find((o) => o.name === p.name), p.name).toMatchObject({ price: p.price.MONTHLY / 100, priceCurrency: "INR" });
  });

  it("repeats exactly the questions and answers a visitor can read in the FAQ", () => {
    const shown = [...html.matchAll(/<details><summary>(.*?)<\/summary>/g)].map((m) => m[1]!.replace(/&amp;/g, "&"));
    const asked = ofType("FAQPage")[0]!.mainEntity!;
    expect(asked.map((q) => q.name)).toEqual(shown);
    expect(shown).toHaveLength(8);
    for (const q of asked) expect(text, q.name).toContain(q.acceptedAnswer.text.slice(0, 60));
  });
});

describe("what search engines are told", () => {
  it("lists only pages that stay put, and does not allow the sign-up redirect", () => {
    const urls = sitemap().map((s) => s.url);
    expect(urls).toContain("https://fitron.in/");
    expect(urls.some((u) => /signup|signin|login/.test(u))).toBe(false);
    const rules = robots().rules;
    const rule = (Array.isArray(rules) ? rules[0] : rules) as { allow: string[]; disallow: string[] };
    expect(rule.allow).not.toContain("/signup");
    for (const p of ["/login", "/signin", "/signup"]) expect(rule.disallow, p).toContain(p);
  });

  it("has no hand-typed last-modified date", () => {
    expect(sitemap().every((s) => s.lastModified === undefined)).toBe(true);
  });
});

// scripts/import-site.py rebuilds the page and applies scripts/site_patches.py last, so the committed page must be
// what the patches produce: if someone edits the page by hand, or a patch changes, this fails until they agree.
const python = spawnSync("python3", ["--version"]).status === 0;
describe.skipIf(!python)("scripts/site_patches.py", () => {
  it("leaves the committed home page unchanged", () => {
    const copy = path.join(mkdtempSync(path.join(tmpdir(), "fitron-site-")), "index.html");
    copyFileSync(path.join(root, "public/site/index.html"), copy);
    const r = spawnSync("python3", [path.join(root, "scripts/site_patches.py"), copy], { encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("Already up to date");
  });
});
