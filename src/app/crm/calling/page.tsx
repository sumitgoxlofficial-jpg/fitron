import Link from "next/link";
import { requireCrm } from "@/lib/auth/crm";
import { DISPOSITION_LABEL, isDisposition } from "@/lib/domain/ai-calling/constants";
import { liveReady } from "@/lib/domain/ai-calling/settings";
import { callingOverview } from "@/lib/services/ai-calling/reports";
import { Badge, Card, Notice, PageHeader } from "@/components/ui";
import { Bars, Kpi, KpiGrid } from "../parts";
import { CrmForm } from "../crm-form";
import { emergencyStopAction } from "./actions";
import { when } from "./parts";

export const metadata = { title: "AI Calling · FITRON CRM" };

export default async function CallingOverview() {
  const u = await requireCrm("calling.view");
  const o = await callingOverview(u);
  const n = (x: number | null) => (x === null ? "—" : x.toLocaleString("en-IN"));
  const live = o.settings.mode === "live" && liveReady(o.settings);
  return (
    <>
      <PageHeader kicker="AI Calling" title="Overview" subtitle="Every figure is counted from the stored calls. Test calls are not included." />
      {o.settings.emergencyStop && <div className="mb-5"><Notice tone="alert"><strong>Emergency stop is on.</strong> No new call can start anywhere.</Notice></div>}
      {!o.provider.ready && <div className="mb-5"><Notice tone="accent">The calling provider is not fully set up yet: {o.provider.checks.filter((c) => !c.ok).map((c) => c.key).join(", ")} {o.provider.checks.filter((c) => !c.ok).length === 1 ? "is" : "are"} missing. See <Link href="/crm/calling/setup" className="underline">Agent setup</Link> and docs/AI_CALLING.md.</Notice></div>}
      <div className="mb-6 grid items-start gap-5 lg:grid-cols-2">
        <Card title="Mode">
          <p className="text-sm">
            <Badge tone={live ? "ok" : "accent"}>{live ? "live" : "test"}</Badge>{" "}
            {live ? "Leads with a recorded calling permission can be called inside the permitted hours." : "Only the authorised test numbers can be called. Nobody else will receive a call."}
          </p>
          <p className="mt-2 text-sm text-[var(--muted)]">{o.provider.ready ? "Provider settings are in place." : "Provider settings are incomplete."} Last call: {when(o.lastCall)}. Running campaigns: {o.running}.</p>
          <p className="mt-3"><Link href="/crm/calling/settings" className="text-sm underline">Settings and test call</Link></p>
        </Card>
        <Card title="Emergency stop">
          <p className="mb-3 text-sm">Stops every campaign and cancels queued calls at once. A call already connected finishes by itself.</p>
          {o.settings.emergencyStop ? (
            <CrmForm action={emergencyStopAction} submit="Release the stop"><input type="hidden" name="on" value="0" /></CrmForm>
          ) : (
            <CrmForm action={emergencyStopAction} submit="STOP ALL CALLING NOW" variant="danger"><input type="hidden" name="on" value="1" /></CrmForm>
          )}
        </Card>
      </div>
      <KpiGrid>
        <Kpi label="Leads with permission to call" value={n(o.eligible)} hint="A recorded basis, not just a listed number" />
        <Kpi label="Calls attempted" value={n(o.total)} />
        <Kpi label="Calls answered" value={n(o.answered)} hint="Someone spoke" />
        <Kpi label="Interested" value={n(o.interested)} />
        <Kpi label="Demos requested" value={n(o.demoRequested)} />
        <Kpi label="Demos booked" value={n(o.demoBooked)} />
        <Kpi label="Sales closed" value={n(o.salesClosed)} hint="Verified wins among called leads" />
        <Kpi label="Do not contact" value={n(o.optOuts)} />
        <Kpi label="Handed to a person" value={n(o.handoffs)} />
        <Kpi label="Call failure rate" value={o.failureRate === null ? "—" : `${o.failureRate}%`} tone={o.failureRate && o.failureRate > 20 ? "alert" : undefined} />
        <Kpi label="Calls today" value={`${n(o.todayCalls)} of ${o.settings.dailyCallCap}`} />
        <Kpi label="Total call cost" value={o.costPaise === null ? "Not reported" : `₹${(o.costPaise / 100).toFixed(2)}`} hint="Shown only when the provider reports it" />
      </KpiGrid>
      <Card title="How calls ended">
        {o.byDisposition.length ? <Bars rows={o.byDisposition.map(([d, c]) => [isDisposition(d) ? DISPOSITION_LABEL[d] : d, c])} /> : <p className="text-sm text-[var(--muted)]">No calls yet.</p>}
      </Card>
    </>
  );
}
