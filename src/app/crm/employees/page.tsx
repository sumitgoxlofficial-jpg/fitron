import { requireCrm } from "@/lib/auth/crm";
import { CRM_ROLES, CRM_ROLE_LABEL } from "@/lib/domain/crm";
import { listEmployees, managers } from "@/lib/services/crm-people";
import { Card, Field, Input, PageHeader, Select } from "@/components/ui";
import { fmtShort, fmtStamp, formatRupees, initials } from "@/lib/format";
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
      <div className="flex flex-col gap-3">
        {people.map((p) => {
          const first = p.inFirstMonth && p.role !== "marketing";
          return (
            <article key={p.userId} className="flex flex-col gap-3 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  {p.hasPhoto ? (
                    // eslint-disable-next-line @next/next/no-img-element -- private, session-checked image
                    <img src={`/api/crm/photo/${p.userId}`} alt="" className="size-11 shrink-0 rounded-full object-cover" />
                  ) : (
                    <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[var(--surface-2)] font-[var(--font-head)] font-semibold text-[var(--accent-strong)]">{initials(p.name)}</span>
                  )}
                  <div className="min-w-0"><div className="font-semibold">{p.name} <span className="ml-1 text-xs font-semibold tracking-[0.06em] text-[var(--accent)]">{p.empId}</span></div><div className="truncate text-xs text-[var(--muted)]">{p.email} · {CRM_ROLE_LABEL[p.role]}{p.managerName ? ` · reports to ${p.managerName}` : ""}</div></div>
                </div>
                <div className="text-right text-xs text-[var(--muted)]"><div>{p.status} · last sign-in {p.lastLoginAt ? fmtStamp(p.lastLoginAt) : "never"}</div><div>{p.profileComplete ? `Profile complete · terms accepted ${p.termsAcceptedAt ? fmtStamp(p.termsAcceptedAt) : ""}` : "Profile incomplete · payouts on hold"}</div></div>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-[var(--text-2)]">
                <span>{p.account}</span>
                <span>Joined {fmtShort(new Date(`${p.joinedAt}T00:00:00+05:30`))}</span>
                {p.role !== "marketing" && (first ? <span>First month: 20% commission until {fmtShort(new Date(`${p.firstMonthEnds}T00:00:00+05:30`))}. Then {p.salary ? `salary ${formatRupees(p.salary)} + ` : ""}{p.incentive}% incentive</span> : <span>{p.salary ? `Salary ${formatRupees(p.salary)} + ` : "No salary set · "}{p.incentive}% incentive</span>)}
                {p.monthlyTarget > 0 && <span>Target {formatRupees(p.monthlyTarget)} / month</span>}
              </div>
              <EmployeeControls userId={p.userId} self={p.userId === u.id} active={p.status !== "Inactive"} role={p.role} managerId={p.managerId} target={p.monthlyTarget / 100} salary={p.salary} incentive={p.incentive} managers={mgrs} />
            </article>
          );
        })}
      </div>
    </>
  );
}
