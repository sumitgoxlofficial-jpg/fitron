"use client";

import { useRef, useState, useTransition } from "react";
import { initials } from "@/lib/format";
import { removePhotoAction, savePhotoAction } from "../actions";

const STAGE = 260; // the crop stage, px
const WINDOW = 240; // the round window inside it

type Crop = { src: string; w: number; h: number; zoom: number; x: number; y: number };

/** The profile picture from the design: a gold ring, a + to change it, and a drag-and-zoom crop before it is saved as a 320px square. */
export function PhotoPicker({ userId, name, hasPhoto, tag }: { userId: string; name: string; hasPhoto: boolean; tag: string }) {
  const file = useRef<HTMLInputElement>(null);
  const [crop, setCrop] = useState<Crop | null>(null);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const img = useRef<HTMLImageElement | null>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  const geom = (c: Crop) => {
    const sc = Math.max(STAGE / c.w, STAGE / c.h) * c.zoom;
    const W = c.w * sc;
    const H = c.h * sc;
    return { W, H, mx: Math.max(0, (W - WINDOW) / 2), my: Math.max(0, (H - WINDOW) / 2) };
  };
  const clamp = (c: Crop): Crop => {
    const g = geom(c);
    return { ...c, x: Math.max(-g.mx, Math.min(g.mx, c.x)), y: Math.max(-g.my, Math.min(g.my, c.y)) };
  };

  const pick = (f: File | undefined) => {
    setMsg("");
    if (!f) return;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return setMsg("Choose a JPG, PNG or WebP image.");
    if (f.size > 5 * 1024 * 1024) return setMsg("That photo is over 5 MB. Choose a smaller one.");
    const rd = new FileReader();
    rd.onload = () => {
      const im = new Image();
      im.onload = () => {
        img.current = im;
        setCrop({ src: String(rd.result), w: im.naturalWidth, h: im.naturalHeight, zoom: 1, x: 0, y: 0 });
      };
      im.onerror = () => setMsg("That file could not be read as an image.");
      im.src = String(rd.result);
    };
    rd.readAsDataURL(f);
  };

  const save = () => {
    if (!crop || !img.current) return;
    const g = geom(crop);
    const O = 320;
    const r = O / WINDOW;
    const cv = document.createElement("canvas");
    cv.width = cv.height = O;
    const ctx = cv.getContext("2d")!;
    ctx.fillStyle = "#0e0d0a";
    ctx.fillRect(0, 0, O, O);
    ctx.drawImage(img.current, O / 2 + crop.x * r - (g.W * r) / 2, O / 2 + crop.y * r - (g.H * r) / 2, g.W * r, g.H * r);
    cv.toBlob((blob) => {
      if (!blob) return setMsg("Couldn't prepare that photo.");
      const fd = new FormData();
      fd.set("photo", new File([blob], "photo.jpg", { type: "image/jpeg" }));
      start(async () => {
        const res = await savePhotoAction(fd);
        setMsg(res?.ok ? "" : (res?.message ?? "Couldn't save the photo."));
        if (res?.ok) setCrop(null);
      });
    }, "image/jpeg", 0.85);
  };

  const g = crop ? geom(crop) : null;
  return (
    <div className="flex flex-wrap items-center gap-[22px]">
      <button type="button" onClick={() => file.current?.click()} aria-label="Change profile photo" className="relative size-28 shrink-0 rounded-full border-0 p-1 hover:brightness-110" style={{ background: "conic-gradient(from 210deg,#a9791f,#efd79a,#d9b45a,#a9791f)" }}>
        <span className="block size-full rounded-full bg-[var(--bg)] p-[3px]">
          {hasPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element -- private, session-checked image
            <img src={`/api/crm/photo/${userId}?v=${tag}`} alt="Profile photo" className="size-full rounded-full object-cover" />
          ) : (
            <span className="grid size-full place-items-center rounded-full bg-[var(--surface-2)] font-[var(--font-head)] text-[34px] font-semibold text-[var(--accent-strong)]">{initials(name)}</span>
          )}
        </span>
        <span aria-hidden="true" className="absolute right-0.5 bottom-0.5 grid size-[30px] place-items-center rounded-full border-[3px] border-[var(--bg)] bg-gradient-to-b from-[#f3d88f] via-[#d9b45a] to-[#c49a3c] text-lg leading-none font-bold text-[#17140d]">+</span>
      </button>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap gap-3.5">
          <button type="button" onClick={() => file.current?.click()} className="p-0 text-[13px] font-bold text-[var(--accent)]">{hasPhoto ? "Change photo" : "Add profile photo"}</button>
          {hasPhoto && <button type="button" disabled={pending} onClick={() => start(async () => void (await removePhotoAction()))} className="p-0 text-[13px] font-semibold text-[var(--alert-strong)]">Remove photo</button>}
        </div>
        <span className="text-[11px] text-[var(--faint)]">JPG, PNG or WebP, up to 5 MB.</span>
        {msg && <span role="alert" className="text-xs text-[var(--alert-strong)]">{msg}</span>}
      </div>
      <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />

      {crop && g && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[rgba(6,5,3,.72)] p-5 backdrop-blur-[4px]" role="dialog" aria-modal="true" aria-label="Crop your photo">
          <div className="flex w-[min(360px,100%)] flex-col items-center gap-4 rounded-[22px] border border-[var(--line-2)] bg-[var(--surface)] p-[26px]">
            <h2 className="m-0">Crop your photo</h2>
            <span className="text-xs text-[var(--muted)]">Drag to move, use the slider to zoom.</span>
            <div
              className="relative touch-none overflow-hidden rounded-xl bg-black"
              style={{ width: STAGE, height: STAGE, cursor: "grab" }}
              onPointerDown={(e) => { drag.current = { px: e.clientX, py: e.clientY, x: crop.x, y: crop.y }; e.currentTarget.setPointerCapture(e.pointerId); }}
              onPointerMove={(e) => { const d = drag.current; if (d) setCrop(clamp({ ...crop, x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py })); }}
              onPointerUp={() => (drag.current = null)}
              onPointerCancel={() => (drag.current = null)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- a local preview */}
              <img src={crop.src} alt="" draggable={false} className="pointer-events-none absolute max-w-none select-none" style={{ width: g.W, height: g.H, left: STAGE / 2 - g.W / 2 + crop.x, top: STAGE / 2 - g.H / 2 + crop.y }} />
              <span className="pointer-events-none absolute rounded-full" style={{ width: WINDOW, height: WINDOW, left: (STAGE - WINDOW) / 2, top: (STAGE - WINDOW) / 2, boxShadow: "0 0 0 999px rgba(6,5,3,.62), inset 0 0 0 2px #d9b45a" }} />
            </div>
            <input type="range" aria-label="Zoom" min={1} max={3} step={0.01} value={crop.zoom} onChange={(e) => setCrop(clamp({ ...crop, zoom: Number(e.target.value) }))} className="w-full accent-[var(--accent)]" />
            <div className="flex w-full justify-end gap-2.5">
              <button type="button" onClick={() => setCrop(null)} className="min-h-11 rounded-full border border-[var(--line-2)] px-[18px] text-[13px] font-semibold">Cancel</button>
              <button type="button" disabled={pending} onClick={save} className="min-h-11 rounded-full bg-gradient-to-b from-[#f3d88f] via-[#d9b45a] to-[#c49a3c] px-[22px] text-[13px] font-bold text-[#17140d] disabled:opacity-60">{pending ? "Saving…" : "Save photo"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
