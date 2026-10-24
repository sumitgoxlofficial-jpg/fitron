import Link from "next/link";
import { requireCrm } from "@/lib/auth/crm";
import { PHONE_STATUSES, PHONE_STATUS_LABEL, PROMOTION_STATES } from "@/lib/domain/gym-intel/constants";
import { filterOptions, listGyms, PAGE } from "@/lib/services/gym-intel/gyms";
import { Button, Empty, Input, PageHeader, Pager, Select } from "@/components/ui";
import { GymTable } from "../parts";

export const metadata = { title: "India gym database · FITRON CRM" };

export default async function GymsPage({ searchParams }: PageProps<"/crm/intel/gyms">) {
  const u = await requireCrm("intel.view");
  const sp = await searchParams;
  const g = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const f = { q: g("q"), state: g("state"), district: g("district"), city: g("city"), pin: g("pin"), phoneStatus: g("phoneStatus"), promotion: g("promotion"), source: g("source"), hasPhone: (g("hasPhone") === "yes" || g("hasPhone") === "no" ? g("hasPhone") : undefined) as "yes" | "no" | undefined, page: Math.max(1, Number(g("page")) || 1) };
  const [res, opts] = await Promise.all([listGyms(u, f), filterOptions(u)]);
  const qs = (page: number) => `/crm/intel/gyms?${new URLSearchParams({ ...Object.fromEntries(Object.entries({ q: f.q, state: f.state, district: f.district, city: f.city, pin: f.pin, phoneStatus: f.phoneStatus, promotion: f.promotion, source: f.source, hasPhone: f.hasPhone ?? "" }).filter(([, v]) => v)), page: String(page) })}`;
  return (
    <>
      <PageHeader kicker="Gym Intelligence" title="India gym database" subtitle={`${res.total.toLocaleString("en-IN")} gym${res.total === 1 ? "" : "s"} match.${u.can("phone.full") ? "" : " Phone numbers are hidden for your role."}`}
        actions={u.can("intel.manage") ? <Link href="/crm/intel/transfer" className="text-sm underline">Export</Link> : undefined} />
      <form className="mb-4 flex flex-wrap items-center gap-2">
        <Input name="q" defaultValue={f.q} placeholder="Name, phone, gym ID or website" aria-label="Search" className="max-w-[260px]" />
        <Select name="state" defaultValue={f.state} aria-label="State" className="w-auto!"><option value="">All states</option>{opts.states.map((s) => <option key={s}>{s}</option>)}</Select>
        <Input name="district" defaultValue={f.district} placeholder="District" aria-label="District" className="max-w-[140px]" />
        <Input name="city" defaultValue={f.city} placeholder="City" aria-label="City" className="max-w-[140px]" />
        <Input name="pin" defaultValue={f.pin} placeholder="PIN code" aria-label="PIN code" inputMode="numeric" maxLength={6} className="max-w-[110px]" />
        <Select name="phoneStatus" defaultValue={f.phoneStatus} aria-label="Phone status" className="w-auto!"><option value="">Any phone status</option>{PHONE_STATUSES.map((s) => <option key={s} value={s}>{PHONE_STATUS_LABEL[s]}</option>)}</Select>
        <Select name="hasPhone" defaultValue={f.hasPhone ?? ""} aria-label="Has a phone" className="w-auto!"><option value="">With or without phone</option><option value="yes">Has a phone</option><option value="no">No phone published</option></Select>
        <Select name="source" defaultValue={f.source} aria-label="Source" className="w-auto!"><option value="">All sources</option>{opts.sources.map((s) => <option key={s}>{s}</option>)}</Select>
        <Select name="promotion" defaultValue={f.promotion} aria-label="CRM status" className="w-auto!"><option value="">Any CRM status</option>{PROMOTION_STATES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ").toLowerCase()}</option>)}</Select>
        <Button>Filter</Button>
        <Link href="/crm/intel/gyms" className="text-sm underline">Clear</Link>
      </form>
      {res.rows.length === 0 ? <Empty>No gyms match. {res.total === 0 && "Collected records will appear here."}</Empty> : <GymTable rows={res.rows} />}
      <div className="mt-4"><Pager page={res.page} pageSize={PAGE} total={res.total} href={qs} /></div>
    </>
  );
}
