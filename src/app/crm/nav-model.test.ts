import { describe, expect, it } from "vitest";
import { ROLE_WIDGETS } from "@/lib/domain/crm-dash";
import type { CrmUser } from "@/lib/services/crm-access";
import { navFor } from "./nav-model";

const as = (role: CrmUser["role"]) => ({ role, can: () => true }) as unknown as CrmUser;
const hrefs = (role: CrmUser["role"]) => navFor(as(role)).flatMap((g) => g.items.map((i) => i.href));

describe("what the Super Admin sees", () => {
  it("has the company's controls and none of an employee's own tools", () => {
    const admin = hrefs("admin");
    for (const h of ["/crm", "/crm/reports", "/crm/employees", "/crm/verification", "/crm/campaigns", "/crm/audit", "/crm/roles"]) expect(admin).toContain(h);
    for (const h of ["/crm/tasks", "/crm/id-card"]) expect(admin).not.toContain(h);
  });

  it("leaves employees' menus as they were", () => {
    expect(hrefs("sales")).toEqual(expect.arrayContaining(["/crm/tasks", "/crm/id-card", "/crm/earnings"]));
  });

  it("has an attention panel and no personal follow-ups on the dashboard", () => {
    expect(ROLE_WIDGETS.admin).toContain("attention");
    expect(ROLE_WIDGETS.admin).not.toContain("tasks");
    expect(ROLE_WIDGETS.sales).not.toContain("attention");
  });

  it("gives the Super Admin all Gym Intelligence pages and a Marketing Head only the read-only ones", () => {
    const as = (role: CrmUser["role"], manage: boolean) => ({ role, can: (p: string) => p === "intel.view" || (manage && p === "intel.manage") || p !== "intel.manage" }) as unknown as CrmUser;
    const admin = navFor(as("admin", true)).flatMap((g) => g.items.map((i) => i.href));
    for (const h of ["/crm/intel", "/crm/intel/discovery", "/crm/intel/gyms", "/crm/intel/phones", "/crm/intel/coverage", "/crm/intel/sources", "/crm/intel/duplicates", "/crm/intel/transfer", "/crm/intel/settings"]) expect(admin).toContain(h);
    const marketing = navFor(as("marketing", false)).flatMap((g) => g.items.map((i) => i.href));
    expect(marketing).toEqual(expect.arrayContaining(["/crm/intel", "/crm/intel/gyms", "/crm/intel/phones", "/crm/intel/coverage"]));
    for (const h of ["/crm/intel/discovery", "/crm/intel/sources", "/crm/intel/transfer", "/crm/intel/settings"]) expect(marketing).not.toContain(h);
    expect(hrefs("sales")).not.toContain("/crm/intel");
  });
});
