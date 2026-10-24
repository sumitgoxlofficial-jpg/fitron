import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { requireCrm } from "@/lib/auth/crm";
import { CALL_OUTCOMES, PRIORITIES, TASK_TYPES } from "@/lib/domain/crm";
import { SELLABLE, planText } from "@/lib/domain/crm-plans";
import { assignees, leadDetail } from "@/lib/services/crm-leads";
import { mayVerify } from "@/lib/services/crm-access";
import { listCampaigns } from "@/lib/services/crm-people";
import { todayIso } from "@/lib/services/time";
import { Button, Card, Empty, Field, Input, Notice, PageHeader, Select, Textarea } from "@/components/ui";
import { fmtShort, fmtStamp, formatRupees } from "@/lib/format";
import { approveAction, assignAction, callAction, doneAction, noteAction, rejectAction, saveLeadDetails, stageAction, taskAction } from "../../actions";
import { CrmForm } from "../../crm-form";
import { StageBadge, VerificationBadge } from "../../parts";
import { StageForm } from "./stage-form";

export const metadata = { title: "Lead · FITRON CRM" };

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex justify-between gap-4 border-b border-fg/8 py-2 text-sm last:border-0"><dt className="text-muted">{k}</dt><dd className="text-right">{v || "—"}</dd></div>
);

