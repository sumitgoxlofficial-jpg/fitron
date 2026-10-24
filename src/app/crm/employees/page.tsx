import { requireCrm } from "@/lib/auth/crm";
import { CRM_ROLES, CRM_ROLE_LABEL } from "@/lib/domain/crm";
import { listEmployees, managers } from "@/lib/services/crm-people";
import { Card, Field, Input, PageHeader, ScrollRegion, Select, TABLE, TD, TH, TR } from "@/components/ui";
import { fmtStamp, formatRupees } from "@/lib/format";
import { inviteAction } from "../actions";
import { CrmForm } from "../crm-form";
import { EmployeeControls } from "./controls";

export const metadata = { title: "Employees · FITRON CRM" };

export default async function EmployeesPage() {
  const u = await requireCrm("employees.manage");
  const [people, mgrs] = await Promise.all([listEmployees(u), managers()]);
  return (
    <>
      <PageHeader kicker="Super Admin" title="Employees" subtitle="Employees sign in with their work email and the password they set. Deactivating someone signs them out at once." />
      <Card title="Invite an employee" className="mb-6">
        <CrmForm action={inviteAction} submit="Send invite" reset className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Name"><Input name="name" required /></Field>
            <Field label="Work email"><Input name="email" type="email" required /></Field>
            <Field label="Role"><Select name="role" defaultValue="sales">{CRM_ROLES.map((r) => <option key={r} value={r}>{CRM_ROLE_LABEL[r]}</option>)}</Select></Field>
            <Field label="Reports to" hint="Sales employees only."><Select name="managerId"><option value="">—</option>{mgrs.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
            <Field label="Monthly target (₹)"><Input name="target" inputMode="numeric" /></Field>
          </div>
        </CrmForm>
      </Card>
      <ScrollRegion label="Employees">
        <table className={TABLE}>
          <thead><tr><th className={TH}>Employee</th><th className={TH}>Role</th><th className={TH}>Reports to</th><th className={`${TH} text-right`}>Target</th><th className={TH}>Last sign-in</th><th className={TH}>Status</th><th className={TH}><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.userId} className={TR}>
                <td className={TD}><div className="font-semibold">{p.name}</div><div className="text-xs text-muted">{p.empId} · {p.email}</div></td>
                <td className={TD}>{CRM_ROLE_LABEL[p.role]}</td>
                <td className={TD}>{p.managerName ?? "—"}</td>
                <td className={`${TD} text-right tabular-nums`}>{p.monthlyTarget ? formatRupees(p.monthlyTarget) : "—"}</td>
                <td className={TD}>{p.lastLoginAt ? fmtStamp(p.lastLoginAt) : "Never"}</td>
                <td className={TD}>{p.status}</td>
                <td className={TD}><EmployeeControls userId={p.userId} self={p.userId === u.id} active={p.status === "Active"} role={p.role} managerId={p.managerId} target={p.monthlyTarget / 100} managers={mgrs} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
    </>
  );
}
