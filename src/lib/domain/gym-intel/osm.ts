// OpenStreetMap gym records: the Overpass query for a state, and turning its answer into observations. Pure.
// Data © OpenStreetMap contributors, ODbL 1.0. https://www.openstreetmap.org/copyright

import type { GymCategory } from "./constants";
import { stateByName } from "./constants";
import { cleanPin, webUrl } from "./text";
import type { Observation } from "./types";
import type { SourceKey } from "./sources";

/** The OpenStreetMap tag filters for each category a job can ask for. */
const FILTERS: Record<GymCategory, string[]> = {
  gym: [`["leisure"="fitness_centre"]`, `["amenity"="gym"]`],
  fitness_centre: [`["leisure"="fitness_centre"]`],
  health_club: [`["leisure"="fitness_centre"]["name"~"health club",i]`],
  bodybuilding: [`["leisure"~"fitness_centre|sports_centre"]["sport"~"bodybuilding|weightlifting",i]`],
  strength: [`["leisure"~"fitness_centre|sports_centre"]["sport"~"weightlifting|powerlifting|strength",i]`],
  womens: [`["leisure"="fitness_centre"]["name"~"women|ladies|female",i]`],
  functional: [`["leisure"="fitness_centre"]["name"~"functional",i]`],
  personal_training: [`["leisure"="fitness_centre"]["name"~"personal training|studio",i]`],
  crossfit: [`["leisure"~"fitness_centre|sports_centre"]["sport"~"crossfit",i]`, `["leisure"="fitness_centre"]["name"~"crossfit|cross fit|cross-training",i]`],
};

/** An Overpass QL query for the gyms of one state or union territory (ISO 3166-2 code, e.g. IN-JH). */
export function overpassQuery(isoCode: string, categories: readonly GymCategory[], timeoutSeconds = 180): string {
  if (!/^IN-[A-Z]{2}$/.test(isoCode)) throw new Error("Not a state code.");
  const filters = [...new Set(categories.flatMap((c) => FILTERS[c] ?? []))];
  if (!filters.length) throw new Error("Choose at least one gym category.");
  return `[out:json][timeout:${Math.round(Math.min(Math.max(timeoutSeconds, 25), 300))}];\narea["ISO3166-2"="${isoCode}"]->.a;\n(\n${filters.map((f) => `  nwr${f}(area.a);`).join("\n")}\n);\nout tags center;`;
}

type OsmElement = { type?: string; id?: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string>; timestamp?: string; version?: number };

const PHONE_TAGS = ["phone", "contact:phone", "contact:mobile", "mobile", "phone:mobile", "contact:phone_1", "contact:phone_2"];
const WEB_TAGS = ["website", "contact:website", "url"];

export type OsmParseResult = { observations: Observation[]; skipped: { unnamed: number; notGym: number; invalid: number } };

const GYM_LIKE = (t: Record<string, string>) =>
  t.leisure === "fitness_centre" || t.amenity === "gym" || (t.leisure === "sports_centre" && /fitness|bodybuilding|weightlifting|crossfit|gym/i.test(`${t.sport ?? ""} ${t.name ?? ""}`));

/** Turns an Overpass JSON answer (or an uploaded export of one) into observations. Records without a name are skipped: nothing is guessed. */
export function parseOverpass(json: unknown, source: Extract<SourceKey, "osm_overpass" | "osm_extract">, defaultState?: string | null): OsmParseResult {
  const elements = (json && typeof json === "object" && Array.isArray((json as { elements?: unknown }).elements) ? (json as { elements: OsmElement[] }).elements : null);
  if (!elements) throw new Error("This isn't an Overpass JSON file: it has no “elements” list.");
  const skipped = { unnamed: 0, notGym: 0, invalid: 0 };
  const observations: Observation[] = [];
  for (const el of elements) {
    const t = el.tags;
    if (!t || !el.type || !Number.isFinite(el.id)) {
      skipped.invalid++;
      continue;
    }
    if (!GYM_LIKE(t)) {
      skipped.notGym++;
      continue;
    }
    const name = (t.name ?? t["name:en"] ?? "").trim();
    if (!name) {
      skipped.unnamed++;
      continue;
    }
    const phonesRaw = PHONE_TAGS.map((k) => t[k]).filter((v): v is string => !!v?.trim());
    const site = WEB_TAGS.map((k) => webUrl(t[k])).find(Boolean) ?? null;
    const lat = el.lat ?? el.center?.lat ?? null;
    const lon = el.lon ?? el.center?.lon ?? null;
    const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
    const state = stateByName(t["addr:state"])?.name ?? stateByName(defaultState)?.name ?? t["addr:state"] ?? null;
    const city = t["addr:city"] ?? t["addr:town"] ?? t["addr:village"] ?? null;
    const address = [street, t["addr:suburb"] ?? t["addr:neighbourhood"], city, t["addr:district"], t["addr:state"], t["addr:postcode"]].filter(Boolean).join(", ") || t["addr:full"] || null;
    observations.push({
      source,
      sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      sourceRecordId: `${el.type}/${el.id}`,
      name,
      phonesRaw,
      address,
      state,
      district: t["addr:district"] ?? null,
      city,
      locality: t["addr:suburb"] ?? t["addr:neighbourhood"] ?? null,
      pin: cleanPin(t["addr:postcode"]),
      website: site,
      lat,
      lon,
      category: t.leisure ?? t.amenity ?? null,
      evidence: { tags: Object.fromEntries(Object.entries(t).filter(([k]) => /^(name|phone|contact:|mobile|website|url|leisure|amenity|sport|addr:|opening_hours)/.test(k))), osmVersion: el.version ?? null, osmTimestamp: el.timestamp ?? null, attribution: "© OpenStreetMap contributors (ODbL 1.0)" },
    });
  }
  return { observations, skipped };
}
