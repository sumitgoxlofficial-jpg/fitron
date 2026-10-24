import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, type Tone } from "@/components/ui";
import { stageLabel } from "@/lib/domain/crm";
import { formatRupees } from "@/lib/format";

const TONE: Record<string, Tone> = { "Closed Won": "ok", "Closed Lost": "alert", Disqualified: "neutral" };
export const StageBadge = ({ stage }: { stage: string }) => <Badge tone={TONE[stage] ?? "accent"}>{stageLabel(stage)}</Badge>;

export function VerificationBadge({ v }: { v: string | null }) {
  if (!v) return null;
  return <Badge tone={v === "Verified" ? "ok" : v === "Rejected" ? "alert" : "neutral"}>{v === "Pending" ? "Pending verification" : v}</Badge>;
}

export const Money = ({ paise }: { paise: number }) => <span className="tabular-nums">{formatRupees(paise)}</span>;
export const pctText = (n: number | null) => (n === null ? "—" : `${n}%`);

/** A figure with a caption, in the console's stat style. */
export function Kpi({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "alert" }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3.5">
      <div className="text-[11px] tracking-[0.08em] text-muted uppercase">{label}</div>
      <div className={`text-[26px] font-semibold tabular-nums ${tone === "alert" ? "text-alert" : ""}`}>{value}</div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </div>
  );
}

export const KpiGrid = ({ children }: { children: ReactNode }) => <div className="mb-6 grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-4">{children}</div>;

export const LeadLink = ({ id, children }: { id: string; children?: ReactNode }) => (
  <Link href={`/crm/leads/${id}`} className="font-semibold text-accent underline-offset-2 hover:underline">
    {children ?? id}
  </Link>
);

/** A horizontal bar for a count against the largest. */
export function Bars({ rows, max }: { rows: [string, number][]; max?: number }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r[1]));
  return (
    <ul className="flex flex-col gap-2">
      {rows.map(([k, n]) => (
        <li key={k} className="grid grid-cols-[minmax(90px,150px)_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate">{k}</span>
          <span className="h-2 overflow-hidden rounded-full bg-fg/8"><span className="block h-full rounded-full bg-accent" style={{ width: `${(n / top) * 100}%` }} /></span>
          <span className="tabular-nums text-muted">{n}</span>
        </li>
      ))}
    </ul>
  );
}
