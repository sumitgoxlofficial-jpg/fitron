import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCrm } from "@/lib/auth/crm";
import { AGENT_PROMPT, FIRST_MESSAGE } from "@/lib/domain/ai-calling/prompt";
import { fmtMinutes } from "@/lib/domain/ai-calling/time";
import type { Offer } from "@/lib/domain/ai-calling/offer";
import { campaignPreview } from "@/lib/services/ai-calling/campaigns";
import { listCalls } from "@/lib/services/ai-calling/reports";
import { UserError } from "@/lib/services/errors";
import { Badge, Card, Notice, PageHeader, ScrollRegion, TABLE, TD, TH, TR } from "@/components/ui";
import { CrmForm } from "../../../crm-form";
import { campaignStepAction } from "../../actions";
import { CallStatusBadge, CampaignBadge, DispositionBadge, mmss, when } from "../../parts";

export const metadata = { title: "AI campaign · FITRON CRM" };

export default async function CampaignPage({ params }: PageProps<"/crm/calling/campaigns/[id]">) {
  const u = await requireCrm("calling.view");
  const { id } = await params;
  const pv = await campaignPreview(u, id).catch((e) => (e instanceof UserError ? null : Promise.reject(e)));
  if (!pv) notFound();
  const c = pv.campaign;
  const offer = c.offer as unknown as Offer;
  const calls = await listCalls(u, { campaignId: id });
  const step = (s: string, label: string, variant?: "danger" | "primary", extra?: React.ReactNode) => (
    <CrmForm action={campaignStepAction} submit={label} variant={variant} className="flex flex-wrap items-end gap-3"><input type="hidden" name="id" value={id} /><input type="hidden" name="step" value={s} />{extra}</CrmForm>
  );
  return (
    <>
      <PageHeader kicker={<Link href="/crm/calling/campaigns" className="underline">Campaigns</Link>} title={c.name} subtitle={<span className="inline-flex flex-wrap items-center gap-2"><CampaignBadge s={c.status} />{c.testMode && <Badge>test numbers only</Badge>}Up to {c.maxCalls} calls, {c.concurrency} at once, {fmtMinutes(c.hoursFrom)}–{fmtMinutes(c.hoursTo)} India time.</span>} />
      <div className="mb-5 flex flex-wrap items-start gap-4">
        {c.status === "DRAFT" && step("approve", "Approve", "primary", <label className="flex max-w-md items-start gap-2 text-sm"><input type="checkbox" name="reviewed" required /> I have reviewed the script, the offer and the audience below.</label>)}
        {c.status === "APPROVED" && step("start", "Start", "primary")}
        {c.status === "RUNNING" && step("pause", "Pause")}
        {c.status === "PAUSED" && step("resume", "Resume", "primary")}
        {["DRAFT", "APPROVED", "RUNNING", "PAUSED"].includes(c.status) && step("stop", "Stop for good", "danger")}
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card title="Audience now">
          <p className="mb-2 text-sm"><strong>{pv.callable}</strong> of {pv.total} leads can be called. The rest are held back:</p>
          {pv.held.length ? <ul className="mb-3 list-disc pl-5 text-sm">{pv.held.map(([why, n]) => <li key={why}>{n} · {why}</li>)}</ul> : <p className="mb-3 text-sm text-[var(--muted)]">Nobody is held back.</p>}
          {pv.sample.length > 0 && <ul className="text-sm">{pv.sample.map((r) => <li key={r.id} className="flex justify-between gap-3 border-t border-[var(--line)] py-1"><span><Link href={`/crm/leads/${r.id}`} className="underline">{r.gymName}</Link> <span className="text-[var(--muted)]">{[r.city, r.state].filter(Boolean).join(", ")}</span></span><Badge tone={r.callable ? "ok" : "neutral"}>{r.callable ? "can call" : "held"}</Badge></li>)}</ul>}
          <p className="mt-2 text-xs text-[var(--muted)]">The rules are checked again for each lead just before it is called.</p>
        </Card>
        <Card title="Offer the agent may quote">
          {offer?.lines ? <ul className="list-disc pl-5 text-sm">{offer.lines.map((l) => <li key={l}>{l}</li>)}</ul> : <p className="text-sm">No offer.</p>}
          <p className="mt-2 text-xs text-[var(--muted)]">Taken from Settings when the campaign is created and again when it is approved. The agent reads prices from the server, never from memory.</p>
        </Card>
      </div>
      <div className="mt-5"><Card title="Script the agent follows">
        <p className="mb-2 text-sm"><strong>Opening line:</strong> “{FIRST_MESSAGE.replace("{{gym_name}}", "[Gym name]")}”</p>
        <details><summary className="cursor-pointer text-sm underline">Full instructions</summary><pre className="mt-2 text-xs whitespace-pre-wrap">{AGENT_PROMPT}</pre></details>
        {!c.testMode && <div className="mt-3"><Notice tone="accent">Live campaigns call real businesses. Confirm that your telecom registration and calling permission cover these numbers before approving.</Notice></div>}
      </Card></div>
      <div className="mt-5"><Card title={`Calls (${calls.total})`}>
        {calls.rows.length === 0 ? <p className="text-sm text-[var(--muted)]">No calls yet.</p> : (
          <ScrollRegion label="Calls"><table className={TABLE}><thead><tr><th className={TH}>Gym</th><th className={TH}>Status</th><th className={TH}>Result</th><th className={TH}>Length</th><th className={TH}>When</th></tr></thead><tbody>
            {calls.rows.map((r) => <tr key={r.id} className={TR}><td className={TD}><Link href={`/crm/calling/calls/${r.id}`} className="underline">{r.gymName}</Link></td><td className={TD}><CallStatusBadge s={r.status} /></td><td className={TD}><DispositionBadge d={r.disposition} /></td><td className={`${TD} tabular-nums`}>{mmss(r.durationSec)}</td><td className={TD}>{when(r.dialedAt ?? r.createdAt)}</td></tr>)}
          </tbody></table></ScrollRegion>
        )}
      </Card></div>
    </>
  );
}
