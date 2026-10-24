"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { PRIORITIES, STAGES, stageLabel } from "@/lib/domain/crm";
import { formatRupees } from "@/lib/format";
import { bulkAction } from "../actions";

export type Row = { id: string; gymName: string; contactName: string; phone: string; city: string | null; plan: string; stage: string; verification: string | null; ownerName: string | null; estValue: number; createdLabel: string };

const sel = "min-h-9 rounded-[10px] border border-[var(--line-2)] bg-[var(--input)] px-2.5 text-[13px]";
const tone = (stage: string) => (stage === "Closed Won" ? "bg-[var(--ok-soft)] text-[var(--ok)]" : stage === "Closed Lost" ? "bg-[var(--alert-soft)] text-[var(--alert)]" : "bg-[var(--accent-soft)] text-[var(--accent-strong)]");

/** The leads table, with a checkbox on each row and a bar for changing many at once. Each lead is changed through the same checks as on its own page; the ones a role may not change are listed and the rest still go through. */
export function LeadsTable({ rows, owners, canAssign, canLog }: { rows: Row[]; owners: { id: string; name: string }[]; canAssign: boolean; canLog: boolean }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [owner, setOwner] = useState("");
  const [priority, setPriority] = useState("");
  const [stage, setStage] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string; failed: { id: string; reason: string }[] } | null>(null);
  const [pending, start] = useTransition();
  const all = rows.length > 0 && picked.length === rows.length;
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const apply = (op: Parameters<typeof bulkAction>[1]) =>
    start(async () => {
      const r = await bulkAction(picked, op);
      setMsg(r.ok ? { ok: r.failed.length === 0, text: `${r.done} updated${r.failed.length ? `, ${r.failed.length} not changed` : ""}.`, failed: r.failed } : { ok: false, text: r.message, failed: [] });
      if (r.ok) setPicked([]);
    });
  const bulk = canAssign || canLog;
  return (
    <div className="flex flex-col gap-3">
      {bulk && picked.length > 0 && (
        <div className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-[var(--line-2)] bg-[var(--surface)] px-4 py-3" role="region" aria-label="Change the selected leads">
          <b className="text-[13px]">{picked.length} selected</b>
          {canAssign && <><select aria-label="Assign to" value={owner} onChange={(e) => setOwner(e.target.value)} className={sel}><option value="">Assign to…</option><option value="none">Unassigned</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select><button type="button" disabled={!owner || pending} onClick={() => apply({ kind: "owner", ownerId: owner === "none" ? null : owner })} className="min-h-9 rounded-full border border-[var(--line-2)] px-3.5 text-xs font-semibold disabled:opacity-40">Assign</button></>}
          {canLog && <><select aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)} className={sel}><option value="">Priority…</option>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select><button type="button" disabled={!priority || pending} onClick={() => apply({ kind: "priority", value: priority })} className="min-h-9 rounded-full border border-[var(--line-2)] px-3.5 text-xs font-semibold disabled:opacity-40">Set</button>
            <select aria-label="Move to stage" value={stage} onChange={(e) => setStage(e.target.value)} className={sel}><option value="">Move to…</option>{STAGES.filter((s) => !["Closed Won", "Closed Lost", "Disqualified"].includes(s)).map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}</select><button type="button" disabled={!stage || pending} onClick={() => apply({ kind: "stage", to: stage })} className="min-h-9 rounded-full border border-[var(--line-2)] px-3.5 text-xs font-semibold disabled:opacity-40">Move</button></>}
          <button type="button" onClick={() => setPicked([])} className="ml-auto text-xs underline">Clear</button>
        </div>
      )}
      {msg && (
        <div role="status" className={`rounded-xl px-3.5 py-2.5 text-[13px] ${msg.ok ? "bg-[var(--ok-soft)] text-[var(--ok)]" : "bg-[var(--alert-soft)] text-[var(--alert-strong)]"}`}>
          {msg.text}{msg.failed.length > 0 && <ul className="m-0 mt-1.5 list-disc pl-5 text-xs">{msg.failed.slice(0, 8).map((f) => <li key={f.id}>{f.id}: {f.reason}</li>)}</ul>}
        </div>
      )}
      <div className="overflow-x-auto" role="region" aria-label="Leads" tabIndex={0}>
        <table className="w-full border-collapse text-sm">
          <thead><tr className="border-b border-[var(--line)] text-left text-[11px] font-bold tracking-[0.08em] whitespace-nowrap text-[var(--muted)] uppercase">
            {bulk && <th className="w-10 p-2.5"><input type="checkbox" aria-label="Select all on this page" checked={all} onChange={() => setPicked(all ? [] : rows.map((r) => r.id))} className="size-[18px] accent-[var(--accent)]" /></th>}
            {["ID", "Gym / contact", "City", "Plan", "Stage", "Owner", "Value", "Added"].map((h, i) => <th key={h} className={`p-2.5 ${i === 6 ? "text-right" : ""}`}>{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id} className={`border-b border-[var(--line-soft)] hover:bg-[var(--neutral-100)] ${picked.includes(l.id) ? "bg-[var(--accent-soft)]" : ""}`}>
                {bulk && <td className="p-2.5"><input type="checkbox" aria-label={`Select ${l.gymName}`} checked={picked.includes(l.id)} onChange={() => toggle(l.id)} className="size-[18px] accent-[var(--accent)]" /></td>}
                <td className="p-2.5"><Link href={`/crm/leads/${l.id}`} className="font-semibold text-[var(--accent)] hover:underline">{l.id}</Link></td>
                <td className="p-2.5"><div className="font-semibold">{l.gymName}</div><div className="text-xs text-[var(--muted)]">{l.contactName} · {l.phone}</div></td>
                <td className="p-2.5">{l.city ?? "—"}</td><td className="p-2.5 text-xs">{l.plan}</td>
                <td className="p-2.5"><div className="flex flex-wrap gap-1"><span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${tone(l.stage)}`}>{stageLabel(l.stage)}</span>{l.verification && <span className="rounded-full border border-[var(--line-2)] px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap">{l.verification === "Pending" ? "Pending verification" : l.verification}</span>}</div></td>
                <td className="p-2.5">{l.ownerName ?? <span className="text-[var(--alert)]">Unassigned</span>}</td>
                <td className="p-2.5 text-right tabular-nums">{l.estValue ? formatRupees(l.estValue) : "—"}</td><td className="p-2.5 whitespace-nowrap">{l.createdLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