export default async function LeadPage({ params, searchParams }: PageProps<"/crm/leads/[id]">) {
  const u = await requireCrm();
  const { id } = await params;
  const sp = await searchParams;
  const d = await leadDetail(u, id);
  if (d === "denied") forbidden();
  if (!d) notFound();
  const { lead: l } = d;
  const [owners, campaigns] = await Promise.all([u.can("leads.assign") ? assignees(u) : [], listCampaigns()]);
  const canWork = u.can("activity.log") && !l.locked;
  const decide = l.verification === "Pending" && mayVerify(u, l);
  const today = todayIso();
  const move = typeof sp.move === "string" ? sp.move : undefined;
  const full = u.can("phone.full");

  return (
    <>
      <Link href="/crm/leads" className="text-sm text-muted hover:underline">← All leads</Link>
      <PageHeader
        kicker={`${l.id} · ${l.product === "SaaS" ? "Gym Accounting SaaS" : "Gym Partnership"}`}
        title={l.gymName}
        subtitle={<>{l.contactName}{l.city && ` · ${l.city}`}{l.state && `, ${l.state}`} · {l.phone}{l.altPhone && ` · ${l.altPhone}`}{l.email && ` · ${l.email}`}</>}
        actions={<><StageBadge stage={l.stage} /><VerificationBadge v={l.verification} /></>}
      />

      {l.verification === "Rejected" && <div className="mb-4"><Notice tone="alert"><b>Deal rejected.</b> {l.rejectReason} — it is back in Follow-up / Negotiation. Fix what was asked and submit it again.</Notice></div>}
      {l.verification === "Pending" && <div className="mb-4"><Notice>Waiting for approval · {formatRupees(l.estValue)} · {l.proofType}: {l.proofRef}. It is not counted as revenue until it is approved.</Notice></div>}
      {l.locked && <div className="mb-4"><Notice tone="ok">Verified. The stage, owner and closer are locked; only a Super Admin can correct them, and each correction is logged.</Notice></div>}

      {decide && (
        <Card title="Decide this deal" className="mb-5">
          <div className="flex flex-wrap items-start gap-4">
            <form action={approveAction.bind(null, l.id)}><Button variant="primary">Approve · count as revenue</Button></form>
            <CrmForm action={rejectAction.bind(null, l.id)} submit="Reject" variant="danger" className="flex min-w-[260px] flex-1 flex-col gap-2">
              <Field label="Reason for rejecting (at least 5 characters)"><Input name="reason" required minLength={5} /></Field>
            </CrmForm>
          </div>
        </Card>
      )}

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Card title="Status">
          {canWork ? <StageForm action={stageAction.bind(null, l.id)} current={l.stage} initial={move} today={today} version={l.version} plan={l.plan} billing={l.billing} /> : <p className="text-sm text-muted">{l.locked ? "Locked." : "Your role can't change the stage."}</p>}
          {u.can("leads.assign") && !l.locked && (
            <div className="mt-5 border-t border-fg/8 pt-4">
              <CrmForm action={assignAction.bind(null, l.id)} submit="Assign">
                <input type="hidden" name="version" value={l.version} />
                <Field label="Owner"><Select name="ownerId" defaultValue={l.ownerId ?? ""}><option value="">Unassigned</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select></Field>
              </CrmForm>
            </div>
          )}
        </Card>

        <Card title="Attribution & deal">
          <dl>
            <Row k="Owner" v={l.ownerName ?? "Unassigned"} />
            <Row k="Source" v={l.source} />
            <Row k="Campaign" v={l.campaignName} />
            <Row k="Plan" v={planText(l.plan, l.billing) + (l.addons.length ? ` + ${l.addons.join(", ")}` : "")} />
            <Row k="Estimated / deal value" v={l.estValue ? formatRupees(l.estValue) : ""} />
            <Row k="Added" v={fmtShort(l.createdAt)} />
            <Row k="Closed by" v={l.closedByName} />
            <Row k="Verification" v={l.verification} />
            <Row k="Verified by" v={l.verifiedByName} />
            <Row k="Proof" v={l.proofType && `${l.proofType}: ${l.proofRef}`} />
            <Row k="Closed date" v={l.closedDate ? fmtShort(l.closedDate) : ""} />
            <Row k="Loss reason" v={l.lossReason} />
          </dl>
          {d.assignments.length > 0 && (
            <div className="mt-4"><div className="mb-1 text-[11px] tracking-[0.08em] text-muted uppercase">Assignment history</div>
              <ul className="text-sm">{d.assignments.map((a, i) => <li key={i} className="py-0.5">{fmtShort(a.at)} · {a.from} → {a.to} <span className="text-muted">by {a.by}</span></li>)}</ul>
            </div>
          )}
        </Card>
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Card title="Log a call">
          {u.can("activity.log") ? (
            <CrmForm action={callAction.bind(null, l.id)} submit="Log call" reset>
              <p className="text-[13px] text-muted">There is no calling integration yet, so calls are logged by hand; no call length is recorded.</p>
              <Field label="Outcome"><Select name="outcome" required defaultValue="Connected">{CALL_OUTCOMES.map((o) => <option key={o}>{o}</option>)}</Select></Field>
              <Field label="Notes"><Textarea name="notes" /></Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Objection"><Input name="objection" /></Field>
                <Field label="Next action"><Input name="nextAction" /></Field>
                <Field label="Follow-up date" hint="Optional; must be in the future."><Input name="followDate" type="date" min={today} /></Field>
                <Field label="Time (IST)"><Input name="followTime" type="time" defaultValue="10:00" /></Field>
              </div>
            </CrmForm>
          ) : <p className="text-sm text-muted">Your role can&apos;t log calls.</p>}
        </Card>

        <Card title="Tasks & follow-ups">
          {d.tasks.length === 0 ? <p className="text-sm text-muted">No tasks yet.</p> : (
            <ul className="mb-3 divide-y divide-fg/8">
              {d.tasks.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className={t.done ? "text-muted line-through" : t.overdue ? "text-alert" : ""}>{t.type} · {fmtStamp(t.dueAt)} · {t.ownerName}{t.overdue && !t.done ? " · overdue" : ""}</span>
                  {!t.done && canWork && <form action={doneAction.bind(null, t.id, l.id)}><Button className="px-3! py-1.5!">Done</Button></form>}
                </li>
              ))}
            </ul>
          )}
          {canWork && (
            <CrmForm action={taskAction.bind(null, l.id)} submit="Add task" reset className="flex flex-wrap items-end gap-2 border-t border-fg/8 pt-3">
              <Field label="Type"><Select name="type">{TASK_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
              <Field label="Date"><Input name="dueDate" type="date" min={today} required /></Field>
              <Field label="Time (IST)"><Input name="dueTime" type="time" defaultValue="10:00" /></Field>
            </CrmForm>
          )}
          {canWork && (
            <CrmForm action={noteAction.bind(null, l.id)} submit="Add note" reset className="mt-3 flex flex-col gap-2 border-t border-fg/8 pt-3">
              <Field label="Note"><Textarea name="notes" required /></Field>
            </CrmForm>
          )}
        </Card>
      </div>

      {!l.locked && (
        <Card title="Details" className="mb-5">
          <CrmForm action={saveLeadDetails.bind(null, l.id)} submit="Save details">
            <input type="hidden" name="version" value={l.version} />
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Contact name"><Input name="contactName" defaultValue={l.contactName} /></Field>
              <Field label="Gym / business"><Input name="gymName" defaultValue={l.gymName} /></Field>
              <Field label="Priority"><Select name="priority" defaultValue={l.priority}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</Select></Field>
              <Field label="Plan"><Select name="plan" defaultValue={l.plan} disabled={l.verification === "Pending"}>{SELLABLE.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</Select></Field>
              <Field label="Billing"><Select name="billing" defaultValue={l.billing} disabled={l.verification === "Pending"}><option value="MONTHLY">Monthly</option><option value="YEARLY">Yearly</option></Select></Field>
              <Field label="City"><Input name="city" defaultValue={l.city ?? ""} /></Field>
              <Field label="District"><Input name="district" defaultValue={l.district ?? ""} /></Field>
              <Field label="State"><Input name="state" defaultValue={l.state ?? ""} /></Field>
              <Field label="PIN code"><Input name="pin" defaultValue={l.pin ?? ""} /></Field>
              <Field label="Address"><Input name="address" defaultValue={l.address ?? ""} /></Field>
              {u.can("leads.all") && <Field label="Campaign"><Select name="campaignId" defaultValue={l.campaignId ?? ""}><option value="">None</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>}
              {full && <Field label="Mobile"><Input name="phone" defaultValue={l.phone.replace(/\D/g, "").slice(-10)} /></Field>}
              {full && <Field label="Alternate mobile"><Input name="altPhone" defaultValue={l.altPhone.replace(/\D/g, "").slice(-10)} /></Field>}
              {full && <Field label="Email"><Input name="email" defaultValue={l.email} /></Field>}
            </div>
          </CrmForm>
        </Card>
      )}

      <Card title="Timeline" className="mb-5">
        <p className="mb-3 text-xs text-muted">Entries are added, never edited or removed.</p>
        {d.timeline.length === 0 ? <Empty>Nothing yet.</Empty> : (
          <ul className="flex flex-col divide-y divide-fg/8">
            {d.timeline.map((t) => <li key={t.id} className="py-2 text-sm"><div>{t.text}</div><div className="text-xs text-muted">{t.actor} · {fmtStamp(t.at)}</div></li>)}
          </ul>
        )}
      </Card>
    </>
  );
}
