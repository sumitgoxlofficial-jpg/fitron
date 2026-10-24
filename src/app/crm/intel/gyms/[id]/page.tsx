import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCrm } from "@/lib/auth/crm";
import { SOURCES, type SourceKey } from "@/lib/domain/gym-intel/sources";
import { gymDetail } from "@/lib/services/gym-intel/gyms";
import { Badge, Card, Field, Input, PageHeader, ScrollRegion, Select, Textarea, TABLE, TD, TH, TR } from "@/components/ui";
import { CrmForm } from "../../../crm-form";
import { PhoneStatusBadge, when } from "../../parts";
import { promoteAction, reachabilityAction, reviewAction, suppressAction } from "../../actions";

export const metadata = { title: "Gym · FITRON CRM" };

export default async function GymPage({ params }: PageProps<"/crm/intel/gyms/[id]">) {
  const u = await requireCrm("intel.view");
  const { id } = await params;
  const d = await gymDetail(u, id);
  if (!d) notFound();
  const g = d.gym;
  const manage = u.can("intel.manage");
  const hidden = (n: string) => <input type="hidden" name={n === "id" ? "id" : n} value={g.id} />;
  return (
    <>
      <PageHeader kicker={`Gym Intelligence · ${g.id}`} title={g.name} subtitle={[g.address, g.city, g.district, g.state, g.pin].filter(Boolean).join(", ") || "No address published"} actions={<Link href="/crm/intel/gyms" className="text-sm underline">All gyms</Link>} />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <Card title="Business phone">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-[var(--font-head)] text-3xl tabular-nums">{g.phoneShown || "None published"}</span>
              <PhoneStatusBadge s={g.phoneStatus} />
              {g.phoneKind && <Badge>{g.phoneKind.toLowerCase().replace("_", " ")}</Badge>}
            </div>
            <p className="mb-0 mt-3 text-xs text-[var(--muted)]">As published: {g.phone ?? "—"}. This is the gym&apos;s business number, not the owner&apos;s direct line ({g.association.replace(/_/g, " ").toLowerCase()}). Reachability: {g.reachability.replace(/_/g, " ").toLowerCase()}. A valid format and a source match do not prove the number works.</p>
            {g.website && <p className="mb-0 mt-2 text-sm">Website: <a href={g.website} className="underline" rel="noopener noreferrer nofollow" target="_blank">{g.website}</a></p>}
          </Card>
          <Card title="Evidence">
            <ScrollRegion label="Source evidence">
              <table className={TABLE}>
                <thead><tr><th className={TH}>Source</th><th className={TH}>Said</th><th className={TH}>Collected</th><th className={TH}>Last checked</th></tr></thead>
                <tbody>
                  {g.sources.map((s) => (
                    <tr key={s.id} className={TR}>
                      <td className={TD}><b>{SOURCES[s.source as SourceKey]?.name ?? s.source}</b><div className="max-w-[260px] break-all text-xs">{/^https?:/.test(s.sourceUrl) ? <a href={s.sourceUrl} className="underline" rel="noopener noreferrer nofollow" target="_blank">{s.sourceUrl}</a> : s.sourceUrl}</div><div className="text-xs text-[var(--muted)]">{s.licenseRef}</div></td>
                      <td className={TD}>{s.originalName}<div className="text-xs tabular-nums text-[var(--muted)]">{s.phonesShown.join(", ") || "no number"}</div>{s.originalAddress && <div className="text-xs text-[var(--muted)]">{s.originalAddress}</div>}</td>
                      <td className={`${TD} whitespace-nowrap`}>{when(s.collectedAt)}</td>
                      <td className={`${TD} whitespace-nowrap`}>{when(s.lastCheckedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          </Card>
          {d.dups.length > 0 && (
            <Card title="Possible duplicates">
              <ul className="m-0 list-none p-0 text-sm">{d.dups.map((x) => { const o = x.aId === g.id ? x.b : x.a; return <li key={x.id} className="py-1.5"><Link href={`/crm/intel/gyms/${o.id}`} className="underline">{o.name}</Link> · {[o.city, o.pin].filter(Boolean).join(" ")} · {x.reasons.join(", ")}</li>; })}</ul>
              {manage && <Link href="/crm/intel/duplicates" className="text-sm underline">Review duplicates</Link>}
            </Card>
          )}
        </div>
        <div className="flex flex-col gap-5">
          <Card title="CRM">
            {g.lead ? <p className="m-0 text-sm">Lead <Link href={`/crm/leads/${g.lead.id}`} className="underline">{g.lead.id}</Link> · stage {g.lead.stage}. The sales pipeline lives there; this record keeps its discovery evidence.</p> : (
              <p className="m-0 text-sm text-[var(--muted)]">Not a CRM lead ({g.promotion.replace(/_/g, " ").toLowerCase()}).</p>
            )}
            {manage && !g.lead && (
              <div className="mt-3 flex flex-col gap-3">
                <CrmForm action={promoteAction} submit="Promote to CRM lead">{hidden("id")}<input type="hidden" name="action" value="PROMOTE" /></CrmForm>
                <div className="flex flex-wrap gap-2">
                  <CrmForm action={promoteAction} submit="Skip" className="contents">{hidden("id")}<input type="hidden" name="action" value="SKIP" /></CrmForm>
                  <CrmForm action={promoteAction} submit="Flag as duplicate lead" className="contents">{hidden("id")}<input type="hidden" name="action" value="FLAG_DUPLICATE" /></CrmForm>
                </div>
              </div>
            )}
          </Card>
          {manage && (
            <>
              <Card title="Record a verification">
                <CrmForm action={reachabilityAction} submit="Save check">
                  {hidden("id")}
                  <Field label="Result"><Select name="result" defaultValue="CONFIRMED"><option value="CONFIRMED">Reaches the gym</option><option value="UNREACHABLE">Doesn&apos;t reach the gym</option><option value="NOT_TESTED">Clear (not tested)</option></Select></Field>
                  <Field label="How you checked" hint="Who you spoke to, or what you saw. Lawful checks only: no OTP tricks, no calling people who asked not to be called."><Textarea name="evidence" rows={3} required /></Field>
                </CrmForm>
              </Card>
              <Card title="Review">
                <p className="mt-0 text-xs text-[var(--muted)]">Status: {g.reviewStatus.toLowerCase()}</p>
                <div className="flex flex-wrap gap-2">
                  {(["REVIEWED", "REJECTED", "NEW"] as const).map((st) => <CrmForm key={st} action={reviewAction} submit={st === "REVIEWED" ? "Mark reviewed" : st === "REJECTED" ? "Reject record" : "Reset"} className="contents">{hidden("id")}<input type="hidden" name="status" value={st} /></CrmForm>)}
                </div>
              </Card>
              {g.phoneNorm && (
                <Card title="Do not contact">
                  <CrmForm action={suppressAction} submit="Add number to do-not-contact" variant="danger">{hidden("id")}<Field label="Reason"><Input name="reason" placeholder="Asked not to be called" /></Field></CrmForm>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
