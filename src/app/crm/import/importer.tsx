"use client";

import { useState, useTransition } from "react";
import { Button, Card, Field, Notice, ScrollRegion, Select, TABLE, TD, TH, TR } from "@/components/ui";
import { IMPORT_FIELDS, autoMapColumns, csvLine, type ImportField, type ImportResult } from "@/lib/domain/crm";
import { parseCsv } from "@/lib/domain/import";
import { importCommit, importPreview } from "../actions";

type Mapping = Partial<Record<ImportField, number>>;
type Preview = { results: ImportResult[]; valid: number; duplicates: number; errors: number };

/** Pick a CSV, check the column mapping, see every row's result, then import the valid ones. Nothing is written until "Import". */
export function Importer({ campaigns }: { campaigns: { id: string; name: string }[] }) {
  const [text, setText] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [map, setMap] = useState<Mapping>({});
  const [campaign, setCampaign] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<(Preview & { inserted: number }) | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const check = (t: string, m: Mapping) => {
    setError("");
    start(async () => {
      const r = await importPreview(t, m);
      if (r.ok) setPreview(r);
      else {
        setPreview(null);
        setError(r.message);
      }
    });
  };

  const onFile = async (f: File | undefined) => {
    setDone(null);
    setPreview(null);
    if (!f) return;
    const t = await f.text();
    const rows = parseCsv(t);
    setText(t);
    setFileName(f.name);
    setHeaders(rows[0] ?? []);
    const m = autoMapColumns(rows[0] ?? []);
    setMap(m);
    const missing = IMPORT_FIELDS.filter((x) => x.required && m[x.key] === undefined);
    if (missing.length) setError(`Map a column to ${missing.map((x) => x.label).join(", ")}.`);
    else check(t, m);
  };

  const setCol = (k: ImportField, v: string) => {
    const m = { ...map };
    if (v === "") delete m[k];
    else m[k] = Number(v);
    setMap(m);
    if (IMPORT_FIELDS.every((x) => !x.required || m[x.key] !== undefined)) check(text, m);
  };

  const commit = () =>
    start(async () => {
      const r = await importCommit(text, map, campaign);
      if (r.ok) {
        setDone(r);
        setPreview(null);
        setError("");
      } else setError(r.message);
    });

  const report = (results: ImportResult[]) => {
    const lines = [csvLine(["Row", "Contact", "Gym", "Phone", "Product", "Problem"])];
    for (const r of results) if (r.status !== "valid") lines.push(csvLine([r.n, r.row.contactName, r.row.gymName, r.row.phone ?? "", r.row.product ?? "", r.error]));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([`﻿${lines.join("\n")}\n`], { type: "text/csv" }));
    a.download = "import-errors.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const shown = done ?? preview;
  return (
    <div className="flex flex-col gap-5">
      {error && <Notice tone="alert">{error}</Notice>}
      {done && <Notice tone="ok">Imported {done.inserted} leads, unassigned. {done.duplicates} duplicates and {done.errors} rows with errors were skipped.</Notice>}
      <Card title="1 · Choose a file">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-muted">A CSV file with a header row (up to 2,000 rows). Phone numbers are cleaned to 10 digits before the duplicate check.</span>
          <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} className="text-sm" />
        </label>
        {fileName && <p className="mt-2 text-sm text-muted">{fileName} · {Math.max(0, parseCsv(text).length - 1)} rows</p>}
      </Card>

      {headers.length > 0 && (
        <Card title="2 · Column mapping">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {IMPORT_FIELDS.map((f) => (
              <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}`}>
                <Select value={map[f.key] ?? ""} onChange={(e) => setCol(f.key, e.target.value)}>
                  <option value="">— not in file —</option>
                  {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </Select>
              </Field>
            ))}
            <Field label="Campaign for these leads">
              <Select value={campaign} onChange={(e) => setCampaign(e.target.value)}><option value="">None</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
            </Field>
          </div>
        </Card>
      )}

      {shown && (
        <Card title={done ? "Result" : "3 · Preview"} action={<span className="text-sm text-muted">{shown.valid} valid · {shown.duplicates} duplicate · {shown.errors} error</span>}>
          <ScrollRegion label="Import preview">
            <table className={TABLE}>
              <thead><tr><th className={TH}>#</th><th className={TH}>Contact</th><th className={TH}>Gym</th><th className={TH}>Phone</th><th className={TH}>Product</th><th className={TH}>Result</th></tr></thead>
              <tbody>
                {shown.results.slice(0, 200).map((r) => (
                  <tr key={r.n} className={TR}>
                    <td className={TD}>{r.n}</td><td className={TD}>{r.row.contactName}</td><td className={TD}>{r.row.gymName}</td>
                    <td className={TD}>{r.row.phone ?? "—"}</td><td className={TD}>{r.row.product ?? "—"}</td>
                    <td className={`${TD} ${r.status === "valid" ? "text-ok" : "text-alert"}`}>{r.status === "valid" ? "Valid" : r.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
          {shown.results.length > 200 && <p className="mt-2 text-xs text-muted">Showing the first 200 of {shown.results.length} rows; all of them are checked.</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            {!done && <Button variant="primary" disabled={pending || shown.valid === 0} onClick={commit}>{pending ? "Working…" : `Import ${shown.valid} valid ${shown.valid === 1 ? "row" : "rows"}`}</Button>}
            {(shown.duplicates > 0 || shown.errors > 0) && <Button onClick={() => report(shown.results)}>Download error report</Button>}
          </div>
        </Card>
      )}
    </div>
  );
}
