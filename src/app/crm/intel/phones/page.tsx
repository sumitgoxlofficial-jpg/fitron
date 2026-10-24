import { requireCrm } from "@/lib/auth/crm";
import { PHONE_STATUS_LABEL } from "@/lib/domain/gym-intel/constants";
import { listGyms, PAGE } from "@/lib/services/gym-intel/gyms";
import { Empty, PageHeader, Pager, Segmented } from "@/components/ui";
import { GymTable } from "../parts";

export const metadata = { title: "Phone verification · FITRON CRM" };

const TABS = [["UNTESTED", "Untested"], ["FORMAT_VALID", "Valid format (no source evidence)"], ["SOURCE_CONFIRMED", "Source confirmed"], ["REACHABILITY_CONFIRMED", "Reachability confirmed"], ["INVALID_FORMAT", "Invalid format"], ["CONFLICTING_SOURCES", "Conflicting"], ["STALE", "Stale"], ["UNAVAILABLE", "Unavailable"]] as const;

export default async function PhonesPage({ searchParams }: PageProps<"/crm/intel/phones">) {
  const u = await requireCrm("intel.view");
  const sp = await searchParams;
  const status = TABS.find((t) => t[0] === sp.status)?.[0] ?? "SOURCE_CONFIRMED";
  const page = Math.max(1, Number(sp.page) || 1);
  const res = await listGyms(u, { phoneStatus: status, page });
  return (
    <>
      <PageHeader kicker="Gym Intelligence" title="Phone verification" subtitle="A valid format does not prove a number is active or reaches the gym. Only a recorded check by a person makes a number “reachability confirmed”: open a gym to record one." />
      <div className="mb-4"><Segmented current={status} options={TABS.map(([k, l]) => ({ key: k, label: l, href: `/crm/intel/phones?status=${k}` }))} /></div>
      <p className="mb-3 text-sm text-[var(--muted)]">{PHONE_STATUS_LABEL[status]}: {res.total.toLocaleString("en-IN")}</p>
      {res.rows.length ? <GymTable rows={res.rows} /> : <Empty>Nothing in this status.</Empty>}
      <div className="mt-4"><Pager page={res.page} pageSize={PAGE} total={res.total} href={(p) => `/crm/intel/phones?status=${status}&page=${p}`} /></div>
    </>
  );
}
