import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { BOT_NAME } from "@/lib/domain/gym-intel/website";

// Outgoing requests for collection: identified, bounded, polite, and never to a private address.

export const USER_AGENT = `${BOT_NAME}/1.0 (+https://fitron.in; hello@fitron.in)`;

const PRIVATE = [/^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^::1$/, /^f[cd][0-9a-f]{2}:/i, /^fe80:/i, /^::ffff:(10|127|169\.254|192\.168)\./i];
const isPrivate = (ip: string) => PRIVATE.some((r) => r.test(ip));

/** Refuses localhost and private networks, including a name that resolves to one. */
export async function assertPublicHost(hostname: string) {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) throw new Error("That address is not a public website.");
  const addrs = isIP(h) ? [{ address: h }] : await lookup(h, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivate(a.address))) throw new Error("That address is not a public website.");
}

const lastAt = new Map<string, number>();
/** Waits so that requests to one host stay under its limit. */
export async function politely(host: string, perMinute: number) {
  const gap = Math.ceil(60_000 / Math.max(1, perMinute));
  const wait = (lastAt.get(host) ?? 0) + gap - Date.now();
  lastAt.set(host, Math.max(Date.now(), (lastAt.get(host) ?? 0) + gap));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** GET a public page as text, with a time limit and a size cap. Returns null on an error status, and never retries a refusal. */
export async function getText(url: string, f: FetchLike, opts: { timeoutMs?: number; maxBytes?: number; checkHost?: (h: string) => Promise<void> } = {}): Promise<{ status: number; text: string | null; finalUrl: string }> {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error("Only web addresses can be read.");
  const check = opts.checkHost ?? assertPublicHost;
  await check(u.hostname);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 15_000);
  try {
    const res = await f(url, { headers: { "user-agent": USER_AGENT, accept: "text/html,text/plain;q=0.9,*/*;q=0.1" }, signal: ctl.signal, redirect: "follow" });
    if (!res.ok) return { status: res.status, text: null, finalUrl: res.url || url };
    if (res.url) await check(new URL(res.url).hostname);
    const type = res.headers.get("content-type") ?? "";
    if (type && !/text|html|json|xml/i.test(type)) return { status: res.status, text: null, finalUrl: res.url || url };
    const buf = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, text: new TextDecoder().decode(buf.slice(0, opts.maxBytes ?? 1_500_000)), finalUrl: res.url || url };
  } finally {
    clearTimeout(t);
  }
}
