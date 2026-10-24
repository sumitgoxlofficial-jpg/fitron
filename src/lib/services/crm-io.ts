import "server-only";
import { db } from "@/lib/db";
import { IMPORT_FIELDS, MAX_IMPORT_ROWS, checkImport, csvLine, stageLabel, type ImportField, type ImportResult } from "@/lib/domain/crm";
import { parseCsv } from "@/lib/domain/import";
import { crmAudit, need, noteDenied, type CrmUser } from "./crm-access";
import { leadWhere, type LeadFilter } from "./crm-leads";
import { UserError } from "./errors";
import { todayIso } from "./time";

/** Turns the uploaded file into rows keyed by CRM field, using the person's column mapping (field → column index). */
function rowsFrom(text: string, mapping: Partial<Record<ImportField, number>>) {
  const table = parseCsv(text).filter((r) => r.some((c) => c.trim()));
  if (table.length < 2) throw new UserError("The file has no rows to import.");
  const body = table.slice(1);
  if (body.length > MAX_IMPORT_ROWS) throw new UserError(`The file has ${body.length.toLocaleString("en-IN")} rows; import at most ${MAX_IMPORT_ROWS.toLocaleString("en-IN")} at a time.`);
  for (const f of IMPORT_FIELDS.filter((x) => x.required)) if (mapping[f.key] === undefined) throw new UserError(`Map a column to "${f.label}".`);
  return { headers: table[0]!, rows: body.map((r) => Object.fromEntries(IMPORT_FIELDS.map((f) => [f.key, mapping[f.key] === undefined ? "" : (r[mapping[f.key]!] ?? "")]))) };
}

const existingPhones = async (phones: string[]) => new Map((await db.crmLead.findMany({ where: { phone: { in: phones } }, select: { phone: true, id: true } })).map((l) => [l.phone, l.id]));

/** Checks a file without writing anything. */
export async function previewImport(u: CrmUser, text: string, mapping: Partial<Record<ImportField, number>>) {
  need(u, "leads.import");
  const { rows } = rowsFrom(text, mapping);
  const results = checkImport(rows, await existingPhones(rows.map((r) => String(r.phone).replace(/\D/g, "").slice(-10))));
  return summarise(results);
}

const summarise = (results: ImportResult[]) => ({ results, valid: results.filter((r) => r.status === "valid").length, duplicates: results.filter((r) => r.status === "duplicate").length, errors: results.filter((r) => r.status === "invalid").length });

/** Inserts the valid rows, all together and unassigned; the rest are reported, never written. The checks run again here, on the server, whatever the preview showed. */
export async function commitImport(u: CrmUser, text: string, mapping: Partial<Record<ImportField, number>>, campaignId?: string) {
  need(u, "leads.import");
  const campaign = campaignId ? await db.crmCampaign.findUnique({ where: { id: campaignId } }) : null;
  if (campaignId && !campaign) throw new UserError("That campaign doesn't exist.");
  const { rows } = rowsFrom(text, mapping);
  const results = checkImport(rows, await existingPhones(rows.map((r) => String(r.phone).replace(/\D/g, "").slice(-10))));
  const valid = results.filter((r): r is Extract<ImportResult, { status: "valid" }> => r.status === "valid");
  const inserted = await db.$transaction(async (tx) => {
    let made = 0;
    for (const r of valid) {
      const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('"CrmLeadSeq"') AS n`;
      // skipDuplicates: if someone added the same number a moment ago, that row is skipped rather than failing the whole file.
      const c = await tx.crmLead.createMany({
        data: [{ id: `FL-${n}`, contactName: r.row.contactName, gymName: r.row.gymName, phone: r.row.phone, altPhone: r.row.altPhone, email: r.row.email, city: r.row.city, district: r.row.district, state: r.row.state, pin: r.row.pin, address: r.row.address, product: r.row.product, estValue: r.row.estValue, campaignId: campaign?.id ?? null, source: campaign?.source ?? "Other", createdById: u.id }],
        skipDuplicates: true,
      });
      made += c.count;
    }
    const s = summarise(results);
    await crmAudit(tx, { actorId: u.id, kind: "import", text: `Imported ${made} leads · ${s.duplicates} duplicates and ${s.errors} errors skipped`, meta: { rows: results.length, inserted: made, duplicates: s.duplicates, errors: s.errors } });
    return made;
  });
  return { ...summarise(results), inserted };
}

/** The rows that weren't imported, as a CSV the person can fix and upload again. */
export function errorReportCsv(results: ImportResult[]) {
  const lines = [csvLine(["Row", "Contact", "Gym", "Phone", "Product", "Problem"])];
  for (const r of results) if (r.status !== "valid") lines.push(csvLine([r.n, r.row.contactName, r.row.gymName, r.row.phone ?? "", r.row.product ?? "", r.error]));
  return lines.join("\n") + "\n";
}

export const importErrorCsv = async (u: CrmUser, text: string, mapping: Partial<Record<ImportField, number>>) => errorReportCsv((await previewImport(u, text, mapping)).results);

/** CSV of the current filtered list. A role without export permission is refused, and the attempt is recorded. Phones are masked unless the role sees them in full. Every export is audited with how many rows, never which. */
export async function exportLeads(u: CrmUser, f: LeadFilter) {
  if (!u.can("leads.export")) {
    await noteDenied(u, "tried to export leads");
    await crmAudit(db, { actorId: u.id, kind: "export", text: "Export blocked: this role can't export" });
    throw new UserError("Your role can't export leads.");
  }
  const where = leadWhere(u, f);
  const rows = await db.crmLead.findMany({ where, include: { campaign: { select: { name: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 10_000 });
  const owners = await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.ownerId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
  const nm = new Map(owners.map((o) => [o.id, o.name]));
  const full = u.can("phone.full");
  const mask = (p: string | null) => (!p ? "" : full ? p : `${p.slice(0, 2)}••••••${p.slice(-2)}`);
  const lines = [csvLine(["Lead ID", "Contact", "Gym", "Phone", "City", "State", "Product", "Stage", "Owner", "Campaign", "Source", "Value (₹)", "Verification", "Created"])];
  for (const r of rows) lines.push(csvLine([r.id, r.contactName, r.gymName, mask(r.phone), r.city, r.state, r.product, stageLabel(r.stage), r.ownerId ? (nm.get(r.ownerId) ?? "") : "Unassigned", r.campaign?.name ?? "", r.source, Math.round(r.estValue / 100), r.verification ?? "", r.createdAt.toISOString().slice(0, 10)]));
  await crmAudit(db, { actorId: u.id, kind: "export", text: `Exported ${rows.length} leads${full ? "" : " (phones masked)"}`, meta: { rows: rows.length } });
  return { csv: lines.join("\n") + "\n", rows: rows.length, fileName: `fitron-leads-${todayIso()}.csv` };
}
