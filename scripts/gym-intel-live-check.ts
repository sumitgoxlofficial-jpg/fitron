// Checks the Gym Intelligence collector against the real OpenStreetMap service: asks Overpass for one state's gyms, runs the
// answer through the same parser and phone checks the app uses, and prints what came back. It writes nothing to any database.
//
//   npx tsx scripts/gym-intel-live-check.ts IN-JH            (needs internet access to overpass-api.de)
//
// Data © OpenStreetMap contributors, ODbL 1.0. Please keep the polite defaults: one state per run.

import { GYM_CATEGORIES, stateByCode } from "../src/lib/domain/gym-intel/constants";
import { overpassQuery, parseOverpass } from "../src/lib/domain/gym-intel/osm";
import { parsePublished } from "../src/lib/domain/gym-intel/phone";

const code = (process.argv[2] ?? "IN-JH").toUpperCase();
const endpoint = process.argv[3] ?? "https://overpass-api.de/api/interpreter";
const state = stateByCode(code);
if (!state) {
  console.error(`Unknown state code ${code}`);
  process.exit(2);
}

const query = overpassQuery(code, GYM_CATEGORIES.slice(0, 2).map((c) => c[0]), 180);
const t0 = Date.now();
const res = await fetch(endpoint, { method: "POST", headers: { "user-agent": "FitronContactBot/1.0 (+https://fitron.in; hello@fitron.in)", "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: `data=${encodeURIComponent(query)}`, signal: AbortSignal.timeout(240_000) });
console.log(`HTTP ${res.status} from ${new URL(endpoint).host} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (!res.ok) {
  console.log((await res.text()).slice(0, 300));
  process.exit(1);
}
const json = await res.json();
if ((json as { remark?: string }).remark) console.log(`Overpass remark: ${(json as { remark: string }).remark}`);
const { observations, skipped } = parseOverpass(json, "osm_overpass", state.name);
let withPhone = 0;
let valid = 0;
let invalid = 0;
const kinds: Record<string, number> = {};
const sample: unknown[] = [];
for (const o of observations) {
  const p = parsePublished(o.phonesRaw.join(";"));
  if (o.phonesRaw.length) withPhone++;
  if (p.valid.length) valid++;
  invalid += p.invalid.length;
  for (const v of p.valid) kinds[v.kind] = (kinds[v.kind] ?? 0) + 1;
  if (p.valid.length && sample.length < 5) sample.push({ name: o.name, phone: p.valid[0]!.e164, published: p.valid[0]!.original, kind: p.valid[0]!.kind, city: o.city, pin: o.pin, url: o.sourceUrl });
}
console.log(JSON.stringify({ state: state.name, gymsReturned: (json as { elements?: unknown[] }).elements?.length ?? 0, namedGyms: observations.length, skipped, withPublishedPhone: withPhone, withValidPhone: valid, invalidNumbers: invalid, numberKinds: kinds, sample }, null, 2));
