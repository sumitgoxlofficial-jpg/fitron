import { expect, test } from "./support";

// What a visitor and a search engine get from the public site. The sitemap is the list of pages: every address in it
// has to open, say what it is, and point to itself as its one address.

const attr = (html: string, re: RegExp) => html.match(re)?.[1]?.replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"');

test.describe("search engines", () => {
  test("every address in the sitemap opens and describes itself", async ({ request }) => {
    const xml = await (await request.get("/sitemap.xml")).text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
    expect(locs.length).toBeGreaterThanOrEqual(8);
    expect(locs).toContain("https://fitron.in/gym-accounting");

    const titles = new Map<string, string>();
    for (const loc of locs) {
      const url = new URL(loc);
      expect(url.origin, "sitemap addresses are the real site's").toBe("https://fitron.in");
      const r = await request.get(url.pathname, { maxRedirects: 0 });
      expect(r.status(), loc).toBe(200);
      const html = await r.text();

      const title = attr(html, /<title[^>]*>([^<]*)<\/title>/);
      expect(title?.length, `${loc} has a title`).toBeGreaterThan(10);
      expect(title!.length, `${loc} has a title that fits a search result`).toBeLessThanOrEqual(70);
      expect(titles.get(title!), `${loc} shares its title with ${titles.get(title!)}`).toBeUndefined();
      titles.set(title!, loc);

      const description = attr(html, /<meta\s+name="description"\s+content="([^"]*)"/) ?? attr(html, /<meta\s+content="([^"]*)"\s+name="description"/);
      expect(description?.length, `${loc} has a description`).toBeGreaterThanOrEqual(50);
      expect(description!.length, `${loc} has a description that is not cut off`).toBeLessThanOrEqual(170);

      const canonical = attr(html, /<link[^>]+rel="canonical"[^>]+href="([^"]+)"/) ?? attr(html, /<link[^>]+href="([^"]+)"[^>]+rel="canonical"/);
      expect(canonical, `${loc} names itself as its one address`).toBe(loc);

      expect([...html.matchAll(/<h1[\s>]/g)].length, `${loc} has one main heading`).toBe(1);

      for (const block of html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
        expect(() => JSON.parse(block[1]!), `${loc} has structured data that parses`).not.toThrow();
      }
    }
  });

  test("robots.txt keeps search engines out of the console and points to the sitemap", async ({ request }) => {
    const txt = await (await request.get("/robots.txt")).text();
    expect(txt).toContain("Sitemap: https://fitron.in/sitemap.xml");
    for (const closed of ["/api/", "/login", "/dashboard"]) expect(txt, closed).toContain(`Disallow: ${closed}`);
    for (const open of ["/gym-accounting", "/gym-management-software", "/gym-gst-billing"]) expect(txt, open).toContain(`Allow: ${open}`);
  });

  test("an address that does not exist answers 404 to a signed-in person, and sends a stranger to sign in", async ({ signedIn: page, request }) => {
    expect((await page.request.get("/this/is/not/a/page")).status()).toBe(404);
    const stranger = await request.get("/this/is/not/a/page", { maxRedirects: 0 });
    expect(stranger.status()).toBeGreaterThanOrEqual(300);
    expect(stranger.headers().location).toContain("/login");
  });
});

test.describe("visitors", () => {
  test("the Gym Accounting pages lead to a free trial and to a demo request", async ({ page }) => {
    for (const path of ["/gym-accounting", "/gym-management-software", "/gym-gst-billing"]) {
      await page.goto(path);
      await expect(page.locator('a[href="/login?tab=up&plan=professional"]').first(), path).toBeVisible();
      await expect(page.locator('a[href="/contact?topic=demo"]').first(), path).toBeVisible();
    }
    await page.goto("/gym-accounting");
    await page.locator('a[href="/login?tab=up&plan=professional"]').first().click();
    await expect(page).toHaveURL(/\/login\?tab=up&plan=professional/);
    await expect(page.getByText("Create your Fitron account")).toBeVisible();
  });

  test("the contact form needs a message and says so", async ({ page }) => {
    await page.goto("/contact");
    await page.getByRole("button", { name: /send|submit/i }).first().click();
    await expect(page).toHaveURL(/\/contact/);
    await expect(page.getByRole("alert").or(page.getByText(/enter|required|check/i)).first()).toBeVisible();
  });

  test("the legal pages are there", async ({ page }) => {
    for (const [path, heading] of [["/privacy", /privacy/i], ["/terms", /terms/i], ["/refund", /refund|cancellation/i]] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }), path).toContainText(heading);
    }
  });
});
