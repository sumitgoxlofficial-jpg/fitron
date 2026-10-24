import "server-only";
import { overpassQuery, parseOverpass } from "@/lib/domain/gym-intel/osm";
import type { GymCategory } from "@/lib/domain/gym-intel/constants";
import { robotsAllows, extractFromHtml, contactLinks } from "@/lib/domain/gym-intel/website";
import { pageMentionsGym } from "@/lib/domain/gym-intel/ai";
import { webUrl } from "@/lib/domain/gym-intel/text";
import type { Observation } from "@/lib/domain/gym-intel/types";
import { getText, politely, USER_AGENT, type FetchLike } from "./fetch";

// Source adapters. Each takes a fetch function so tests can supply an answer; in production it is the real one.

export const DEFAULT_OVERPASS = "https://overpass-api.de/api/interpreter";

export class SourceError extends Error {
  constructor(message: string, readonly retryable = true) {
    super(message);
  }
}

/** The gyms OpenStreetMap lists for one state, through the Overpass API. */
export async function discoverOsmState(isoCode: string, stateName: string, categories: readonly GymCategory[], o: { endpoint?: string; perMinute: number; fetch: FetchLike; timeoutMs?: number }) {
  const endpoint = o.endpoint ?? DEFAULT_OVERPASS;
  const host = new URL(endpoint).host;
  await politely(host, o.perMinute);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), o.timeoutMs ?? 240_000);
  let res: Response;
  try {
    res = await o.fetch(endpoint, { method: "POST", headers: { "user-agent": USER_AGENT, "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: `data=${encodeURIComponent(overpassQuery(isoCode, categories, 200))}`, signal: ctl.signal });
  } catch (e) {
    throw new SourceError(`Could not reach the Overpass server for ${stateName}: ${(e as Error).name === "AbortError" ? "timed out" : (e as Error).message}`);
  } finally {
    clearTimeout(t);
  }
  if (res.status === 429 || res.status === 504 || res.status === 503) throw new SourceError(`Overpass is busy (HTTP ${res.status}) for ${stateName}; it will be tried again later.`);
  if (!res.ok) throw new SourceError(`Overpass answered HTTP ${res.status} for ${stateName}.`, res.status >= 500);
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new SourceError(`Overpass did not return JSON for ${stateName}.`);
  }
  const remark = (json as { remark?: string }).remark;
  const parsed = parseOverpass(json, "osm_overpass", stateName);
  // Overpass sends a "remark" instead of an error when a query ran out of time or memory: the list may be incomplete.
  if (remark && /(timed out|out of memory|runtime error)/i.test(remark)) throw new SourceError(`Overpass could not finish ${stateName}: ${remark.slice(0, 160)}`);
  return parsed;
}

const robotsCache = new Map<string, { at: number; text: string | null }>();

/** What a gym's own site publishes: its contact numbers, if robots.txt allows reading it. Returns null when nothing may or can be read. */
export async function readGymSite(siteUrl: string, o: { fetch: FetchLike; perMinute: number; checkHost?: (h: string) => Promise<void>; /** A site an AI found: its text must speak of this gym, or nothing is taken from it */ verifyName?: string; choose?: (c: { e164: string; original: string; context: string }[]) => Promise<{ e164: string; original: string; context: string }[]> }): Promise<{ observation: Pick<Observation, "sourceUrl" | "phonesRaw" | "evidence">; skipped?: string } | { skipped: string }> {
  const base = webUrl(siteUrl);
  if (!base) return { skipped: "not a web address" };
  const u = new URL(base);
  let robots = robotsCache.get(u.origin);
  if (!robots || Date.now() - robots.at > 3_600_000) {
    await politely(u.host, o.perMinute);
    const r = await getText(`${u.origin}/robots.txt`, o.fetch, { timeoutMs: 8_000, maxBytes: 200_000, checkHost: o.checkHost }).catch(() => ({ status: 0, text: null as string | null, finalUrl: "" }));
    // 401/403 on robots.txt means the site does not want to be read; a 404 means no rules.
    if (r.status === 401 || r.status === 403) return { skipped: "robots.txt refuses access" };
    robots = { at: Date.now(), text: r.status >= 200 && r.status < 300 ? r.text : null };
    robotsCache.set(u.origin, robots);
  }
  if (!robotsAllows(robots.text, u.pathname || "/")) return { skipped: "robots.txt disallows this page" };
  await politely(u.host, o.perMinute);
  const page = await getText(base, o.fetch, { checkHost: o.checkHost });
  if (page.status === 403 || page.status === 429) return { skipped: `the site refused (HTTP ${page.status}); not retried` };
  if (!page.text) return { skipped: `no readable page (HTTP ${page.status})` };
  const first = extractFromHtml(page.text);
  if (o.verifyName && !pageMentionsGym(`${first.title ?? ""} ${first.text}`, o.verifyName)) return { skipped: "the page doesn't mention this gym" };
  let phones = first.phones;
  let contexts = first.contexts;
  let readUrl = page.finalUrl;
  if (!phones.length) {
    for (const link of contactLinks(page.text, page.finalUrl)) {
      const lu = new URL(link);
      if (!robotsAllows(robots.text, lu.pathname)) continue;
      await politely(lu.host, o.perMinute);
      const sub = await getText(link, o.fetch, { checkHost: o.checkHost });
      if (sub.text) {
        const more = extractFromHtml(sub.text);
        phones = more.phones;
        contexts = more.contexts;
        if (phones.length) {
          readUrl = sub.finalUrl;
          break;
        }
      }
    }
  }
  if (!phones.length) return { skipped: "no phone number published on the page" };
  let chosen = phones.slice(0, 4).map((p) => ({ e164: p.e164, original: p.original, context: contexts[p.e164] ?? "" }));
  let narrowedByAi = false;
  if (o.choose && chosen.length > 1) {
    const kept = await o.choose(chosen);
    narrowedByAi = kept.length < chosen.length;
    chosen = kept;
  }
  return { observation: { sourceUrl: readUrl, phonesRaw: chosen.map((p) => p.original), evidence: { found: "page contact details", userAgent: USER_AGENT, ...(o.verifyName ? { pageChecked: "the page mentions the gym" } : {}), ...(narrowedByAi ? { aiChoseFrom: phones.length } : {}) } } };
}
