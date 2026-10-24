import "server-only";
import { db } from "@/lib/db";
import { CRM_ROLE_LABEL, type CrmRole } from "@/lib/domain/crm";
import { commissionRate, earningTotals, earnings, nextPayoutDate, payToText, payoutDue, rateText, firstMonthEnds, FIRST_DAYS, type Payout } from "@/lib/domain/crm-pay";
import { planText } from "@/lib/domain/crm-plans";
import { openPayout } from "./crm-profile";
import { need, type CrmUser } from "./crm-access";
import { todayIso } from "./time";

// Commission, salary and the payout, worked out from verified deals. A deal pending approval is shown but earns nothing yet.

export type StatementRow = { id: string; date: Date | null; gym: string; closer: string; plan: string; sale: number; commission: number | null; rate: number; status: "Earned" | "Pending" | "Rejected" };
export type EmployeePay = { userId: string; name: string; role: CrmRole; today: number; month: number; total: number; pending: number; salary: number | null; onSalary: boolean; due: number; account: string; hasAccount: boolean };

/** Whose earnings this person may see: their own; a manager's team and themself; everyone's for the Super Admin. A Marketing Head has none. */
export function earningsScope(u: CrmUser): "self" | "team" | "all" | null {
  if (u.role === "admin") return "all";
  if (u.role === "manager") return "team";
  if (u.role === "sales") return "self";
  return null;
}

export async function earningsView(u: CrmUser, now = new Date()) {
  const scope = earningsScope(u);
  if (!scope) need(u, "employees.manage"); // refuses a Marketing Head
  const staff = await db.crmStaff.findMany({
    where: scope === "all" ? { status: { not: "Invited" }, role: { not: "marketing" } } : scope === "team" ? { userId: { in: u.teamIds } } : { userId: u.id },
    include: { user: { select: { name: true } } },
    orderBy: { empId: "asc" },
  });
  const ids = staff.map((s) => s.userId);
  const deals = await db.crmLead.findMany({ where: { closedById: { in: ids }, verification: { in: ["Verified", "Pending", "Rejected"] } }, orderBy: { updatedAt: "desc" } });
  const byId = new Map(staff.map((s) => [s.userId, s]));
  const rows: StatementRow[] = deals.map((d) => {
    const s = byId.get(d.closedById!)!;
    const at = d.verification === "Verified" ? (d.verifiedAt ?? d.updatedAt) : null;
    const rate = commissionRate(s.joinedAt.toISOString().slice(0, 10), s.incentive, at ?? now);
    return { id: d.id, date: at ?? (d.closedDate ? new Date(d.closedDate) : null), gym: d.gymName, closer: s.user.name, plan: planText(d.plan, d.billing) + (d.addons.length ? " + add-ons" : ""), sale: d.estValue, commission: d.verification === "Rejected" ? null : Math.round(d.estValue * rate), rate, status: d.verification === "Verified" ? "Earned" : d.verification === "Pending" ? "Pending" : "Rejected" };
  });
  rows.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));

  const people: EmployeePay[] = staff.map((s) => {
    const joined = s.joinedAt.toISOString().slice(0, 10);
    const mine = deals.filter((d) => d.closedById === s.userId);
    const verified = mine.filter((d) => d.verification === "Verified").map((d) => ({ value: d.estValue, verifiedAt: d.verifiedAt ?? d.updatedAt }));
    const pendingValue = mine.filter((d) => d.verification === "Pending").reduce((a, d) => a + d.estValue, 0);
    const t = earningTotals(earnings(verified, joined, s.incentive), pendingValue, joined, s.incentive, now);
    const account = payToText(openPayout(s.payout) as Payout | null);
    const onSalary = now.getTime() >= new Date(`${joined}T00:00:00+05:30`).getTime() + FIRST_DAYS * 86_400_000;
    return { userId: s.userId, name: s.user.name, role: s.role as CrmRole, today: t.today, month: t.month, total: t.total, pending: t.pending, salary: s.salary, onSalary, due: payoutDue({ salary: s.salary, joinedAt: joined, monthCommission: t.month, at: now }), account, hasAccount: !!s.payout };
  });
  const sum = (f: (p: EmployeePay) => number) => people.reduce((a, p) => a + f(p), 0);
  const todayN = rows.filter((r) => r.status === "Earned" && r.date && new Date(r.date.getTime() + 330 * 60_000).toISOString().slice(0, 10) === todayIso(now)).length;
  const me = byId.get(u.id);
  const joined = (me ?? staff[0])?.joinedAt.toISOString().slice(0, 10);
  const payDate = nextPayoutDate(now);
  const held = people.filter((p) => !p.hasAccount && p.due > 0);
  return {
    scope,
    totals: { today: sum((p) => p.today), todayN, month: sum((p) => p.month), total: sum((p) => p.total), n: rows.filter((r) => r.status === "Earned").length, pending: sum((p) => p.pending), nPending: rows.filter((r) => r.status === "Pending").length },
    rows,
    people,
    payout: {
      date: payDate,
      amount: scope === "self" ? (people[0]?.due ?? 0) : sum((p) => (p.hasAccount ? p.due : 0)),
      salaries: sum((p) => (p.onSalary ? (p.salary ?? 0) : 0)),
      commission: sum((p) => p.month),
      account: scope === "self" ? (people[0]?.account ?? "No payout account") : null,
      hasAccount: scope === "self" ? !!people[0]?.hasAccount : true,
      held: held.map((p) => p.name),
    },
    me: me ? { joinedAt: joined!, incentive: me.incentive, salary: me.salary, inFirstMonth: !(people.find((p) => p.userId === u.id)?.onSalary ?? false), firstMonthEnds: firstMonthEnds(joined!), rate: commissionRate(joined!, me.incentive, now), rateText: rateText(commissionRate(joined!, me.incentive, now)) } : null,
    role: CRM_ROLE_LABEL[u.role],
  };
}
