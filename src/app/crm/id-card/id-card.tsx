"use client";

import { useRef, useState } from "react";

export type CardData = { name: string; role: string; dept: string; joined: string; phone: string; empId: string; initials: string; photo: string | null; qr: string };
type Pose = { rx: number; ry: number; auto: boolean };

const GHOST = "min-h-[42px] rounded-full border border-[var(--line-2)] px-[18px] text-[13px] font-semibold hover:border-[var(--accent)] hover:text-[var(--accent-strong)]";

/** The employee ID card from the design: drag it any way to turn it, flip it to the QR code, spin it a full 360° or let it turn on its own. */
export function IdCard({ d }: { d: CardData }) {
  const [c, setC] = useState<Pose>({ rx: 0, ry: 0, auto: false });
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ px: number; py: number; rx: number; ry: number } | null>(null);
  const face = "absolute inset-0 flex flex-col items-center overflow-hidden rounded-[22px] border border-[var(--line-2)] shadow-[0_30px_70px_-24px_rgba(0,0,0,.95),inset_0_1px_0_rgba(255,236,190,.18)] [backface-visibility:hidden]";
  return (
    <>
      <style>{"@keyframes idspin{from{transform:rotateY(0deg)}to{transform:rotateY(360deg)}} @media (prefers-reduced-motion:reduce){.idspin{animation:none!important}}"}</style>
      <div className="flex justify-center pt-6 pb-2" style={{ perspective: 1300 }}>
        <div
          className="h-[432px] w-[272px] cursor-grab touch-none select-none"
          onPointerDown={(e) => { start.current = { px: e.clientX, py: e.clientY, rx: c.rx, ry: c.ry }; setDragging(true); try { e.currentTarget.setPointerCapture(e.pointerId); } catch {} }}
          onPointerMove={(e) => { const s = start.current; if (s) setC((x) => ({ ...x, ry: s.ry + (e.clientX - s.px) * 0.7, rx: s.rx - (e.clientY - s.py) * 0.7 })); }}
          onPointerUp={() => { start.current = null; setDragging(false); }}
          onPointerCancel={() => { start.current = null; setDragging(false); }}
        >
          <div className="relative size-full [transform-style:preserve-3d]" style={{ transform: `rotateX(${c.rx}deg) rotateY(${c.ry}deg)`, transition: dragging ? "none" : "transform .9s cubic-bezier(.2,.8,.2,1)" }}>
            <div className="idspin absolute inset-0 [transform-style:preserve-3d]" style={{ animation: c.auto ? "idspin 7s linear infinite" : "none" }}>
              <div className={face} style={{ background: "radial-gradient(260px 200px at 50% 0%,rgba(217,180,90,.22),transparent 70%),linear-gradient(165deg,var(--surface-2) 0%,var(--input) 55%,var(--bg) 100%)" }}>
                <div className="flex items-center justify-between self-stretch px-[18px] pt-[18px]">
                  <div className="flex items-center gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element -- the site's own static logo */}
                    <img src="/site/fitron-ring-v2.png" alt="" width={30} height={30} draggable={false} className="block rounded-full" />
                    <span className="font-[var(--font-head)] text-[17px] font-semibold tracking-[0.08em]">FITRON</span>
                  </div>
                  <span className="text-[9px] font-bold tracking-[0.22em] text-[var(--accent)] uppercase">Employee</span>
                </div>
                <div className="mt-3.5 h-0.5 self-stretch" style={{ background: "linear-gradient(90deg,transparent,#a9791f,#efd79a,#a9791f,transparent)" }} />
                <div className="mt-[22px] size-[122px] rounded-full p-1" style={{ background: "conic-gradient(from 210deg,#a9791f,#efd79a,#d9b45a,#a9791f)" }}>
                  <div className="size-full rounded-full bg-[var(--bg)] p-[3px]">
                    {d.photo ? (
                      // eslint-disable-next-line @next/next/no-img-element -- private, session-checked image
                      <img src={d.photo} alt="Profile photo" draggable={false} className="size-full rounded-full object-cover" />
                    ) : (
                      <span className="grid size-full place-items-center rounded-full bg-[var(--surface-2)] font-[var(--font-head)] text-[38px] font-semibold text-[var(--accent-strong)]">{d.initials}</span>
                    )}
                  </div>
                </div>
                <span className="mt-4 px-4 text-center font-[var(--font-head)] text-[22px] leading-[1.1] font-semibold uppercase">{d.name}</span>
                <span className="mt-1 text-[10px] font-bold tracking-[0.22em] text-[var(--accent)] uppercase">{d.role}</span>
                <div className="mx-[22px] mt-[18px] flex flex-col gap-1.5 self-stretch text-[11px]">
                  {[["Department", d.dept], ["Joined", d.joined], ["Mobile", d.phone]].map(([k, v]) => <div key={k} className="flex justify-between gap-2"><span className="text-[var(--faint)]">{k}</span><span>{v}</span></div>)}
                </div>
                <div className="mt-auto flex flex-col items-center gap-0.5 self-stretch bg-gradient-to-b from-[#f3d88f] via-[#d9b45a] to-[#c49a3c] pt-3 pb-3.5 text-[#17140d]">
                  <span className="text-[8px] font-bold tracking-[0.26em] uppercase">Employee ID</span>
                  <span className="font-[var(--font-head)] text-[22px] font-semibold tracking-[0.1em]">{d.empId}</span>
                </div>
              </div>
              <div className={`${face} justify-center`} style={{ transform: "rotateY(180deg)", background: "linear-gradient(195deg,var(--surface-2) 0%,var(--input) 60%,var(--bg) 100%)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a generated QR code */}
                <img src={d.qr} alt="Employee QR code" draggable={false} className="box-content size-[196px] rounded-2xl bg-[var(--text)] p-3.5" />
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-2.5">
        <button type="button" className={GHOST} onClick={() => setC((x) => ({ ...x, rx: 0, ry: Math.round(x.ry / 180) * 180 + 180 }))}>Flip</button>
        <button type="button" className={GHOST} onClick={() => setC((x) => ({ ...x, ry: x.ry + 360 }))}>Spin 360°</button>
        <button type="button" aria-pressed={c.auto} onClick={() => setC((x) => ({ ...x, auto: !x.auto }))} className={`min-h-[42px] rounded-full px-[18px] text-[13px] font-bold ${c.auto ? "bg-gradient-to-b from-[#f3d88f] via-[#d9b45a] to-[#c49a3c] text-[#17140d]" : "bg-[var(--accent-soft)] text-[var(--accent-strong)]"}`}>{c.auto ? "Stop auto-rotate" : "Auto-rotate"}</button>
        <button type="button" className={GHOST} onClick={() => setC({ rx: 0, ry: 0, auto: false })}>Reset</button>
      </div>
    </>
  );
}
