import Link from "next/link";
import { BellIcon, SignOutIcon } from "@phosphor-icons/react/dist/ssr";
import { requireCrm } from "@/lib/auth/crm";
import { CRM_ROLE_LABEL } from "@/lib/domain/crm";
import { db } from "@/lib/db";
import { unreadCount } from "@/lib/services/crm-people";
import { SideLogo } from "@/components/side-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { CookieBanner } from "@/components/cookie-banner";
import { IdleSignout } from "@/components/idle-signout";
import { crmLogout } from "./actions";
import { CrmNav, type NavGroup } from "./crm-nav";

export const metadata = { title: "FITRON CRM", robots: { index: false, follow: false } };

export default async function CrmLayout({ children }: LayoutProps<"/crm">) {
  const u = await requireCrm();
  const [unread, pending] = await Promise.all([unreadCount(u), u.can("deal.verify") ? db.crmLead.count({ where: { verification: "Pending", ...(u.role === "admin" ? {} : { OR: [{ ownerId: { in: u.teamIds } }, { closedById: { in: u.teamIds } }], NOT: { closedById: u.id } }) } }) : 0]);
  const groups: NavGroup[] = [
    { group: "Overview", items: [{ href: "/crm", label: "Dashboard" }] },
    { group: "Sales", items: [{ href: "/crm/leads", label: "Leads" }, { href: "/crm/pipeline", label: "Pipeline" }, { href: "/crm/tasks", label: "Tasks & follow-ups" }, ...(u.can("deal.verify") ? [{ href: "/crm/verification", label: "Deal verification", badge: pending }] : [])] },
    ...(u.can("leads.import") || u.can("campaigns.manage") ? [{ group: "Marketing", items: [...(u.can("leads.import") ? [{ href: "/crm/import", label: "Import leads" }] : []), ...(u.can("campaigns.manage") ? [{ href: "/crm/campaigns", label: "Campaigns" }] : [])] }] : []),
    ...(u.can("employees.manage") || u.can("audit.view") ? [{ group: "Admin", items: [{ href: "/crm/employees", label: "Employees" }, { href: "/crm/audit", label: "Audit log" }, { href: "/crm/roles", label: "Roles & permissions" }] }] : []),
  ];
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-5 overflow-y-auto border-r border-line-soft bg-surface px-3.5 pb-6 lg:flex">
        <Link href="/crm" className="mt-4 block w-[200px]" aria-label="CRM home">
          <SideLogo />
        </Link>
        <div className="px-2 text-xs tracking-[0.1em] text-accent uppercase">Sales &amp; partnerships CRM</div>
        <CrmNav groups={groups} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-line-soft bg-bg px-4 py-3 lg:px-10">
          <Link href="/crm" className="text-sm font-semibold lg:hidden">FITRON CRM</Link>
          <div className="min-w-0 flex-1 lg:hidden"><CrmNav groups={groups} inline /></div>
          <div className="flex flex-none items-center gap-1.5 sm:gap-2.5 lg:ml-auto">
            <ThemeToggle />
            <Link href="/crm/notifications" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} className="relative grid size-9 place-items-center rounded-md hover:bg-fg/7">
              <BellIcon size={20} weight="duotone" />
              {unread > 0 && <span className="absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full bg-alert px-1 text-[10px] font-bold text-white">{unread}</span>}
            </Link>
            <div className="hidden text-right text-xs leading-tight sm:block">
              <div className="text-sm font-semibold">{u.name}</div>
              <div className="text-muted">{CRM_ROLE_LABEL[u.role]} · {u.empId}</div>
            </div>
            <form action={crmLogout}>
              <button aria-label="Sign out" title="Sign out" className="grid size-9 place-items-center rounded-md hover:bg-fg/7">
                <SignOutIcon size={20} weight="duotone" />
              </button>
            </form>
          </div>
        </header>
        <main id="ft-main" className="mx-auto w-full max-w-[1400px] flex-1 px-4 pt-4 pb-20 lg:px-10">{children}</main>
      </div>
      <IdleSignout minutes={30} />
      <CookieBanner />
    </div>
  );
}
