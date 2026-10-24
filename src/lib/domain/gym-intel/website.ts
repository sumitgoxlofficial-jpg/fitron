// Reading a gym's own website politely: robots.txt first, then only visible contact details. Pure parts; the fetching is in the service.

import { extractPhones, type ParsedPhone } from "./phone";

export const BOT_NAME = "FitronContactBot";

/** Is a path allowed for our user agent by this robots.txt? No file, or no matching rule, means allowed. Disallow wins over a shorter Allow. */
export function robotsAllows(robotsTxt: string | null, path: string): boolean {
  if (!robotsTxt) return true;
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const lineRaw of robotsTxt.split(/\r?\n/)) {
    const line = lineRaw.replace(/#.*/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const val = m[2]!.trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (cur && (key === "allow" || key === "disallow")) cur.rules.push({ allow: key === "allow", path: val });
    }
  }
  const me = BOT_NAME.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && me.includes(a)));
  const applicable = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  let best: { allow: boolean; len: number } | null = null;
  for (const g of applicable)
    for (const r of g.rules) {
      if (!r.path) continue;
      const rx = new RegExp("^" + r.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
      if (rx.test(path) && (!best || r.path.length > best.len || (r.path.length === best.len && r.allow))) best = { allow: r.allow, len: r.path.length };
    }
  return best ? best.allow : true;
}

export type PageContact = { phones: ParsedPhone[]; telLinks: string[]; title: string | null };

/** The business phone numbers a page publishes: tel: links, schema.org telephone, and numbers printed in the visible text. */
export function extractFromHtml(html: string): PageContact {
  const telLinks = [...html.matchAll(/href\s*=\s*["']tel:([^"']+)["']/gi)].map((m) => m[1]!);
  const ld: string[] = [];
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (v: unknown) => {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) {
          if (k === "telephone" && typeof x === "string") ld.push(x);
          else walk(x);
        }
      };
      walk(JSON.parse(m[1]!));
    } catch {
      // not JSON we can read: ignore it
    }
  }
  const text = html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ");
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, " ").trim() || null;
  return { phones: extractPhones(`${ld.join(" ; ")} ; ${text}`, [...telLinks, ...ld]), telLinks, title };
}

/** Contact-page links on a page, same site only. */
export function contactLinks(html: string, base: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    if (!/contact|about|reach|location|branch/i.test(m[1]!)) continue;
    try {
      const u = new URL(m[1]!, base);
      if (u.origin === new URL(base).origin && /^https?:$/.test(u.protocol)) out.add(u.toString());
    } catch {
      // skip a link that isn't a URL
    }
  }
  return [...out].slice(0, 2);
}
