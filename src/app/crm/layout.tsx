import Link from "next/link";
import { BellIcon, SignOutIcon } from "@phosphor-icons/react/dist/ssr";
import { requireCrm } from "@/lib/auth/crm";
import { CRM_ROLE_LABEL } from "@/lib/domain/crm";
import { db } from "@/lib/db";
import { unreadCount } from "@/lib/services/crm-people";
import { ThemeToggleRound } from "./theme-round";
import { Crumb } from "./crumb";
import { Palette } from "./palette";
import { todayIso } from "@/lib/services/time";
import { IdleSignout } from "@/components/idle-signout";
import { initials } from "@/lib/format";
import { crmLogout } from "./actions";
import { CrmNav, type NavGroup } from "./crm-nav";
import { navFor } from "./nav-model";
import "./crm.css";

export const metadata = { title: "FITRON CRM", robots: { index: false, follow: false } };

export default async function CrmLayout({ children }: LayoutProps<"/crm">) {
  // The profile page is where a new employee finishes setting up, so the layout lets them in; each page applies the gate itself.
  const u = await requireCrm(undefined, { setup: true });
  const [unread, pending] = await Promise.all([unreadCount(u), u.can("deal.verify") && !u.setupNeeded ? db.crmLead.count({ where: { verification: "Pending", ...(u.role === "admin" ? {} : { OR: [{ ownerId: { in: u.teamIds } }, { closedById: { in: u.teamIds } }], NOT: { closedById: u.id } }) } }) : 0]);
  const full = navFor(u, pending);
  const today = new Date(`${todayIso()}T00:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
  const groups: NavGroup[] = u.setupNeeded ? [{ group: "Set up", items: [{ href: "/crm/profile", label: "Complete your profile", icon: "profile" }] }] : full;

  return (
    <div className="crm flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col gap-7 overflow-y-auto border-r border-[var(--line)] bg-[var(--sidebar)] px-4 py-6 lg:flex">
        <Link href="/crm" className="flex items-center gap-3 px-2" aria-label="CRM home">
          {/* eslint-disable-next-line @next/next/no-img-element -- the site's own static logo */}
          <img src="/site/fitron-ring-v2.png" alt="FITRON" width={40} height={40} className="block rounded-full" />
          <span className="flex flex-col">
            <span className="font-[var(--font-head)] text-[22px] leading-none font-semibold tracking-[0.06em]">FITRON</span>
            <span className="mt-1 text-[10px] font-semibold tracking-[0.24em] text-[var(--accent)] uppercase">Sales CRM</span>
          </span>
        </Link>
        <CrmNav groups={groups} />
        <Link href="/crm/profile" className="mt-auto flex items-center gap-3 rounded-[14px] border border-[var(--line)] p-3 hover:border-[var(--accent)]">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--surface-2)] font-[var(--font-head)] text-sm font-semibold text-[var(--accent-strong)]">{initials(u.name)}</span>
          <span className="min-w-0 text-xs leading-tight"><b className="block truncate text-[13px]">{u.name}</b><span className="text-[var(--muted)]">{CRM_ROLE_LABEL[u.role]} · Edit profile</span></span>
        </Link>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--line)] bg-[var(--bg)] px-4 py-3 lg:px-10">
          <Link href="/crm" className="font-[var(--font-head)] text-lg font-semibold tracking-[0.06em] lg:hidden">FITRON CRM</Link>
          <div className="hidden min-w-0 flex-col lg:flex">
            <Crumb />
            <span className="text-[11px] font-semibold tracking-[0.2em] text-[var(--muted)] uppercase">{today}</span>
          </div>
          <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 sm:gap-2.5">
            {!u.setupNeeded && <Palette />}
            <ThemeToggleRound />
            <Link href="/crm/profile" className="hidden min-h-11 items-center gap-2.5 rounded-full border border-[var(--line-2)] py-1 pr-4 pl-1 hover:border-[var(--accent)] sm:flex">
              <span className="grid size-9 place-items-center rounded-full bg-gradient-to-b from-[#f3d88f] via-[#d9b45a] to-[#c49a3c] font-[var(--font-head)] text-xs font-semibold text-[#17140d]">{initials(u.name)}</span>
              <span className="flex flex-col text-left text-xs leading-tight"><b className="text-[13px]">{u.name}</b><span className="text-[var(--muted)]">{CRM_ROLE_LABEL[u.role]}</span></span>
            </Link>
            <Link href="/crm/notifications" aria-label={`Alerts${unread ? `, ${unread} unread` : ""}`} className="relative grid size-11 shrink-0 place-items-center rounded-full border border-[var(--line-2)] hover:border-[var(--accent)]">
              <BellIcon size={18} weight="duotone" />
              {unread > 0 && <span className="absolute -top-1 -right-1 grid min-w-4 place-items-center rounded-full bg-[var(--alert)] px-1 text-[10px] font-bold text-white">{unread}</span>}
            </Link>
            <form action={crmLogout}>
              <button aria-label="Sign out" title="Sign out" className="grid size-11 place-items-center rounded-full border border-[var(--line-2)] hover:border-[var(--accent)]"><SignOutIcon size={18} weight="duotone" /></button>
            </form>
          </div>
          <div className="min-w-0 basis-full lg:hidden"><CrmNav groups={groups} inline /></div>
        </header>
        <main id="ft-main" className="mx-auto w-full max-w-[1400px] flex-1 px-4 pt-6 pb-20 lg:px-10">{children}</main>
      </div>
      <IdleSignout minutes={30} />
    </div>
  );
}
