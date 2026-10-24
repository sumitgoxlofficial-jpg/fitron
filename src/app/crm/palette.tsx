"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { flipTheme } from "@/components/theme-toggle";
import { paletteAction } from "./actions";

type Hit = { kind: "page" | "lead" | "action"; label: string; sub: string; href: string };
const ACTIONS: Hit[] = [
  { kind: "action", label: "Add a lead", sub: "Action", href: "/crm/leads?new=1" },
  { kind: "action", label: "Switch theme", sub: "Light or dark", href: "#theme" },
  { kind: "action", label: "Edit profile", sub: "Photo, phone, payout account", href: "/crm/profile" },
];
const SHORTCUTS = [["Ctrl K", "Open search"], ["↑ ↓", "Move"], ["Enter", "Open"], ["Esc", "Close"], ["?", "Show shortcuts"]];

/** The search bar from the design: Ctrl K opens it from anywhere; it finds pages, leads you may open, and a few actions. */
export function Palette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  const run = useCallback(async (text: string) => {
    const n = ++seq.current;
    const r = (await paletteAction(text)) as Hit[];
    if (n === seq.current) {
      const acts = ACTIONS.filter((a) => !text || a.label.toLowerCase().includes(text.toLowerCase()));
      setHits([...r, ...acts].slice(0, 14));
      setI(0);
    }
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement)?.tagName ?? "") || (e.target as HTMLElement)?.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setQ(""); setOpen((o) => !o); setHelp(false); }
      else if (e.key === "Escape") { setOpen(false); setHelp(false); }
      else if ((e.key === "?" || (e.key === "/" && e.shiftKey)) && !typing) { e.preventDefault(); setHelp((h) => !h); setOpen(false); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  // Opening shows the pages at once; typing waits a moment before asking the server, so each keystroke isn't a search.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void run(q), q ? 180 : 0);
    return () => clearTimeout(t);
  }, [q, open, run]);
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 30);
  }, [open]);

  const go = (h: Hit) => {
    setOpen(false);
    if (h.href === "#theme") flipTheme();
    else router.push(h.href);
  };

  return (
    <>
      <button type="button" onClick={() => { setQ(""); setOpen(true); }} aria-label="Search leads, gyms and pages" className="flex min-h-11 w-full max-w-[420px] items-center gap-2.5 rounded-xl border border-[var(--line-2)] bg-[var(--input)] px-3.5 text-left text-[13px] text-[var(--faint)] hover:border-[var(--accent)]">
        <MagnifyingGlassIcon size={16} weight="duotone" />
        <span className="flex-1 truncate">Search leads, gyms, pages…</span>
        <kbd className="rounded-md border border-[var(--line-2)] px-1.5 py-0.5 text-[10px] font-semibold">{mac ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 grid items-start justify-items-center bg-[rgba(6,5,3,.72)] p-5 pt-[12vh] backdrop-blur-[4px]" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="Search" className="flex max-h-[70vh] w-[min(560px,100%)] flex-col overflow-hidden rounded-[22px] border border-[var(--line-2)] bg-[var(--surface)] shadow-[var(--shadow-lg)]">
            <div className="flex items-center gap-2.5 border-b border-[var(--line)] px-4">
              <MagnifyingGlassIcon size={18} weight="duotone" className="text-[var(--accent)]" />
              <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search leads, gyms, pages and actions" aria-label="Search" role="combobox" aria-expanded="true" aria-controls="palette-list"
                onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(hits.length - 1, x + 1)); } else if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); } else if (e.key === "Enter" && hits[i]) go(hits[i]!); }}
                className="min-h-[54px] flex-1 border-0! bg-transparent! text-[15px] focus:outline-none" />
              <kbd className="rounded-md border border-[var(--line-2)] px-1.5 py-0.5 text-[10px] text-[var(--faint)]">Esc</kbd>
            </div>
            <ul id="palette-list" role="listbox" className="m-0 flex list-none flex-col gap-0.5 overflow-y-auto p-2">
              {hits.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-[var(--muted)]">Nothing found.</li>}
              {hits.map((h, n) => (
                <li key={`${h.kind}${h.href}${n}`} role="option" aria-selected={n === i}>
                  <button type="button" onMouseEnter={() => setI(n)} onClick={() => go(h)} className={`flex w-full items-center justify-between gap-3 rounded-[10px] px-3 py-2.5 text-left ${n === i ? "bg-[var(--accent-soft)]" : ""}`}>
                    <span className="min-w-0"><span className="block truncate text-sm font-semibold">{h.label}</span><span className="block truncate text-xs text-[var(--muted)]">{h.sub}</span></span>
                    <span className="shrink-0 text-[10px] font-semibold tracking-[0.16em] text-[var(--accent)] uppercase">{h.kind === "lead" ? "Lead" : h.kind === "page" ? "Go to" : "Action"}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {help && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[rgba(6,5,3,.72)] p-5 backdrop-blur-[4px]" onMouseDown={(e) => e.target === e.currentTarget && setHelp(false)}>
          <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" className="flex w-[min(380px,100%)] flex-col gap-3.5 rounded-[22px] border border-[var(--line-2)] bg-[var(--surface)] p-[26px]">
            <h2 className="m-0">Keyboard shortcuts</h2>
            <dl className="m-0 flex flex-col gap-2 text-[13px]">{SHORTCUTS.map(([k, d]) => <div key={k} className="flex items-center justify-between"><dt className="text-[var(--muted)]">{d}</dt><dd className="m-0"><kbd className="rounded-md border border-[var(--line-2)] px-2 py-0.5 text-xs font-semibold">{k}</kbd></dd></div>)}</dl>
            <button type="button" onClick={() => setHelp(false)} className="self-end rounded-full border border-[var(--line-2)] px-[18px] py-2 text-[13px] font-semibold">Close</button>
          </div>
        </div>
      )}
    </>
  );
}
