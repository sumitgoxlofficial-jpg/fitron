"use client";

import { useState } from "react";
import { Button, Notice } from "@/components/ui";

/** Sends a file to the import route and shows what it said. */
export function UploadForm({ kind, accept, label }: { kind: "osm" | "pin"; accept: string; label: string }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function send(fd: FormData) {
    setBusy(true);
    setMsg(null);
    fd.set("kind", kind);
    try {
      const res = await fetch("/api/crm/intel/import", { method: "POST", body: fd });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string } & Record<string, unknown>;
      setMsg(res.ok && j.ok ? { ok: true, text: Object.entries(j).filter(([k]) => k !== "ok").map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ") } : { ok: false, text: j.error ?? `Failed (HTTP ${res.status}).` });
    } catch {
      setMsg({ ok: false, text: "Couldn't reach the server." });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form action={send} className="flex flex-col gap-3">
      {msg && <Notice tone={msg.ok ? "ok" : "alert"}>{msg.text}</Notice>}
      <input type="file" name="file" accept={accept} required aria-label={label} className="text-sm" />
      <div><Button disabled={busy}>{busy ? "Working…" : label}</Button></div>
    </form>
  );
}
