import type { CrmUser } from "@/lib/services/crm-access";
import type { NavGroup, NavItem } from "./crm-nav";

const item = (href: string, label: string, icon: NavItem["icon"], badge?: number): NavItem => ({ href, label, icon, badge });

/** The pages this person's role opens, in the sidebar's groups. The palette searches the same list, so what it offers is what the role can open. */
export function navFor(u: CrmUser, pending = 0): NavGroup[] {
  if (u.role === "admin") return adminNav(u, pending);
  const sales = u.role === "sales";
  const reports = u.role !== "sales";
  return [
    { group: "Overview", items: [item("/crm", "Dashboard", "dashboard"), ...(reports ? [item("/crm/reports", "Reports", "reports")] : [])] },
    { group: "Sales", items: [item("/crm/leads", "Leads", "leads"), item("/crm/companies", "Companies", "companies"), item("/crm/pipeline", "Pipeline", "pipeline"), item("/crm/tasks", "Tasks", "tasks"), ...(u.can("deal.verify") ? [item("/crm/verification", "Verification", "verify", pending)] : []), ...(sales ? [item("/crm/pricing", "Price list", "pricing")] : [])] },
    { group: "Marketing", items: [...(u.can("leads.import") ? [item("/crm/import", "Import leads", "import")] : []), ...(u.can("campaigns.manage") ? [item("/crm/campaigns", "Campaigns", "campaigns")] : [])] },
    { group: "Team", items: [item("/crm/leaderboard", "Leaderboard", "leaderboard"), item("/crm/activity", sales ? "My activity" : "Activity", "activity"), ...(u.role !== "marketing" ? [item("/crm/earnings", sales ? "My earnings" : "Commissions", "earnings")] : []), ...(u.can("employees.manage") ? [item("/crm/employees", "Employees", "team")] : []), item("/crm/id-card", "My ID card", "idcard")] },
    ...(u.role === "marketing" ? [intelGroup(u)] : []),
    { group: "Admin", items: [...(sales ? [] : [item("/crm/pricing", "Price list", "pricing")]), ...(u.can("audit.view") ? [item("/crm/audit", "Audit log", "audit")] : []), ...(sales ? [] : [item("/crm/roles", "Roles & permissions", "access")])] },
  ].filter((g) => g.items.length);
}

/** The Gym Intelligence pages this person may open: the Super Admin all of them, a Marketing Head the read-only ones. */
function intelGroup(u: CrmUser): NavGroup {
  if (!u.can("intel.view")) return { group: "Gym Intelligence", items: [] };
  const m = u.can("intel.manage");
  return {
    group: "Gym Intelligence",
    items: [
      item("/crm/intel", "Overview", "intelOverview"),
      ...(m ? [item("/crm/intel/discovery", "Gym discovery", "intelSearch")] : []),
      item("/crm/intel/gyms", "India gym database", "intelDb"),
      item("/crm/intel/phones", "Phone verification", "intelPhone"),
      item("/crm/intel/coverage", "Geographic coverage", "intelMap"),
      item("/crm/intel/analytics", "Sales analytics", "intelAnalytics"),
      ...(m ? [item("/crm/intel/assign", "Assign leads", "intelAssign")] : []),
      ...(m ? [item("/crm/intel/sources", "Sources & integrations", "intelSources"), item("/crm/intel/duplicates", "Duplicate review", "intelDup"), item("/crm/intel/transfer", "Import & export", "intelTransfer"), item("/crm/intel/settings", "Collection settings", "intelSettings"), item("/crm/audit?kind=intel", "Audit logs", "audit")] : []),
    ],
  };
}

/** The AI Calling pages: the Super Admin's only */
function callingGroup(u: CrmUser): NavGroup {
  if (!u.can("calling.view")) return { group: "AI Calling", items: [] };
  return {
    group: "AI Calling",
    items: [
      item("/crm/calling", "Overview", "callOverview"),
      item("/crm/calling/campaigns", "Campaigns", "callCampaigns"),
      item("/crm/calling/calls", "Call history", "callHistory"),
      item("/crm/calling/dnc", "Permission & do-not-call", "callDnc"),
      item("/crm/calling/settings", "Settings & test call", "callSettings"),
      item("/crm/calling/setup", "Agent setup", "callSetup"),
      item("/crm/audit?kind=calling", "Audit trail", "audit"),
    ],
  };
}

export const pagesFor = (u: CrmUser) => navFor(u).flatMap((g) => g.items.map((i) => ({ label: i.label, sub: g.group, href: i.href })));

/** The Super Admin runs the company: oversight and control, none of the employee's own tools (their tasks, ID card or earnings). */
function adminNav(u: CrmUser, pending: number): NavGroup[] {
  return [
    { group: "Overview", items: [item("/crm", "Dashboard", "dashboard"), item("/crm/reports", "Reports", "reports")] },
    { group: "Sales", items: [item("/crm/leads", "Leads", "leads"), item("/crm/companies", "Companies", "companies"), item("/crm/pipeline", "Pipeline", "pipeline"), item("/crm/verification", "Deal approvals", "verify", pending)] },
    { group: "Marketing", items: [item("/crm/import", "Import leads", "import"), item("/crm/campaigns", "Campaigns", "campaigns")] },
    { group: "People", items: [item("/crm/employees", "Employees", "team"), item("/crm/leaderboard", "Leaderboard", "leaderboard"), item("/crm/activity", "Activity", "activity"), item("/crm/earnings", "Commissions & payouts", "earnings")] },
    intelGroup(u),
    callingGroup(u),
    { group: "Control", items: [item("/crm/roles", "Roles & permissions", "access"), item("/crm/pricing", "Price list", "pricing"), item("/crm/audit", "Audit log", "audit")] },
  ];
}
