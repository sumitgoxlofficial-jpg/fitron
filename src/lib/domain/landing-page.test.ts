import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { NAV } from "@/lib/nav";
import { PLANS } from "./pricing";
import { COACH_DAILY_LIMIT } from "./trainer";
import { PRIORITY_SUPPORT_PLANS } from "./features";

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
    expect((/tally/i).test(html), "html must not match " + String(/tally/i)).toBe(false);
    expect(text.includes("Excel or CSV files for your accountant"), "Excel or CSV files for your accountant").toBe(true);
  });

  it("counts the gym modules the way the sidebar does", () => {
    const sections = NAV.flatMap((g) => g.items).length;
    expect((new RegExp(`\\b${sections} Gym modules`)).test(text), "text should match " + String(new RegExp(`\\b${sections} Gym modules`))).toBe(true);
    // Every place the page counts them says the same number (the product card and the partner perks said 22 once).
    const counts = [...text.matchAll(/\b(\d+) (?:Gym )?modules\b/gi)].map((m) => Number(m[1]));
    expect(counts.length).toBeGreaterThanOrEqual(3);
    expect(counts.filter((n) => n !== sections)).toEqual([]);
  });
});

describe("AI Pro and AI Premium on the home page", () => {
  const card = (name: string) => {
    const i = html.indexOf(`<h3>${name}</h3>`);
    return html.slice(i, html.indexOf("</article>", i));
  };
  const bullets = (name: string) => [...card(name).matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, ""));
  const pro = COACH_DAILY_LIMIT["ai-pro"];
  const premium = COACH_DAILY_LIMIT["ai-premium"];

  it("states each tier's daily AI Coach limit, the numbers the server enforces", () => {
    expect(bullets("AI Pro")).toContain(`AI Coach: ${pro} messages a day`);
    expect((/monthly usage limits/).test(text), "text must not match " + String(/monthly usage limits/)).toBe(false);
  });

  it("lists as Premium-only just what the app really gives Premium and not Pro: the higher coach limit", () => {
    // Every other feature (workouts, food plan, habits, progress, reminders, weekly review) is the same on both
    // tiers in the app. When a feature is built that only Premium has, add it here and to the card.
    expect(bullets("AI Premium")).toEqual(["Everything in AI Pro, plus", `AI Coach: ${premium} messages a day`]);
    expect(premium).toBeGreaterThan(pro);
  });

  it("uses the same one-line description as src/lib/domain/pricing.ts", () => {
    for (const [name, key] of [["AI Pro", "ai-pro"], ["AI Premium", "ai-premium"]] as const) {
      const who = card(name).match(/class="pc-who">(.*?)<\/p>/)?.[1];
      expect(who, name).toBe(PLANS.find((p) => p.key === key)!.tagline);
    }
  });

  it("matches the limit the AI Trainer app shows its members", () => {
    const app = readFileSync(path.join(root, "public/trainer/index.html"), "utf8");
    expect(app.includes(`st.tier === 'ai-premium' ? ${premium} : ${pro}`), `st.tier === 'ai-premium' ? ${premium} : ${pro}`).toBe(true);
  });
});

describe("exports and support promised on the plan cards", () => {
  it("does not promise PDF financial exports: only invoices come out as PDF (reports and ledgers are Excel and CSV)", () => {
    expect(text.includes("PDF financial"), "PDF financial").toBe(false);
    expect(text.includes("Excel and CSV accounting exports"), "Excel and CSV accounting exports").toBe(true);
    expect(PLANS.find((p) => p.key === "professional")!.card!.features).toContain("Excel and CSV accounting exports");
  });

  it("promises priority support exactly on the plans whose tickets are marked priority", () => {
    const cards = [...html.matchAll(/<article class="pc[ "][\s\S]*?<\/article>/g)].map((m) => m[0]);
    const withPriority = cards.filter((c) => /<li[^>]*>(?:<svg[\s\S]*?<\/svg>)?<span>Priority [a-z ]*support<\/span>/.test(c)).map((c) => c.match(/<h3>(.*?)<\/h3>/)![1]!.trim());
    const keys = PLANS.filter((p) => withPriority.includes(p.name)).map((p) => p.key);
    expect(withPriority.length).toBeGreaterThan(0);
    expect(keys.sort()).toEqual([...PRIORITY_SUPPORT_PLANS].sort());
  });
});

