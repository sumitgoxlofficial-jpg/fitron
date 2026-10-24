// What the AI may and may not do in Gym Intelligence. It finds a gym's own website, and it chooses between numbers a page
// already printed. It never supplies a number: a phone is kept only if it was extracted from a real page's text. Pure.

import { webUrl, domainOf, nameCore } from "./text";

/** Sites whose terms forbid automated reading, or that are not the gym's own site. A bare word blocks that name on any ending (google.com, google.co.in); a dotted entry blocks that domain and its subdomains. */
const BLOCKED_NAMES = ["google", "facebook", "instagram", "justdial", "sulekha", "indiamart", "youtube", "twitter", "linkedin", "tiktok", "pinterest", "wikipedia", "tripadvisor", "yelp", "foursquare", "yellowpages", "whatsapp", "maps", "bing", "yahoo", "openstreetmap", "mapquest", "grotal", "asklaila", "magicpin", "practo", "urbanclap", "urbancompany", "99acres", "olx", "quikr", "naukri", "glassdoor", "mouthshut", "zomato", "swiggy"];
const BLOCKED_DOMAINS = ["goo.gl", "g.co", "g.page", "fb.com", "fb.me", "youtu.be", "x.com", "wa.me", "t.me", "linktr.ee", "cult.fit"];

export const blockedSite = (host: string) => {
  const h = host.toLowerCase();
  return BLOCKED_DOMAINS.some((d) => h === d || h.endsWith(`.${d}`)) || h.split(".").some((label) => BLOCKED_NAMES.includes(label));
};

/** A website the finder returned, if it is a normal web address that isn't on the refused list. */
export function acceptWebsite(raw: unknown): string | null {
  const u = webUrl(typeof raw === "string" ? raw : "");
  const host = domainOf(u);
  if (!u || !host || blockedSite(host)) return null;
  // The gym's own site, not a deep page of someone else's: keep the address as given but reject file downloads.
  if (/\.(pdf|jpe?g|png|gif|docx?|xlsx?|zip)(\?|$)/i.test(new URL(u).pathname)) return null;
  return u;
}

export const FINDER_SYSTEM = `You help a sales team find the official website of a gym in India. You may use web search. Reply with ONLY a JSON object: {"url": "<the gym's own website address, or null>", "reason": "<one short sentence>"}.
Rules: the address must be one you actually found in search results, never one you guessed or built. It must be the gym's own website, not a directory, map, social network or listing page. If you are not confident it is this gym (same name, same city), return {"url": null}. Never write a phone number.`;

export const finderPrompt = (g: { name: string; address?: string | null; city?: string | null; district?: string | null; state?: string | null; pin?: string | null }) =>
  `Gym: ${g.name}\nPlace: ${[g.address, g.city, g.district, g.state, g.pin].filter(Boolean).join(", ") || "India"}\nFind this gym's own website.`;

/** The finder's answer: a website, or nothing. Anything but a clean JSON object with an acceptable address gives null. */
export function parseFinderAnswer(text: string): { url: string | null; reason: string } {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return { url: null, reason: "no answer" };
  try {
    const j = JSON.parse(m[0]) as { url?: unknown; reason?: unknown };
    return { url: acceptWebsite(j.url), reason: typeof j.reason === "string" ? j.reason.slice(0, 200) : "" };
  } catch {
    return { url: null, reason: "unreadable answer" };
  }
}

export const SELECTOR_SYSTEM = `You help a sales team choose a gym's business phone numbers from numbers printed on its own web page. You are given numbers with the text around each. Reply with ONLY a JSON object: {"keep": [<index numbers>]}. Keep numbers presented as the gym's own contact (call, enquiries, front desk, reception, branch). Drop numbers for something else: a WhatsApp-only line for another business, a payment helpline, a franchise or careers line, an app-download number, a partner or sponsor. If you cannot tell, keep it. Never write or change a number: you only choose by index.`;

export type NumberCandidate = { e164: string; original: string; context: string };

export const selectorPrompt = (gym: string, c: NumberCandidate[]) => `Gym: ${gym}\n${c.map((x, i) => `${i}. ${x.original} — …${x.context}…`).join("\n")}`;

/** The chosen indices, only those that exist; if the answer is unusable, or would drop every number, all of them are kept. */
export function parseSelection(text: string, count: number): number[] {
  const all = Array.from({ length: count }, (_, i) => i);
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return all;
  try {
    const j = JSON.parse(m[0]) as { keep?: unknown };
    if (!Array.isArray(j.keep)) return all;
    const keep = [...new Set(j.keep.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < count))];
    return keep.length ? keep : all;
  } catch {
    return all;
  }
}

/** Does the page speak of this gym? Used for a site the AI found, so a wrong business's site gives no number. */
export function pageMentionsGym(pageText: string, gymName: string): boolean {
  const tokens = nameCore(gymName).split(" ").filter((t) => t.length >= 3);
  if (!tokens.length) return false;
  const hay = ` ${pageText.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ")} `;
  const hits = tokens.filter((t) => hay.includes(` ${t} `) || hay.includes(` ${t}`)).length;
  return tokens.length <= 2 ? hits === tokens.length : hits >= Math.ceil(tokens.length / 2);
}
