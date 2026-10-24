"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

export type NavItem = { href: string; label: string; badge?: number };
export type NavGroup = { group: string; items: NavItem[] };

export function CrmNav({ groups, inline }: { groups: NavGroup[]; inline?: boolean }) {
  const path = usePathname();
  const on = (h: string) => (h === "/crm" ? path === "/crm" : path === h || path.startsWith(`${h}/`));
  const link = (i: NavItem) => (
    <Link key={i.href} href={i.href} aria-current={on(i.href) ? "page" : undefined} className={cx("flex min-h-10 items-center justify-between gap-2 rounded-md px-3 text-sm whitespace-nowrap", on(i.href) ? "bg-accent-soft font-semibold text-accent-strong" : "hover:bg-fg/7")}>
      {i.label}
      {!!i.badge && <span className="rounded-full bg-accent px-2 text-[11px] font-bold text-accent-ink">{i.badge}</span>}
    </Link>
  );
  if (inline) return <nav aria-label="CRM" className="flex gap-1 overflow-x-auto">{groups.flatMap((g) => g.items).map(link)}</nav>;
  return (
    <nav aria-label="CRM" className="flex flex-col gap-4">
      {groups.map((g) => (
        <div key={g.group} className="flex flex-col gap-0.5">
          <div className="px-3 pb-1 text-[11px] tracking-[0.1em] text-muted uppercase">{g.group}</div>
          {g.items.map(link)}
        </div>
      ))}
    </nav>
  );
}
