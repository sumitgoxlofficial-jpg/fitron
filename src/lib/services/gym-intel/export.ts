import "server-only";
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { PHONE_STATUS_LABEL, type PhoneStatus } from "@/lib/domain/gym-intel/constants";
import { SOURCES, type SourceKey } from "@/lib/domain/gym-intel/sources";
import { need, type CrmUser } from "../crm-access";
import { UserError } from "../errors";
import { intelAudit } from "./core";
import { coverage } from "./geo";
import { gymWhere, type GymFilter } from "./gyms";
import { listSources } from "./core";

// Exports are built from the stored records. Every cell is text so a PIN code keeps its leading digits and nothing is read as a formula.

export type ExportKind = "master" | "with_phones" | "unverified" | "duplicates" | "coverage" | "errors" | "sources";
export const EXPORTS: Record<ExportKind, { file: string; label: string }> = {
  master: { file: "All_India_Gym_Master", label: "All India gym master" },
  with_phones: { file: "Gyms_With_Public_Phones", label: "Gyms with public phones" },
  unverified: { file: "Unverified_Phones", label: "Unverified phones" },
  duplicates: { file: "Duplicate_Review", label: "Duplicate review" },
  coverage: { file: "PIN_Code_Coverage", label: "PIN code coverage" },
  errors: { file: "Collection_Errors", label: "Collection errors" },
  sources: { file: "Source_Registry", label: "Source registry" },
};

/** Text that a spreadsheet could run as a formula (= - @, or + that isn't a phone number) is written with a leading quote so it stays text. */
export const safeText = (s: string) => (/^[=\-@\t\r]/.test(s) || (/^\+/.test(s) && !/^\+\d[\d ]*$/.test(s)) ? `'${s}` : s);

const cell = (v: unknown): string => {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(cell).join("; ");
  return safeText(String(v));
};

const GYM_COLS = ["Gym ID", "Gym name", "Public business phone", "Phone as published", "Phone type", "Phone status", "Business association", "Website", "Address", "State", "District", "City", "Locality", "PIN code", "Source", "Source URL", "Collected", "Last checked", "Duplicate group", "CRM promotion", "CRM lead", "Review status"] as const;

async function gymRows(f: GymFilter, extra: object = {}) {
  const rows = await db.giGym.findMany({ where: { AND: [gymWhere(f), extra] }, orderBy: [{ state: "asc" }, { district: "asc" }, { city: "asc" }, { name: "asc" }], include: { sources: { orderBy: { collectedAt: "asc" } } }, take: 200_000 });
  return rows.map((g) => [g.id, g.name, g.phoneNorm, g.phone, g.phoneKind, PHONE_STATUS_LABEL[g.phoneStatus as PhoneStatus] ?? g.phoneStatus, g.association, g.website, g.address, g.state, g.district, g.city, g.locality, g.pin, g.sources.map((s) => SOURCES[s.source as SourceKey]?.name ?? s.source), g.sources.map((s) => s.sourceUrl), g.sources[0]?.collectedAt, g.lastChecked, g.dupGroup, g.promotion, g.leadId, g.reviewStatus]);
}

function sheet(wb: ExcelJS.Workbook, name: string, cols: readonly string[], rows: unknown[][]) {
  const ws = wb.addWorksheet(name.slice(0, 31));
  ws.addRow([...cols]).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const r of rows) ws.addRow(r.map(cell));
  ws.columns.forEach((c, i) => {
    c.width = Math.min(60, Math.max(12, (cols[i]?.length ?? 10) + 4));
    c.numFmt = "@";
  });
  return ws;
}

export type ExportOut = { buffer: Buffer; file: string; contentType: string; rows: number };

