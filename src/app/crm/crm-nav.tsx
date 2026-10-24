"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BuildingsIcon, ChartLineUpIcon, CheckSquareOffsetIcon, IdentificationBadgeIcon, IdentificationCardIcon, KanbanIcon, MegaphoneIcon, PulseIcon, ScrollIcon, SealCheckIcon, ShieldCheckIcon, SquaresFourIcon, TagIcon,
  TrophyIcon, UploadSimpleIcon, UsersThreeIcon, WalletIcon, UserCircleIcon, type Icon,
} from "@phosphor-icons/react";
import { cx } from "@/components/ui";

const ICONS = { dashboard: SquaresFourIcon, reports: ChartLineUpIcon, leads: UsersThreeIcon, companies: BuildingsIcon, pipeline: KanbanIcon, tasks: CheckSquareOffsetIcon, verify: SealCheckIcon, leaderboard: TrophyIcon, activity: PulseIcon, earnings: WalletIcon, team: IdentificationBadgeIcon, idcard: IdentificationCardIcon, import: UploadSimpleIcon, campaigns: MegaphoneIcon, pricing: TagIcon, audit: ScrollIcon, access: ShieldCheckIcon, profile: UserCircleIcon } satisfies Record<string, Icon>;
export type NavIconKey = keyof typeof ICONS;
export type NavItem = { href: string; label: string; icon: NavIconKey; badge?: number; badgeTone?: "alert" };
export type NavGroup = { group: string; items: NavItem[] };

/** The sidebar from the design: gold highlight and a gold edge on the open page, a count badge where something waits. `inline` is the phone version, one scrolling row. */
export function CrmNav({ groups, inline }: { groups: NavGroup[]; inline?: boolean }) {
  const path = usePathname();
  const on = (h: string) => (h === "/crm" ? path === "/crm" : path === h || path.startsWith(`${h}/`));
  const link = (i: NavItem) => {
    const I = ICONS[i.icon];
    return (
      <Link key={i.href} href={i.href} aria-current={on(i.href) ? "page" : undefined}
        className={cx("flex min-h-11 items-center justify-between gap-2.5 rounded-[10px] px-3 text-sm whitespace-nowrap", on(i.href) ? "bg-[rgba(217,180,90,.14)] font-semibold text-[var(--accent-strong)] shadow-[inset_2px_0_0_var(--accent)]" : "font-medium text-[var(--text-2)] hover:bg-[var(--neutral-100)]")}>
        <span className="flex items-center gap-2.5"><I size={inline ? 18 : 20} weight="duotone" className={on(i.href) ? "text-[var(--accent)]" : "text-[var(--muted)]"} />{i.label}</span>
        {!!i.badge && <span className={cx("rounded-full px-2 text-[11px] font-bold", i.badgeTone === "alert" ? "bg-[var(--alert)] text-[var(--on-alert)]" : "bg-[var(--accent)] text-[var(--accent-ink)]")}>{i.badge}</span>}
      </Link>
    );
  };
  if (inline) return <nav aria-label="CRM" className="flex gap-1 overflow-x-auto">{groups.flatMap((g) => g.items).map(link)}</nav>;
  return (
    <nav aria-label="CRM" className="flex flex-col gap-5">
      {groups.map((g) => (
        <div key={g.group} className="flex flex-col gap-0.5">
          <div className="px-3 pb-1.5 text-[10px] font-semibold tracking-[0.22em] text-[var(--faint)] uppercase">{g.group}</div>
          {g.items.map(link)}
        </div>
      ))}
    </nav>
  );
}
