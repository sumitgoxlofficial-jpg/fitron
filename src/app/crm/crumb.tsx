"use client";

import { usePathname } from "next/navigation";
import { HouseSimpleIcon } from "@phosphor-icons/react";

const TITLES: Record<string, [string, string]> = {
  "": ["Overview", "Dashboard"], reports: ["Overview", "Reports"], leads: ["Sales", "Leads"], companies: ["Sales", "Companies"], pipeline: ["Sales", "Pipeline"], tasks: ["Sales", "Tasks"], verification: ["Sales", "Verification"],
  pricing: ["Admin", "Price list"], import: ["Marketing", "Import leads"], campaigns: ["Marketing", "Campaigns"], leaderboard: ["Team", "Leaderboard"], activity: ["Team", "Activity"], earnings: ["Team", "Earnings"],
  employees: ["Team", "Employees"], "id-card": ["Team", "My ID card"], audit: ["Admin", "Audit log"], roles: ["Admin", "Roles & permissions"], profile: ["Team", "Edit profile"], notifications: ["Overview", "Alerts"],
};

/** "Sales / Leads", the small breadcrumb above the date in the top bar. */
export function Crumb() {
  const seg = usePathname().split("/").filter(Boolean);
  const [group, page] = TITLES[seg[1] ?? ""] ?? ["Overview", "Dashboard"];
  const detail = seg[1] === "leads" && seg[2] ? "Lead record" : null;
  return (
    <span className="flex items-center gap-1.5 text-[13px] text-[var(--muted)]"><HouseSimpleIcon size={13} weight="duotone" />{group} / {detail ?? page}</span>
  );
}
