import { requireCrm } from "@/lib/auth/crm";
import { EXPORTS } from "@/lib/services/gym-intel/export";
import { Card, Field, PageHeader, Select, Input, Button, ScrollRegion, TABLE, TD, TH, TR } from "@/components/ui";
import { INDIA_STATES, PHONE_STATUSES, PHONE_STATUS_LABEL, PROMOTION_STATES } from "@/lib/domain/gym-intel/constants";
import { UploadForm } from "./upload-form";
import { CrmForm } from "../../crm-form";
import { addGymAction } from "../actions";

export const metadata = { title: "Import & export · FITRON CRM" };
export const maxDuration = 120;

export default async function TransferPage() {
  await requireCrm("intel.manage");
  return (
    <>
      <PageHeader kicker="Gym Intelligence" title="Import & export" subtitle="Real files in, real records out. Exports are built from the stored records and are written to the audit log." />
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card title="Import an OpenStreetMap file">
          <p className="mt-0 text-sm text-[var(--muted)]">An Overpass JSON export (up to about 4 MB). The “OpenStreetMap extract” source must be on. For whole states use the live collection in Gym discovery.</p>
          <UploadForm kind="osm" accept=".json,application/json" label="Import gyms" />
        </Card>
        <Card title="Load the PIN code directory">
          <p className="mt-0 text-sm text-[var(--muted)]">The India Post “All India Pincode Directory” CSV from data.gov.in (columns <code>pincode</code>, <code>statename</code>, <code>district</code>, <code>officename</code>). It organises coverage by PIN code; it does not contain gyms.</p>
          <UploadForm kind="pin" accept=".csv,text/csv" label="Load PIN codes" />
        </Card>
        <Card title="Add a gym by hand">
          <CrmForm action={addGymAction} submit="Save gym" reset>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Gym name"><Input name="name" required /></Field>
              <Field label="Business phone"><Input name="phone" inputMode="tel" /></Field>
              <Field label="Website"><Input name="website" /></Field>
              <Field label="PIN code"><Input name="pin" inputMode="numeric" maxLength={6} /></Field>
              <Field label="City"><Input name="city" /></Field>
              <Field label="District"><Input name="district" /></Field>
              <Field label="State"><Select name="state" defaultValue=""><option value="">—</option>{INDIA_STATES.map((s) => <option key={s.code}>{s.name}</option>)}</Select></Field>
              <Field label="Address"><Input name="address" /></Field>
            </div>
            <Field label="Where the number came from" hint="Needed: the gym's board, its listing, a call to the front desk."><Input name="evidence" required /></Field>
          </CrmForm>
        </Card>
        <Card title="Export">
          <form action="/api/crm/intel/export" method="get" className="flex flex-col gap-3">
            <Field label="File"><Select name="kind" defaultValue="master">{Object.entries(EXPORTS).map(([k, v]) => <option key={k} value={k}>{v.file.replace(/_/g, " ")}</option>)}</Select></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="State"><Select name="state" defaultValue=""><option value="">All India</option>{INDIA_STATES.map((s) => <option key={s.code}>{s.name}</option>)}</Select></Field>
              <Field label="District"><Input name="district" /></Field>
              <Field label="City"><Input name="city" /></Field>
              <Field label="PIN code"><Input name="pin" inputMode="numeric" maxLength={6} /></Field>
              <Field label="Phone status"><Select name="phoneStatus" defaultValue=""><option value="">Any</option>{PHONE_STATUSES.map((s) => <option key={s} value={s}>{PHONE_STATUS_LABEL[s]}</option>)}</Select></Field>
              <Field label="CRM status"><Select name="promotion" defaultValue=""><option value="">Any</option>{PROMOTION_STATES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ").toLowerCase()}</option>)}</Select></Field>
              <Field label="Format"><Select name="format" defaultValue="xlsx"><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV (gym lists only)</option></Select></Field>
            </div>
            <div><Button>Download</Button></div>
            <p className="m-0 text-xs text-[var(--muted)]">Numbers on the do-not-contact list stay marked in the export. Do not use them for outreach.</p>
          </form>
        </Card>
      </div>
      <div className="mt-5" />
      <Card title="Available exports"><ScrollRegion label="Exports"><table className={TABLE}><thead><tr><th className={TH}>File</th><th className={TH}>What</th></tr></thead><tbody>{Object.values(EXPORTS).map((e) => <tr key={e.file} className={TR}><td className={TD}>{e.file}.xlsx</td><td className={TD}>{e.label}</td></tr>)}</tbody></table></ScrollRegion></Card>
    </>
  );
}
