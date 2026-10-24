"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BookmarkSimpleIcon } from "@phosphor-icons/react";
import { deleteViewAction, saveViewAction } from "../actions";

/** Saved views: a set of filters kept under a name, private to you. */
export function ViewsBar({ views, current }: { views: { id: string; name: string; filters: Record<string, string> }[]; current: Record<string, string> }) {
  const router = useRouter();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const has = Object.values(current).some(Boolean);
  const open = (f: Record<string, string>) => router.push(`/crm/leads?${new URLSearchParams(f).toString()}`);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
      {views.length > 0 && (
        <label className="flex items-center gap-2 text-[var(--muted)]"><BookmarkSimpleIcon size={15} weight="duotone" />My views
          <select aria-label="My views" defaultValue="" onChange={(e) => { const v = views.find((x) => x.id === e.target.value); if (v) open(v.filters); e.target.value = ""; }} className="min-h-9 rounded-[10px] border border-[var(--line-2)] bg-[var(--input)] px-2.5">
            <option value="" disabled>Open a view…</option>{views.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
      )}
      {has && !naming && <button type="button" onClick={() => setNaming(true)} className="min-h-9 rounded-full border border-[var(--line-2)] px-3.5 text-xs font-semibold hover:border-[var(--accent)]">Save view</button>}
      {naming && (
        <form onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await saveViewAction(name, current); setMsg(r?.ok ? "" : (r?.message ?? "")); if (r?.ok) { setNaming(false); setName(""); router.refresh(); } }); }} className="flex items-center gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} aria-label="View name" placeholder="Name this view" maxLength={40} className="min-h-9 rounded-[10px] border border-[var(--line-2)] bg-[var(--input)] px-2.5" autoFocus />
          <button disabled={pending} className="min-h-9 rounded-full bg-gradient-to-b from-[#f3d88f] via-[#d9b45a] to-[#c49a3c] px-3.5 text-xs font-bold text-[#17140d]">Save</button>
          <button type="button" onClick={() => setNaming(false)} className="text-xs underline">Cancel</button>
        </form>
      )}
      {views.length > 0 && <details className="text-xs text-[var(--muted)]"><summary className="cursor-pointer">Manage</summary><ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">{views.map((v) => <li key={v.id} className="flex items-center gap-2">{v.name}<button type="button" onClick={() => start(async () => { await deleteViewAction(v.id); router.refresh(); })} className="text-[var(--alert-strong)] underline">Delete</button></li>)}</ul></details>}
      {msg && <span role="alert" className="text-xs text-[var(--alert-strong)]">{msg}</span>}
    </div>
  );
}
