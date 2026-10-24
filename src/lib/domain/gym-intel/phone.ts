// Finding and checking published phone numbers. A number is only ever what a source printed; nothing here invents one,
// and a valid format is never taken to mean the number works or reaches the gym.

import { findPhoneNumbersInText, parsePhoneNumberFromString } from "libphonenumber-js/max";
import type { PhoneKind, PhoneStatus } from "./constants";

export type ParsedPhone = { original: string; e164: string; national: string; kind: PhoneKind };

/** Parses one published number as an Indian business number, or null if it isn't a valid format. */
export function parsePhone(raw: string): ParsedPhone | null {
  const original = String(raw ?? "").trim();
  if (!original) return null;
  const p = parsePhoneNumberFromString(original, "IN");
  if (!p || !p.isValid() || p.country !== "IN") return null;
  const t = p.getType();
  const national = p.nationalNumber;
  const kind: PhoneKind = t === "MOBILE" || (t === "FIXED_LINE_OR_MOBILE" && /^[6-9]\d{9}$/.test(national)) ? "MOBILE" : t === "FIXED_LINE" ? "LANDLINE" : t === "TOLL_FREE" ? "TOLL_FREE" : "OTHER";
  return { original, e164: p.number, national, kind };
}

/** OpenStreetMap and many sites put several numbers in one value ("a; b", "a / b", "a, b"). */
export function splitPublished(value: string | null | undefined): string[] {
  return String(value ?? "")
    .split(/[;,\n|]|\s\/\s|\sor\s/i)
    .map((s) => s.trim())
    .filter((s) => /\d{5,}/.test(s.replace(/\D/g, "")) || /\d/.test(s) && s.replace(/\D/g, "").length >= 6);
}

/** Every distinct valid number in a published value: parsed ones, in the order the source listed them. */
export function parsePublished(value: string | null | undefined): { valid: ParsedPhone[]; invalid: string[] } {
  const seen = new Set<string>();
  const valid: ParsedPhone[] = [];
  const invalid: string[] = [];
  for (const raw of splitPublished(value)) {
    const p = parsePhone(raw);
    if (!p) invalid.push(raw);
    else if (!seen.has(p.e164)) {
      seen.add(p.e164);
      valid.push(p);
    }
  }
  return { valid, invalid };
}

/** Numbers printed in visible text, and in tel: links, of a page. */
export function extractPhones(text: string, telLinks: string[] = []): ParsedPhone[] {
  const out = new Map<string, ParsedPhone>();
  for (const t of telLinks) {
    const p = parsePhone(decodeURIComponent(t.replace(/^tel:/i, "")));
    if (p) out.set(p.e164, p);
  }
  for (const m of findPhoneNumbersInText(text, "IN")) {
    if (!m.number.isValid() || m.number.country !== "IN") continue;
    const p = parsePhone(m.number.number);
    if (p && !out.has(p.e164)) out.set(p.e164, { ...p, original: text.slice(m.startsAt, m.endsAt).trim() || p.original });
  }
  return [...out.values()];
}

export type StatusInput = {
  /** The gym's primary number, or null if none was published */
  hasNumber: boolean;
  validFormat: boolean;
  /** Per source that mentions this gym: the numbers it printed (E.164) */
  sourceSets: string[][];
  primary: string | null;
  lastChecked: Date;
  staleDays: number;
  now: Date;
  /** Recorded, lawful verification evidence only */
  reachabilityConfirmed?: boolean;
  unavailable?: boolean;
};

/** Where a number stands. Only recorded verification evidence can make it REACHABILITY_CONFIRMED. */
export function phoneStatusFor(i: StatusInput): PhoneStatus {
  if (!i.hasNumber) return "UNTESTED";
  if (!i.validFormat) return "INVALID_FORMAT";
  if (i.unavailable) return "UNAVAILABLE";
  if (conflicting(i.sourceSets)) return "CONFLICTING_SOURCES";
  const ageDays = (i.now.getTime() - i.lastChecked.getTime()) / 86_400_000;
  if (ageDays > i.staleDays) return "STALE";
  if (i.reachabilityConfirmed) return "REACHABILITY_CONFIRMED";
  if (i.primary && i.sourceSets.some((s) => s.includes(i.primary!))) return "SOURCE_CONFIRMED";
  return "FORMAT_VALID";
}

/** Two sources that each print numbers but share none of them disagree about how to reach the gym. */
export function conflicting(sets: string[][]): boolean {
  const withNumbers = sets.filter((s) => s.length > 0);
  if (withNumbers.length < 2) return false;
  for (let i = 0; i < withNumbers.length; i++) for (let j = i + 1; j < withNumbers.length; j++) if (!withNumbers[i]!.some((n) => withNumbers[j]!.includes(n))) return true;
  return false;
}

/** The number to show first: a mobile or landline a source printed, preferring one more sources agree on. */
export function choosePrimary(sets: string[][], kinds: Map<string, PhoneKind>): string | null {
  const count = new Map<string, number>();
  for (const s of sets) for (const n of new Set(s)) count.set(n, (count.get(n) ?? 0) + 1);
  const rank = (n: string) => (kinds.get(n) === "MOBILE" ? 2 : kinds.get(n) === "LANDLINE" ? 1 : 0);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || rank(b[0]) - rank(a[0]) || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}
