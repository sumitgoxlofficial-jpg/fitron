// Are two gym records the same business? A shared phone number or a similar name alone never says so: chains share a head
// office number and branches share a name. Anything that isn't clear goes to a person. Pure.

import { addressSimilarity, distanceMeters, nameSimilarity } from "./text";

export type GymLike = {
  name: string;
  phones: string[];
  domain?: string | null;
  address?: string | null;
  pin?: string | null;
  city?: string | null;
  lat?: number | null;
  lon?: number | null;
  /** The same source record: e.g. node/123 in OpenStreetMap */
  sourceKeys?: string[];
};

export type MatchDecision = "SAME" | "AMBIGUOUS" | "DIFFERENT";
export type MatchResult = { decision: MatchDecision; score: number; reasons: string[] };

export const DEFAULT_MATCH = { sameName: 0.88, ambiguousName: 0.8, nearMeters: 150, farMeters: 1500, addressSame: 0.6 } as const;
export type MatchThresholds = { [K in keyof typeof DEFAULT_MATCH]: number };

export function compareGyms(a: GymLike, b: GymLike, th: MatchThresholds = DEFAULT_MATCH): MatchResult {
  const reasons: string[] = [];
  if (a.sourceKeys?.some((k) => b.sourceKeys?.includes(k))) return { decision: "SAME", score: 1, reasons: ["same source record"] };

  const name = nameSimilarity(a.name, b.name);
  const sharedPhone = a.phones.some((p) => b.phones.includes(p));
  const sameDomain = !!a.domain && a.domain === b.domain;
  const pinKnown = !!a.pin && !!b.pin;
  const samePin = pinKnown && a.pin === b.pin;
  const diffPin = pinKnown && a.pin !== b.pin;
  const cityKnown = !!a.city && !!b.city;
  const diffCity = cityKnown && a.city!.toLowerCase() !== b.city!.toLowerCase();
  const hasGeo = a.lat != null && a.lon != null && b.lat != null && b.lon != null;
  const dist = hasGeo ? distanceMeters({ lat: a.lat!, lon: a.lon! }, { lat: b.lat!, lon: b.lon! }) : null;
  const addr = addressSimilarity(a.address, b.address);

  if (name >= th.ambiguousName) reasons.push(`name ${Math.round(name * 100)}% alike`);
  if (sharedPhone) reasons.push("shared phone");
  if (sameDomain) reasons.push("same website");
  if (samePin) reasons.push("same PIN code");
  if (dist != null) reasons.push(`${Math.round(dist)} m apart`);
  if (addr >= th.addressSame) reasons.push(`address ${Math.round(addr * 100)}% alike`);

  const score = Math.min(1, name * 0.5 + (sharedPhone ? 0.2 : 0) + (sameDomain ? 0.1 : 0) + (samePin ? 0.1 : 0) + (dist != null && dist <= th.nearMeters ? 0.1 : 0) + (addr >= th.addressSame ? 0.1 : 0));

  const farApart = dist != null && dist > th.farMeters;
  const sameSpot = (dist != null && dist <= th.nearMeters) || (samePin && addr >= th.addressSame);
  const contradiction = diffPin || farApart || diffCity;

  // Same place, same name: the same business, whatever the phone says.
  if (name >= th.sameName && sameSpot && !farApart) return { decision: "SAME", score, reasons };
  // Same number and name, and nothing says they are in different places.
  if (name >= th.sameName && sharedPhone && !contradiction) return { decision: "SAME", score, reasons };
  if (name >= th.sameName + 0.02 && sameDomain && !contradiction) return { decision: "SAME", score, reasons };

  // A shared number or name across different places is usually a chain's branches: a person decides.
  if (name >= th.ambiguousName && (sharedPhone || sameDomain || (samePin && !diffCity))) return { decision: "AMBIGUOUS", score, reasons: [...reasons, ...(contradiction ? ["different places: possibly branches"] : [])] };
  if (sharedPhone && name >= 0.6) return { decision: "AMBIGUOUS", score, reasons: [...reasons, ...(contradiction ? ["different places: possibly branches"] : [])] };
  if (name >= th.sameName && !contradiction && (samePin || dist != null)) return { decision: "AMBIGUOUS", score, reasons };

  return { decision: "DIFFERENT", score, reasons };
}
