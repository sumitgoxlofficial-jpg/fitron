import Link from "next/link";
import { BarbellIcon } from "@phosphor-icons/react/dist/ssr";
import { requireCrm } from "@/lib/auth/crm";
import { companies } from "@/lib/services/crm-insights";
import { planOf } from "@/lib/domain/crm-plans";
import { formatRupees } from "@/lib/format";

export const metadata = { title: "Companies · FITRON CRM" };
const TONE = { Customer: "bg-[var(--accent-soft)] text-[var(--accent-strong)]", Prospect: "bg-[var(--neutral-100)] text-[var(--text)]", Lost: "bg-[var(--alert-soft)] text-[var(--alert)]" } as const;

export default async function CompaniesPage({ searchParams }: PageProps<"/crm/companies">) {
  const u = await requireCrm();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const list = await companies(u, q);
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2"><span className="text-[11px] font-semibold tracking-[0.24em] text-[var(--accent)] uppercase">{u.can("leads.all") ? "All leads" : u.can("leads.team") ? "Your team's leads" : "Assigned to you"}</span><h1 className="m-0">Companies</h1><span className="text-[13px] text-[var(--muted)]">Gyms and fitness businesses, with every contact and deal in one place.</span></div>
        <form><input type="search" name="q" defaultValue={q} placeholder="Search gyms or cities" aria-label="Search companies" className="min-h-10 w-[300px] max-w-full rounded-[10px] border border-[var(--line-2)] bg-[var(--input)] px-3 text-[13px]" /></form>
      </div>
      {list.length === 0 ? <div className="rounded-2xl border border-dashed border-[var(--line-2)] p-8 text-center text-[var(--muted)]">No companies match.</div> : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-3.5">
          {list.map((c) => (
            <Link key={c.key} href={`/crm/leads/${c.leadId}`} className="flex flex-col gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-[18px] hover:border-[var(--line-2)]">
              <span className="flex items-center gap-3">
                <span className="grid size-[42px] shrink-0 place-items-center rounded-xl border border-[var(--line-2)] bg-[var(--surface-2)] text-[var(--accent)]"><BarbellIcon size={22} weight="duotone" /></span>
                <span className="flex min-w-0 flex-1 flex-col"><b className="truncate text-[15px]">{c.name}</b><span className="truncate text-xs text-[var(--muted)]">{c.where || "—"}</span></span>
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${TONE[c.status]}`}>{c.status}</span>
              </span>
              <span className="grid grid-cols-3 gap-2 text-sm">
                <span className="flex flex-col"><span className="text-[11px] text-[var(--faint)]">Contacts</span><b>{c.contacts}</b></span>
                <span className="flex flex-col"><span className="text-[11px] text-[var(--faint)]">Open pipeline</span><b>{formatRupees(c.openValue)}</b></span>
                <span className="flex flex-col"><span className="text-[11px] text-[var(--faint)]">Verified</span><b className="text-[var(--accent-strong)]">{formatRupees(c.wonValue)}</b></span>
              </span>
              <span className="flex justify-between gap-2 text-xs text-[var(--muted)]"><span>{planOf(c.plan).name}</span><span>{c.owner}</span></span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
