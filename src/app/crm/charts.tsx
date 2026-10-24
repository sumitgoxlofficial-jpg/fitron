import { formatRupees } from "@/lib/format";

const W = 640;
const H = 200;

function paths(a: number[], b: number[]) {
  const max = Math.max(1, ...a, ...b);
  const x = (i: number) => (a.length < 2 ? 0 : (i / (a.length - 1)) * W);
  const y = (v: number) => H - 1 - (v / max) * (H - 12);
  const line = (v: number[]) => v.map((n, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(n).toFixed(1)}`).join(" ");
  return { max, line: line(a), line2: line(b), area: `${line(a)} L${W} ${H - 1} L0 ${H - 1} Z` };
}

/** Pipeline created against revenue approved, by week: the design's gold area and dashed line. */
export function TrendChart({ trend }: { trend: { labels: string[]; created: number[]; revenue: number[]; sumCreated: number; sumRevenue: number } }) {
  const p = paths(trend.created, trend.revenue);
  return (
    <figure className="m-0 flex flex-col gap-3">
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Pipeline created ${formatRupees(trend.sumCreated)} and revenue approved ${formatRupees(trend.sumRevenue)} over the last ${trend.labels.length} weeks`} className="block h-[200px] w-full overflow-visible">
          <defs><linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#d9b45a" stopOpacity=".38" /><stop offset="1" stopColor="#d9b45a" stopOpacity="0" /></linearGradient></defs>
          {[50, 100, 150].map((y) => <line key={y} x1="0" y1={y} x2={W} y2={y} style={{ stroke: "var(--line)", strokeWidth: 1 }} />)}
          <line x1="0" y1="199" x2={W} y2="199" style={{ stroke: "var(--line-2)", strokeWidth: 1 }} />
          <path d={p.area} fill="url(#trendFill)" />
          <path d={p.line} fill="none" style={{ stroke: "var(--accent)", strokeWidth: 2.5, strokeLinejoin: "round", strokeLinecap: "round" }} vectorEffect="non-scaling-stroke" />
          <path d={p.line2} fill="none" style={{ stroke: "var(--text)", strokeWidth: 2, strokeDasharray: "5 5" }} vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="absolute -top-1 left-0 text-[11px] text-[var(--faint)]">{formatRupees(p.max)}</span>
      </div>
      <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${trend.labels.length},1fr)` }}>{trend.labels.map((l, i) => <span key={i} className="text-center text-[10px] text-[var(--faint)]">{i % 2 === 0 ? l : ""}</span>)}</div>
      <figcaption className="flex flex-wrap gap-4 text-xs text-[var(--muted)]">
        <span className="flex items-center gap-1.5"><span className="h-[3px] w-3.5 rounded-sm bg-[var(--accent)]" />Pipeline created ({formatRupees(trend.sumCreated)})</span>
        <span className="flex items-center gap-1.5"><span className="w-3.5 border-t-2 border-dashed border-[var(--text)]" />Revenue approved ({formatRupees(trend.sumRevenue)})</span>
      </figcaption>
    </figure>
  );
}

/** A donut of two shares, with its legend. */
export function Donut({ items, total }: { items: { name: string; value: number; color: string }[]; total: string }) {
  const sum = items.reduce((a, i) => a + i.value, 0) || 1;
  let acc = 0;
  const stops = items.map((i) => { const from = (acc / sum) * 100; acc += i.value; return `${i.color} ${from}% ${(acc / sum) * 100}%`; }).join(", ");
  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative size-[150px] shrink-0 rounded-full" style={{ background: items.some((i) => i.value) ? `conic-gradient(${stops})` : "var(--line-soft)" }} role="img" aria-label={items.map((i) => `${i.name} ${Math.round((i.value / sum) * 100)}%`).join(", ")}>
        <div className="absolute inset-[22px] flex flex-col items-center justify-center rounded-full bg-[var(--surface)]"><span className="font-[var(--font-head)] text-[22px] font-semibold">{total}</span><span className="text-[11px] text-[var(--faint)]">pipeline</span></div>
      </div>
      <div className="flex min-w-40 flex-col gap-2.5">
        {items.map((i) => (
          <div key={i.name} className="flex items-start gap-2"><span className="mt-1 size-2.5 rounded-[3px]" style={{ background: i.color }} /><span className="flex flex-col"><span className="text-[13px] font-semibold">{i.name} · {Math.round((i.value / sum) * 100)}%</span><span className="text-xs text-[var(--faint)]">{formatRupees(i.value)}</span></span></div>
        ))}
      </div>
    </div>
  );
}
