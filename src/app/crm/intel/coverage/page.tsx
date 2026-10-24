import Link from "next/link";
import { requireCrm } from "@/lib/auth/crm";
import { coverage } from "@/lib/services/gym-intel/geo";
import { Card, Empty, Notice, PageHeader, ScrollRegion, TABLE, TD, TH, TR } from "@/components/ui";
import { GeoStatusBadge } from "../parts";
import { GEO_STATUSES } from "@/lib/domain/gym-intel/constants";

export const metadata = { title: "Geographic coverage · FITRON CRM" };

export default async function CoveragePage({ searchParams }: PageProps<"/crm/intel/coverage">) {
  const u = await requireCrm("intel.view");
  const sp = await searchParams;
  const state = typeof sp.state === "string" ? sp.state : "";
  const district = typeof sp.district === "string" ? sp.district : "";
  const c = await coverage(u, { state: state || undefined, district: district || undefined });
  const row = (r: { name: string; status: string; gyms: number; withPhone: number; missingPhone: number }, link?: string) => (
    <tr key={r.name} className={TR}>
      <td className={TD}>{link ? <Link href={link} className="underline">{r.name}</Link> : r.name}</td>
      <td className={TD}><GeoStatusBadge s={r.status} /></td>
      <td className={`${TD} text-right tabular-nums`}>{r.gyms}</td><td className={`${TD} text-right tabular-nums`}>{r.withPhone}</td><td className={`${TD} text-right tabular-nums`}>{r.missingPhone}</td>
    </tr>
  );
  const head = (first: string) => <thead><tr><th className={TH}>{first}</th><th className={TH}>Search status</th><th className={`${TH} text-right`}>Gyms found</th><th className={`${TH} text-right`}>With public phone</th><th className={`${TH} text-right`}>Missing phone</th></tr></thead>;
  return (
    <>
      <PageHeader kicker="Gym Intelligence · India → State/UT → District → PIN code" title="Geographic coverage" subtitle={`${c.areas} states and union territories${c.pinReferenceLoaded ? ` · ${c.pinTotal.toLocaleString("en-IN")} PIN codes loaded` : ""}`} />
      <div className="mb-4 flex flex-wrap gap-2">{GEO_STATUSES.map((s) => <span key={s} className="flex items-center gap-1.5 text-xs"><GeoStatusBadge s={s} /><b className="tabular-nums">{c.totals[s] ?? 0}</b></span>)}</div>
      {!c.pinReferenceLoaded && <div className="mb-4"><Notice tone="accent">The PIN code directory isn&apos;t loaded, so coverage is by state only. {u.can("intel.manage") && <>Load the India Post directory in <Link href="/crm/intel/transfer" className="underline">Import &amp; export</Link>.</>}</Notice></div>}
      <p className="mb-4 text-xs text-[var(--muted)]">A search with no results does not mean an area has no gyms, and a PIN code is searched through its state&apos;s query, not on its own. A PIN code is only called completed when its state&apos;s search finished.</p>
      {!state ? (
        <Card title="States and union territories"><ScrollRegion label="States"><table className={TABLE}>{head("State / UT")}<tbody>{c.states.map((r) => row(r, `/crm/intel/coverage?state=${encodeURIComponent(r.name)}`))}</tbody></table></ScrollRegion></Card>
      ) : (
        <>
          <p className="mb-3 text-sm"><Link href="/crm/intel/coverage" className="underline">India</Link> › {district ? <Link href={`/crm/intel/coverage?state=${encodeURIComponent(state)}`} className="underline">{state}</Link> : state}{district ? ` › ${district}` : ""}</p>
          {!district && c.districts.length > 0 && <Card title="Districts"><ScrollRegion label="Districts"><table className={TABLE}>{head("District")}<tbody>{c.districts.map((r) => row(r, `/crm/intel/coverage?state=${encodeURIComponent(state)}&district=${encodeURIComponent(r.name)}`))}</tbody></table></ScrollRegion></Card>}
          <div className="mt-5" />
          <Card title={`PIN codes${district ? ` in ${district}` : ""}`}>
            {c.pins.length === 0 ? <Empty>{c.pinReferenceLoaded ? "No PIN codes for this selection." : "Load the PIN directory to list PIN codes."}</Empty> : <ScrollRegion label="PIN codes"><table className={TABLE}>{head("PIN code")}<tbody>{c.pins.map((r) => row(r))}</tbody></table></ScrollRegion>}
          </Card>
        </>
      )}
    </>
  );
}