describe("home page files", () => {
  it("every local image, script and font it uses exists", () => {
    const refs = [...html.matchAll(/(?:src|href)="(\/[^"#?]+\.(?:png|webp|jpg|svg|js|woff2|ico))/g)].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThan(5);
    for (const r of new Set(refs)) expect(existsSync(path.join(root, "public", r)), r).toBe(true);
  });

  it("serves the product screenshots as WebP, with real alt text on the AI Trainer one", () => {
    expect(html.includes("/site/app-dashboard.webp"), "/site/app-dashboard.webp").toBe(true);
    expect(html.includes("/site/console-dashboard.webp"), "/site/console-dashboard.webp").toBe(true);
    expect((/(app|console)-dashboard\.png/).test(html), "html must not match " + String(/(app|console)-dashboard\.png/)).toBe(false);
    const alt = html.match(/<img data-gallery-img="" src="[^"]+" alt="([^"]*)"/)?.[1] ?? "";
    expect(alt.length).toBeGreaterThan(30);
  });

  it("downloads the 3D logo library only for visitors who haven't asked for less motion or data, and only when idle", () => {
    expect([...html.matchAll(/import\('\/site\/fitron-3d\.js'\)/g)]).toHaveLength(1);
    for (const needle of ["prefers-reduced-motion", "saveData", "requestIdleCallback", "const load3d"]) expect(html.includes(needle), needle).toBe(true);
  });

  it("keeps the cookie banner and the WhatsApp button off the open phone menu", () => {
    expect((/body\.menu-open \.consent,body\.menu-open \.wa-float\{[^}]*pointer-events:none/).test(html), "html should match " + String(/body\.menu-open \.consent,body\.menu-open \.wa-float\{[^}]*pointer-events:none/)).toBe(true);
  });

  it("lays the hero out in one column on phones (the design's own rule was overridden, so the text ran off the screen)", () => {
    expect(html.includes("@media (max-width:900px){body .hero{grid-template-columns:minmax(0,1fr)}"), "@media (max-width:900px){body .hero{grid-template-columns:minmax(0,1fr)}").toBe(true);
    expect(html.includes("body .hero-copy{min-width:0}"), "body .hero-copy{min-width:0}").toBe(true);
    expect(html.includes("body .float-card.fc-1{left:0}body .float-card.fc-2{right:0}"), "body .float-card.fc-1{left:0}body .float-card.fc-2{right:0}").toBe(true);
  });

  it("moves keyboard focus into the phone menu, makes the page behind it inert, and gives focus back when it closes", () => {
    for (const needle of ["fitron:menu-a11y", "document.querySelectorAll('main, footer, .wa-float')", "setAttribute('inert', '')", "menu.querySelector('a')", "btn.focus("]) expect(html.includes(needle), needle).toBe(true);
  });

  it("puts the floating WhatsApp link inside a landmark", () => {
    const wrapped = '<aside aria-label="Quick contact"><a class="wa-float"';
    expect(html.includes(wrapped), wrapped).toBe(true);
    expect([...html.matchAll(/class="wa-float"/g)]).toHaveLength(1);
  });

  it("keeps the pricing tab bar inside the screen on phones", () => {
    const rule = "body .seg.p-tabs label>span{font-size:clamp(";
    expect(html.includes(rule), rule).toBe(true);
    expect(html.includes("body .seg.p-tabs{max-width:100%}"), "tab bar max-width").toBe(true);
  });

  it("links to the company details on the Contact page", () => {
    expect(html.includes('href="/contact#company"'), 'href="/contact#company"').toBe(true);
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
    for (const q of asked) expect(text.includes(q.acceptedAnswer.text.slice(0, 60)), q.name).toBe(true);
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
