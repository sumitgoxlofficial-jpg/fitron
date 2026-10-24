"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { stageLabel } from "@/lib/domain/crm";
import { formatRupees } from "@/lib/format";
import { moveCard } from "../actions";

export type Card = { id: string; gymName: string; product: string; city: string | null; estValue: number; ownerName: string | null; priority: string; locked: boolean; verification: string | null };
const NEEDS_DETAILS = ["Closed Won", "Closed Lost", "Disqualified"];

/** The Kanban board. A drop goes through the same rules as the lead page: stages that need a reason or proof open the lead, the rest move at once. */
export function Board({ columns, canMove }: { columns: { stage: string; cards: Card[]; total: number }[]; canMove: boolean }) {
  const router = useRouter();
  const [over, setOver] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const drop = (stage: string, e: React.DragEvent) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData("text/plain");
    if (!id || !canMove) return;
    if (NEEDS_DETAILS.includes(stage)) return router.push(`/crm/leads/${id}?move=${encodeURIComponent(stage)}`);
    start(async () => {
      const r = await moveCard(id, stage);
      setMsg(r.ok ? "" : (r.message ?? "That move isn't allowed."));
      router.refresh();
    });
  };
  return (
    <>
      <div role="status" aria-live="polite" className="mb-2 min-h-5 text-sm text-alert">{msg}</div>
      <div className={`flex gap-3 overflow-x-auto pb-3 ${pending ? "opacity-70" : ""}`}>
        {columns.map((c) => (
          <section key={c.stage} aria-label={stageLabel(c.stage)} onDragOver={(e) => canMove && (e.preventDefault(), setOver(c.stage))} onDragLeave={() => setOver(null)} onDrop={(e) => drop(c.stage, e)}
            className={`flex w-[250px] shrink-0 flex-col gap-2 rounded-lg border bg-surface p-2.5 ${over === c.stage ? "border-accent" : "border-line"}`}>
            <h2 className="flex items-baseline justify-between px-1 text-[11px] font-bold tracking-[0.08em] text-muted uppercase"><span>{stageLabel(c.stage)}</span><span>{c.total}</span></h2>
            {c.cards.map((l) => (
              <Link key={l.id} href={`/crm/leads/${l.id}`} draggable={canMove && !l.locked} onDragStart={(e) => e.dataTransfer.setData("text/plain", l.id)}
                className="rounded-md border border-line bg-bg px-3 py-2.5 text-sm hover:border-accent">
                <div className="font-semibold">{l.gymName}</div>
                <div className="text-xs text-muted">{l.product === "SaaS" ? "SaaS" : "Partnership"}{l.city ? ` · ${l.city}` : ""}{l.estValue ? ` · ${formatRupees(l.estValue)}` : ""}</div>
                <div className="mt-1 flex justify-between text-xs"><span className="text-muted">{l.ownerName ?? "Unassigned"}</span><span>{l.verification === "Pending" ? "Pending" : l.priority}</span></div>
              </Link>
            ))}
            {c.total > c.cards.length && <div className="px-1 text-xs text-muted">+ {c.total - c.cards.length} more: use Leads</div>}
          </section>
        ))}
      </div>
    </>
  );
}
