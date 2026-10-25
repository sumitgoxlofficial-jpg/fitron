import Link from "next/link";
import { requireCrm } from "@/lib/auth/crm";
import { INDIA_STATES } from "@/lib/domain/gym-intel/constants";
import { assignmentOverview } from "@/lib/services/gym-intel/analytics";
import { Card, Empty, Field, Input, PageHeader, ScrollRegion, Select, TABLE, TD, TH, TR } from "@/components/ui";
import { CrmForm } from "../../crm-form";
import { when } from "../parts";
import { assignAreaAction, promoteManyAction } from "../actions";

export const metadata = { title: "Assign leads · FITRON CRM" };
export const maxDuration = 120;

export default async function AssignPage() {
  const u = await requireCrm("intel.manage");
  const o = await assignmentOverview(u);
  const total = o.unowned.reduce((n, r) => n + r.n, 0);
  return (
    <>
      <PageHeader kicker="Gym Intelligence" title="Assign leads" subtitle="Turn ready gyms into CRM leads, then give the unowned ones to employees by area. A lead that already has an owner is never touched." />
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card title="1 · Promote ready gyms to CRM leads">
          <p className="mt-0 text-sm text-[var(--muted)]">Ready means a mobile number a source printed, not yet a lead, not on the do-not-contact list. Up to 200 at a time. Gyms that look like an existing lead are flagged, not duplicated. Leave the area empty for all India.</p>
          <CrmForm action={promoteManyAction} submit="Promote ready gyms" reset>
            <AreaFields />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirmed" /> Create CRM leads for these gyms</label>
          </CrmForm>
        </Card>
        <Card title={`2 · Assign unowned leads (${total} waiting)`}>
          <CrmForm action={assignAreaAction} submit="Assign" reset>
            <AreaFields />
            <Field label="Give them to"><Select name="owner" required defaultValue=""><option value="" disabled>Choose an employee…</option>{o.owners.map((e) => <option key={e.id} value={e.id}>{e.name} · {e.empId} ({e.role === "manager" ? "manager" : "sales"})</option>)}</Select></Field>
          </CrmForm>
        </Card>
      </div>
      <div className="mt-5 grid items-start gap-5 lg:grid-cols-2">
        <Card title="Waiting for an owner">
          {o.unowned.length === 0 ? <Empty>No unowned gym leads.</Empty> : (
            <ScrollRegion label="Unowned leads"><table className={TABLE}><thead><tr><th className={TH}>State</th><th className={TH}>District</th><th className={`${TH} text-right`}>Leads</th></tr></thead>
              <tbody>{o.unowned.map((r, i) => <tr key={i} className={TR}><td className={TD}>{r.state || "—"}</td><td className={TD}>{r.district || "—"}</td><td className={`${TD} text-right tabular-nums`}>{r.n}</td></tr>)}</tbody></table></ScrollRegion>
          )}
        </Card>
        <Card title="Who holds the gym leads">
          <ScrollRegion label="Owners"><table className={TABLE}><thead><tr><th className={TH}>Employee</th><th className={TH}>Role</th><th className={`${TH} text-right`}>Gym leads</th></tr></thead>
            <tbody>{o.owners.map((e) => <tr key={e.id} className={TR}><td className={TD}>{e.name}<div className="text-xs text-[var(--muted)]">{e.empId}</div></td><td className={TD}>{e.role}</td><td className={`${TD} text-right tabular-nums`}>{e.leads}</td></tr>)}</tbody></table></ScrollRegion>
        </Card>
      </div>
      <div className="mt-5" />
      <Card title="Assignment history" action={<Link href="/crm/leads" className="text-sm underline">All leads</Link>}>
        {o.history.length === 0 ? <Empty>No assignments yet.</Empty> : (
          <ScrollRegion label="Assignment history"><table className={TABLE}><thead><tr><th className={TH}>When</th><th className={TH}>Lead</th><th className={TH}>From</th><th className={TH}>To</th><th className={TH}>By</th></tr></thead>
            <tbody>{o.history.map((h) => <tr key={h.id} className={TR}><td className={`${TD} whitespace-nowrap`}>{when(h.at)}</td><td className={TD}><Link href={`/crm/leads/${h.leadId}`} className="underline">{h.gym}</Link></td><td className={TD}>{h.from}</td><td className={TD}>{h.to}</td><td className={TD}>{h.by}</td></tr>)}</tbody></table></ScrollRegion>
        )}
      </Card>
    </>
  );
}

function AreaFields() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="State"><Select name="state" defaultValue=""><option value="">All India</option>{INDIA_STATES.map((s) => <option key={s.code}>{s.name}</option>)}</Select></Field>
      <Field label="District"><Input name="district" /></Field>
      <Field label="City"><Input name="city" /></Field>
      <Field label="PIN code"><Input name="pin" inputMode="numeric" maxLength={6} /></Field>
    </div>
  );
}
