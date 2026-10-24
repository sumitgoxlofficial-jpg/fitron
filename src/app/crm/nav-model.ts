import type { CrmUser } from "@/lib/services/crm-access";
import type { NavGroup, NavItem } from "./crm-nav";

const item = (href: string, label: string, icon: NavItem["icon"], badge?: number): NavItem => ({ href, label, icon, badge });

/** The pages this person's role opens, in the sidebar's groups. The palette searches the same list, so what it offers is what the role can open. */
export function navFor(u: CrmUser, pending = 0): NavGroup[] {
  const sales = u.role === "sales";
  const reports = u.role !== "sales";
  return [
    { group: "Overview", items: [item("/crm", "Dashboard", "dashboard"), ...(reports ? [item("/crm/reports", "Reports", "reports")] : [])] },
    { group: "Sales", items: [item("/crm/leads", "Leads", "leads"), item("/crm/companies", "Companies", "companies"), item("/crm/pipeline", "Pipeline", "pipeline"), item("/crm/tasks", "Tasks", "tasks"), ...(u.can("deal.verify") ? [item("/crm/verification", "Verification", "verify", pending)] : []), ...(sales ? [item("/crm/pricing", "Price list", "pricing")] : [])] },
    { group: "Marketing", items: [...(u.can("leads.import") ? [item("/crm/import", "Import leads", "import")] : []), ...(u.can("campaigns.manage") ? [item("/crm/campaigns", "Campaigns", "campaigns")] : [])] },
    { group: "Team", items: [item("/crm/leaderboard", "Leaderboard", "leaderboard"), item("/crm/activity", sales ? "My activity" : "Activity", "activity"), ...(u.role !== "marketing" ? [item("/crm/earnings", sales ? "My earnings" : "Commissions", "earnings")] : []), ...(u.can("employees.manage") ? [item("/crm/employees", "Employees", "team")] : []), item("/crm/id-card", "My ID card", "idcard")] },
    { group: "Admin", items: [...(sales ? [] : [item("/crm/pricing", "Price list", "pricing")]), ...(u.can("audit.view") ? [item("/crm/audit", "Audit log", "audit")] : []), ...(sales ? [] : [item("/crm/roles", "Roles & permissions", "access")])] },
  ].filter((g) => g.items.length);
}

export const pagesFor = (u: CrmUser) => navFor(u).flatMap((g) => g.items.map((i) => ({ label: i.label, sub: g.group, href: i.href })));
