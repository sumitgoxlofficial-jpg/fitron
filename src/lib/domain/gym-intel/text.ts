// Names, addresses and websites, reduced to what can be compared. Pure.

const STOP = new Set(["gym", "gyms", "fitness", "fit", "centre", "center", "centers", "centres", "club", "health", "the", "and", "studio", "unisex", "family", "zone", "point", "world", "of", "a", "an", "&", "multi", "gymnasium", "sports", "wellness"]);

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Lowercase, no accents, "&" as "and", punctuation gone. What the database stores for matching and searching. */
export const normalizeName = (s: string | null | undefined) => fold(String(s ?? "")).replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** The words that tell one gym from another: "Iron Paradise Gym & Fitness Centre" → "iron paradise". */
export const nameCore = (s: string | null | undefined) => {
  const all = normalizeName(s).split(" ").filter(Boolean);
  const core = all.filter((w) => !STOP.has(w));
  return (core.length ? core : all).join(" ");
};

function jaro(a: string, b: string) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array<boolean>(a.length).fill(false);
  const bm = new Array<boolean>(b.length).fill(false);
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
      if (!bm[j] && a[i] === b[j]) {
        am[i] = bm[j] = true;
        m++;
        break;
      }
    }
  }
  if (!m) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!am[i]) continue;
    while (!bm[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  return (m / a.length + m / b.length + (m - t / 2) / m) / 3;
}

export function jaroWinkler(a: string, b: string) {
  const j = jaro(a, b);
  let l = 0;
  while (l < 4 && a[l] && a[l] === b[l]) l++;
  return j + l * 0.1 * (1 - j);
}

/** 0–1. Word order and extra words matter little (token-set), spelling slips matter little (Jaro–Winkler). */
export function nameSimilarity(a: string | null | undefined, b: string | null | undefined) {
  const x = nameCore(a);
  const y = nameCore(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const tx = new Set(x.split(" "));
  const ty = new Set(y.split(" "));
  const inter = [...tx].filter((w) => ty.has(w));
  const tokenSet = inter.length ? (2 * inter.length) / (tx.size + ty.size) : 0;
  const sorted = (s: string) => s.split(" ").sort().join(" ");
  return Math.max(tokenSet, jaroWinkler(sorted(x), sorted(y)));
}

export const normalizeAddress = (s: string | null | undefined) => normalizeName(s).replace(/\b(road|rd)\b/g, "road").replace(/\b(street|st)\b/g, "street").replace(/\b(near|opp|opposite|behind|beside|next to)\b/g, " ").replace(/\s+/g, " ").trim();

export function addressSimilarity(a: string | null | undefined, b: string | null | undefined) {
  const x = normalizeAddress(a).split(" ").filter(Boolean);
  const y = normalizeAddress(b).split(" ").filter(Boolean);
  if (!x.length || !y.length) return 0;
  const sy = new Set(y);
  const inter = x.filter((w) => sy.has(w)).length;
  return (2 * inter) / (x.length + y.length);
}

/** The site's registrable-looking host without www: "https://www.ironparadise.in/contact" → "ironparadise.in". Null if it isn't a web address. */
export function domainOf(url: string | null | undefined): string | null {
  const raw = String(url ?? "").trim();
  if (!raw) return null;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return null;
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** The address of the site as a safe https URL to visit, or null. */
export function webUrl(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".") || u.username || u.password) return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

export const cleanPin = (v: unknown) => {
  const d = String(v ?? "").replace(/\s/g, "");
  return /^[1-9]\d{5}$/.test(d) ? d : null;
};

export function distanceMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}
