"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDownIcon, ArrowUpIcon, EyeIcon, EyeSlashIcon, SquaresFourIcon } from "@phosphor-icons/react";
import { WIDGET_LABEL, defaultLayout, move, type Layout } from "@/lib/domain/crm-dash";
import type { CrmRole } from "@/lib/domain/crm";
import { layoutAction } from "./actions";

/** Tiles or Focus, and the Customize panel: reorder widgets with the arrows, hide the ones you don't use, reset. Saved with the person. */
export function DashControls({ role, layout }: { role: CrmRole; layout: Layout }) {
  const router = useRouter();
  const [l, setL] = useState(layout);
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const save = (next: Layout) => {
    setL(next);
    start(async () => {
      const r = await layoutAction(next);
      setMsg(r?.ok ? "" : (r?.message ?? "Couldn't save the layout."));
      router.refresh();
    });
  };
  const seg = (m: Layout["mode"], text: string) => (
    <button type="button" aria-pressed={l.mode === m} onClick={() => save({ ...l, mode: m })} className={`min-h-[34px] rounded-full px-[18px] text-[13px] font-bold ${l.mode === m ? "bg-gradient-to-b from-[#f3d88f] via-[#d9b45a] to-[#c49a3c] text-[#17140d]" : ""}`}>{text}</button>
  );
  return (
    <div className="flex flex-col items-end gap-3">
      <div className="flex flex-wrap items-center justify-end gap-2.5">
        <button type="button" aria-expanded={editing} onClick={() => setEditing(!editing)} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[var(--line-2)] px-4 text-[13px] font-semibold hover:border-[var(--accent)]"><SquaresFourIcon size={16} weight="duotone" />{editing ? "Done" : "Customize"}</button>
        <div className="flex gap-1 rounded-full border border-[var(--line)] p-1" role="group" aria-label="Layout">{seg("tiles", "Tiles")}{seg("focus", "Focus")}</div>
      </div>
      {editing && (
        <section className="w-full min-w-[300px] rounded-2xl border border-dashed border-[var(--line-2)] bg-[var(--surface)] p-4 sm:w-[420px]" aria-label="Customize your dashboard">
          <div className="mb-1 flex items-center gap-2 font-semibold"><SquaresFourIcon size={16} weight="duotone" className="text-[var(--accent)]" />Customizing your dashboard</div>
          <p className="m-0 mb-3 text-[13px] text-[var(--muted)]">Move widgets with the arrows and hide the ones you don&apos;t need. Your layout is saved to your account.</p>
          <ol className="m-0 flex list-none flex-col gap-1 p-0">
            {l.order.map((w, i) => {
              const hidden = l.hidden.includes(w);
              return (
                <li key={w} className={`flex items-center gap-1.5 rounded-[10px] border border-[var(--line)] px-2.5 py-1.5 text-[13px] ${hidden ? "opacity-55" : ""}`}>
                  <span className="flex-1">{WIDGET_LABEL[w]}</span>
                  <button type="button" aria-label={`Move ${WIDGET_LABEL[w]} up`} disabled={i === 0 || pending} onClick={() => save({ ...l, order: move(l.order, w, -1) })} className="grid size-8 place-items-center rounded-full hover:bg-[var(--neutral-100)] disabled:opacity-30"><ArrowUpIcon size={14} /></button>
                  <button type="button" aria-label={`Move ${WIDGET_LABEL[w]} down`} disabled={i === l.order.length - 1 || pending} onClick={() => save({ ...l, order: move(l.order, w, 1) })} className="grid size-8 place-items-center rounded-full hover:bg-[var(--neutral-100)] disabled:opacity-30"><ArrowDownIcon size={14} /></button>
                  {w !== "kpis" && <button type="button" aria-label={`${hidden ? "Show" : "Hide"} ${WIDGET_LABEL[w]}`} aria-pressed={!hidden} disabled={pending} onClick={() => save({ ...l, hidden: hidden ? l.hidden.filter((x) => x !== w) : [...l.hidden, w] })} className="grid size-8 place-items-center rounded-full hover:bg-[var(--neutral-100)]">{hidden ? <EyeSlashIcon size={16} /> : <EyeIcon size={16} />}</button>}
                </li>
              );
            })}
          </ol>
          <div className="mt-3 flex items-center justify-between gap-2"><button type="button" disabled={pending} onClick={() => save(defaultLayout(role))} className="rounded-full border border-[var(--line-2)] px-3.5 py-2 text-xs font-semibold">Reset layout</button><span role="status" className="text-xs text-[var(--alert-strong)]">{msg}</span></div>
        </section>
      )}
    </div>
  );
}
