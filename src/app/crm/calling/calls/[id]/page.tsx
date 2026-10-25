import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCrm } from "@/lib/auth/crm";
import { RETRYABLE } from "@/lib/domain/ai-calling/constants";
import { callDetail } from "@/lib/services/ai-calling/reports";
import { UserError } from "@/lib/services/errors";
import { Card, PageHeader } from "@/components/ui";
import { CallStatusBadge, DispositionBadge, mmss, when } from "../../parts";

export const metadata = { title: "AI call · FITRON CRM" };

export default async function CallPage({ params }: PageProps<"/crm/calling/calls/[id]">) {
  const u = await requireCrm("calling.view");
  const { id } = await params;
  const d = await callDetail(u, id).catch((e) => (e instanceof UserError ? null : Promise.reject(e)));
  if (!d) notFound();
  const { call: c } = d;
  const retry = c.status === "NO_ANSWER" || c.status === "BUSY" || (c.status === "FAILED" && !c.disposition) || (c.disposition && (RETRYABLE as readonly string[]).includes(c.disposition));
  return (
    <>
      <PageHeader kicker={<Link href="/crm/calling/calls" className="underline">Call history</Link>} title={d.lead?.gymName ?? c.leadId} subtitle={<span className="inline-flex flex-wrap items-center gap-2"><CallStatusBadge s={c.status} /><DispositionBadge d={c.disposition} />{c.test && "test call"}</span>} />
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card title="Call">
          <dl className="grid grid-cols-[130px_1fr] gap-y-1.5 text-sm">
            <dt className="text-[var(--muted)]">Number</dt><dd className="tabular-nums">{c.phone}</dd>
            <dt className="text-[var(--muted)]">Started</dt><dd>{when(c.dialedAt)}</dd>
            <dt className="text-[var(--muted)]">Length</dt><dd className="tabular-nums">{mmss(c.durationSec)}</dd>
            <dt className="text-[var(--muted)]">Attempt</dt><dd>{c.attempt}</dd>
            <dt className="text-[var(--muted)]">Campaign</dt><dd>{d.campaign ? <Link href={`/crm/calling/campaigns/${d.campaign.id}`} className="underline">{d.campaign.name}</Link> : "—"}</dd>
            <dt className="text-[var(--muted)]">Assigned to</dt><dd>{d.owner ?? "Unassigned"}</dd>
            <dt className="text-[var(--muted)]">Lead</dt><dd>{d.lead ? <Link href={`/crm/leads/${d.lead.id}`} className="underline">{d.lead.id}</Link> : "—"}{d.lead && ` · ${d.lead.stage}`}</dd>
            <dt className="text-[var(--muted)]">Demo</dt><dd>{d.demo ? `${d.demo.status.toLowerCase()} for ${when(d.demo.slotAt)}` : "—"}</dd>
            <dt className="text-[var(--muted)]">Retry</dt><dd>{retry ? "Can be tried again if the limits allow" : "No"}</dd>
            <dt className="text-[var(--muted)]">Cost</dt><dd>{c.costPaise == null ? "Not reported by the provider" : `₹${(c.costPaise / 100).toFixed(2)}`}</dd>
            {c.error && <><dt className="text-[var(--muted)]">Error</dt><dd>{c.error}</dd></>}
          </dl>
        </Card>
        <Card title="Summary">
          <p className="text-sm">{c.summary ?? "No summary was saved."}</p>
          <p className="mt-2 text-xs text-[var(--muted)]">Written by the agent from the conversation; the transcript is the record.</p>
        </Card>
      </div>
      <div className="mt-5"><Card title="Transcript">
        {d.transcript?.length ? (
          <ol className="flex flex-col gap-2 text-sm">{d.transcript.map((t, i) => <li key={i} className={t.role === "user" ? "pl-6" : ""}><span className="text-xs font-semibold text-[var(--muted)] uppercase">{t.role === "user" ? "Owner" : "AI"}{t.at != null ? ` · ${mmss(Math.round(t.at))}` : ""}</span><div>{t.text}</div></li>)}</ol>
        ) : <p className="text-sm text-[var(--muted)]">{c.transcriptExpiresAt === null && c.endedAt ? "No transcript is stored (not collected, or past its retention date)." : "Not available yet."}</p>}
        {c.transcriptExpiresAt && <p className="mt-3 text-xs text-[var(--muted)]">Deleted automatically on {when(c.transcriptExpiresAt)}.</p>}
      </Card></div>
    </>
  );
}
