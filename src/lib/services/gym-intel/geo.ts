import "server-only";
import { db } from "@/lib/db";
import { INDIA_STATES, stateByName, type GeoStatus } from "@/lib/domain/gym-intel/constants";
import { parseCsv } from "@/lib/domain/import";
import { cleanPin } from "@/lib/domain/gym-intel/text";
import { need, type CrmUser } from "../crm-access";
import { UserError } from "../errors";
import { intelAudit } from "./core";

/** The 28 states and 8 union territories, as rows to keep coverage against. Safe to call any time. */
export async function seedStates() {
  const have = await db.giGeo.count({ where: { level: "STATE" } });
  if (have >= INDIA_STATES.length) return;
  await db.giGeo.createMany({ data: INDIA_STATES.map((s) => ({ level: "STATE", code: s.code, name: s.name, state: s.name, refSource: "ISO 3166-2:IN (states and union territories)" })), skipDuplicates: true });
}

const col = (headers: string[], ...names: string[]) => headers.findIndex((h) => names.includes(h.trim().toLowerCase().replace(/[^a-z]/g, "")));

/** Loads the India Post PIN-code directory (the CSV from data.gov.in "All India Pincode Directory") as reference geography. */
export async function importPinDirectory(u: CrmUser, csv: string, fileName: string) {
  need(u, "intel.manage");
  const table = parseCsv(csv).filter((r) => r.some((c) => c.trim()));
  if (table.length < 2) throw new UserError("The file has no rows.");
  const h = table[0]!;
  const iPin = col(h, "pincode", "pin");
  const iState = col(h, "statename", "state");
  const iDistrict = col(h, "district", "districtname");
  const iOffice = col(h, "officename", "office");
  if (iPin < 0 || iState < 0) throw new UserError("The file needs a “pincode” and a “statename” column, as in the India Post directory.");
  await seedStates();
  const seen = new Map<string, { code: string; name: string; state: string; district: string | null; locality: string | null }>();
  let skipped = 0;
  for (const r of table.slice(1)) {
    const pin = cleanPin(r[iPin]);
    const state = stateByName(r[iState])?.name;
    if (!pin || !state) {
      skipped++;
      continue;
    }
    if (!seen.has(pin)) seen.set(pin, { code: pin, name: pin, state, district: iDistrict >= 0 ? (r[iDistrict]?.trim() || null) : null, locality: iOffice >= 0 ? (r[iOffice]?.trim() || null) : null });
  }
  if (!seen.size) throw new UserError("No row had a valid PIN code and an Indian state.");
  const rows = [...seen.values()];
  let added = 0;
  for (let i = 0; i < rows.length; i += 2000) {
    const c = await db.giGeo.createMany({ data: rows.slice(i, i + 2000).map((x) => ({ level: "PIN", ...x, refSource: `India Post PIN directory (${fileName.slice(0, 80)})` })), skipDuplicates: true });
    added += c.count;
  }
  await intelAudit(db, u, `PIN directory loaded: ${added} new PIN codes, ${rows.length - added} already there, ${skipped} rows skipped`);
  return { added, existing: rows.length - added, skipped };
}

export type CoverageRow = { name: string; state: string; district?: string | null; status: GeoStatus; gyms: number; withPhone: number; missingPhone: number };

/** A PIN code's status comes from what is stored and from how its state's search went. Zero results is never taken to mean there are no gyms. */
const pinStatus = (gyms: number, parent: GeoStatus): GeoStatus => (gyms > 0 ? "COMPLETED_WITH_RESULTS" : parent === "COMPLETED_WITH_RESULTS" || parent === "COMPLETED_NO_RESULTS" ? "COMPLETED_NO_RESULTS" : parent);

export async function coverage(u: CrmUser, f: { state?: string; district?: string } = {}) {
  need(u, "intel.view");
  await seedStates();
  const states = await db.giGeo.findMany({ where: { level: "STATE" }, orderBy: { name: "asc" } });
  const byState = await db.giGym.groupBy({ by: ["state"], _count: { _all: true } });
  const withPhoneByState = await db.giGym.groupBy({ by: ["state"], where: { phoneNorm: { not: null } }, _count: { _all: true } });
  const cnt = new Map(byState.map((r) => [r.state ?? "", r._count._all]));
  const cntP = new Map(withPhoneByState.map((r) => [r.state ?? "", r._count._all]));
  const stateRows: CoverageRow[] = states.map((s) => ({ name: s.name, state: s.name, status: s.status as GeoStatus, gyms: cnt.get(s.name) ?? 0, withPhone: cntP.get(s.name) ?? 0, missingPhone: (cnt.get(s.name) ?? 0) - (cntP.get(s.name) ?? 0) }));
  const totals: Record<string, number> = {};
  for (const r of stateRows) totals[r.status] = (totals[r.status] ?? 0) + 1;
  const pinTotal = await db.giGeo.count({ where: { level: "PIN" } });
  let districts: CoverageRow[] = [];
  let pins: CoverageRow[] = [];
  if (f.state) {
    const parent = (states.find((s) => s.name === f.state)?.status ?? "NOT_STARTED") as GeoStatus;
    const gymsByPin = new Map((await db.giGym.groupBy({ by: ["pin"], where: { state: f.state, pin: { not: null } }, _count: { _all: true } })).map((r) => [r.pin!, r._count._all]));
    const withPhoneByPin = new Map((await db.giGym.groupBy({ by: ["pin"], where: { state: f.state, pin: { not: null }, phoneNorm: { not: null } }, _count: { _all: true } })).map((r) => [r.pin!, r._count._all]));
    const pinRows = await db.giGeo.findMany({ where: { level: "PIN", state: f.state, ...(f.district ? { district: f.district } : {}) }, orderBy: { code: "asc" }, take: 2000 });
    pins = pinRows.map((p) => ({ name: p.code, state: p.state, district: p.district, status: pinStatus(gymsByPin.get(p.code) ?? 0, parent), gyms: gymsByPin.get(p.code) ?? 0, withPhone: withPhoneByPin.get(p.code) ?? 0, missingPhone: (gymsByPin.get(p.code) ?? 0) - (withPhoneByPin.get(p.code) ?? 0) }));
    const d = new Map<string, CoverageRow>();
    for (const p of pins) {
      const k = p.district ?? "(district not listed)";
      const r = d.get(k) ?? { name: k, state: p.state, status: p.status, gyms: 0, withPhone: 0, missingPhone: 0 };
      r.gyms += p.gyms;
      r.withPhone += p.withPhone;
      r.missingPhone += p.missingPhone;
      if (p.status === "COMPLETED_WITH_RESULTS") r.status = "COMPLETED_WITH_RESULTS";
      d.set(k, r);
    }
    districts = [...d.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  return { states: stateRows, districts, pins, totals, pinReferenceLoaded: pinTotal > 0, pinTotal, areas: stateRows.length };
}