export async function buildExport(u: CrmUser, kind: ExportKind, f: GymFilter = {}, format: "xlsx" | "csv" = "xlsx"): Promise<ExportOut> {
  need(u, "intel.manage");
  if (!(kind in EXPORTS)) throw new UserError("Unknown export.");
  if (format === "csv" && kind !== "master" && kind !== "with_phones") throw new UserError("Only the gym lists are available as CSV.");
  const wb = new ExcelJS.Workbook();
  wb.creator = "FITRON Gym Intelligence";
  wb.created = new Date();
  let count = 0;

  if (kind === "master" || kind === "with_phones" || kind === "unverified") {
    const extra = kind === "with_phones" ? { phoneNorm: { not: null } } : kind === "unverified" ? { phoneNorm: { not: null }, reachability: "NOT_TESTED" } : {};
    const rows = await gymRows(f, extra);
    count = rows.length;
    if (format === "csv") {
      const lines = [GYM_COLS.map((c) => `"${c}"`).join(",")];
      for (const r of rows) lines.push(r.map((v) => `"${cell(v).replace(/"/g, '""')}"`).join(","));
      await intelAudit(db, u, `Exported ${EXPORTS[kind].label} as CSV (${count} rows)`, { kind, format });
      return { buffer: Buffer.from("﻿" + lines.join("\r\n"), "utf8"), file: `${EXPORTS[kind].file}.csv`, contentType: "text/csv; charset=utf-8", rows: count };
    }
    sheet(wb, "All records", GYM_COLS, rows);
    const byState = new Map<string, { n: number; p: number }>();
    const byDistrict = new Map<string, { n: number; p: number }>();
    const byStatus = new Map<string, number>();
    const bySource = new Map<string, number>();
    for (const r of rows) {
      const st = String(r[9] ?? "(unknown)");
      const di = `${st} › ${String(r[10] ?? "(unknown)")}`;
      for (const [m, k] of [[byState, st], [byDistrict, di]] as const) {
        const e = m.get(k) ?? { n: 0, p: 0 };
        e.n++;
        if (r[2]) e.p++;
        m.set(k, e);
      }
      byStatus.set(String(r[5]), (byStatus.get(String(r[5])) ?? 0) + 1);
      for (const s of (r[14] as string[]) ?? []) bySource.set(s, (bySource.get(s) ?? 0) + 1);
    }
    sheet(wb, "State summary", ["State", "Gyms", "With public phone"], [...byState].map(([k, v]) => [k, v.n, v.p]));
    sheet(wb, "District summary", ["District", "Gyms", "With public phone"], [...byDistrict].map(([k, v]) => [k, v.n, v.p]));
    sheet(wb, "Phone status", ["Status", "Gyms"], [...byStatus]);
    sheet(wb, "Source contributions", ["Source", "Gyms"], [...bySource]);
    sheet(wb, "Needs review", GYM_COLS, rows.filter((r) => ["Conflicting sources", "Invalid format", "Stale"].includes(String(r[5])) || r[18]));
    const notes = wb.addWorksheet("About this data");
    for (const l of ["Compiled by FITRON Gym Intelligence from the sources named in each row.", "Phone numbers are the business numbers the source published. A valid format or a source match does not mean the number works or reaches the owner.", "OpenStreetMap data: © OpenStreetMap contributors, Open Database Licence 1.0 (https://www.openstreetmap.org/copyright).", "Rows marked do-not-contact must not be used for outreach."]) notes.addRow([l]);
    notes.getColumn(1).width = 120;
  } else if (kind === "duplicates") {
    const d = await db.giDup.findMany({ orderBy: { score: "desc" }, include: { a: true, b: true }, take: 50_000 });
    count = d.length;
    sheet(wb, "Duplicate review", ["Match ID", "Status", "Score", "Why", "Gym A", "A name", "A phone", "A PIN", "Gym B", "B name", "B phone", "B PIN"], d.map((x) => [x.id, x.status, x.score.toFixed(2), x.reasons, x.aId, x.a.name, x.a.phoneNorm, x.a.pin, x.bId, x.b.name, x.b.phoneNorm, x.b.pin]));
  } else if (kind === "coverage") {
    const states = (await coverage(u)).states;
    count = states.length;
    sheet(wb, "States", ["State / UT", "Status", "Gyms", "With phone", "Missing phone"], states.map((s) => [s.name, s.status, s.gyms, s.withPhone, s.missingPhone]));
    const pins = await db.giGeo.findMany({ where: { level: "PIN" }, orderBy: [{ state: "asc" }, { code: "asc" }], take: 200_000 });
    const gp = new Map((await db.giGym.groupBy({ by: ["pin"], where: { pin: { not: null } }, _count: { _all: true } })).map((r) => [r.pin!, r._count._all]));
    const st = new Map(states.map((s) => [s.name, s.status]));
    sheet(wb, "PIN codes", ["PIN code", "State", "District", "Post office", "Gyms found", "State search status"], pins.map((p) => [p.code, p.state, p.district, p.locality, gp.get(p.code) ?? 0, st.get(p.state)]));
    count = pins.length || count;
  } else if (kind === "errors") {
    const jobs = await db.giJob.findMany({ where: { OR: [{ status: "FAILED" }, { errorSummary: { not: null } }] }, orderBy: { createdAt: "desc" }, take: 5000 });
    count = jobs.length;
    sheet(wb, "Collection errors", ["Job", "Source", "Kind", "Status", "Attempts", "Started", "Summary", "Recent errors"], jobs.map((j) => [j.id, j.source, j.kind, j.status, j.attempts, j.startedAt, j.errorSummary, (j.errors as string[] | null) ?? []]));
  } else {
    const s = await listSources(u);
    count = s.length;
    sheet(wb, "Source registry", ["Source", "Type", "Location", "Access", "Licence", "Licence URL", "Permitted use", "Enabled", "Terms reviewed", "Last success", "Records", "Phones", "Errors", "Last error"], s.map((x) => [x.name, x.type, x.location, x.access, x.license, x.licenseUrl, x.permitted, x.enabled ? "Yes" : "No", x.reviewedAt, x.lastSuccessAt, x.recordsFound, x.phonesFound, x.errorCount, x.lastError]));
  }
  await intelAudit(db, u, `Exported ${EXPORTS[kind].label} (${count} rows)`, { kind, format });
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), file: `${EXPORTS[kind].file}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", rows: count };
}
