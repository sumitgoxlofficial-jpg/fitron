import Link from "next/link";
import { requireCrm } from "@/lib/auth/crm";
import { openDups } from "@/lib/services/gym-intel/gyms";
import { Card, Empty, PageHeader } from "@/components/ui";
import { CrmForm } from "../../crm-form";
import { decideDupAction } from "../actions";

export const metadata = { title: "Duplicate review · FITRON CRM" };

type G = { id: string; name: string; phoneShown: string; address: string | null; city: string | null; pin: string | null; website: string | null; leadId: string | null };
const Side = ({ g, label }: { g: G; label: string }) => (
  <div className="rounded-[14px] border border-[var(--line)] p-4 text-sm">
    <div className="text-[11px] tracking-[0.12em] text-[var(--muted)] uppercase">{label}</div>
    <Link href={`/crm/intel/gyms/${g.id}`} className="font-semibold underline">{g.name}</Link>
    <div className="tabular-nums">{g.phoneShown || "no phone"}</div>
    <div className="text-[var(--muted)]">{[g.address, g.city, g.pin].filter(Boolean).join(", ") || "no address"}</div>
    {g.website && <div className="break-all text-xs text-[var(--muted)]">{g.website}</div>}
    {g.leadId && <div className="text-xs">CRM lead {g.leadId}</div>}
  </div>
);

export default async function DuplicatesPage() {
  const u = await requireCrm("intel.manage");
  const d = await openDups(u);
  return (
    <>
      <PageHeader kicker="Gym Intelligence" title="Duplicate review" subtitle={`${d.total} possible match${d.total === 1 ? "" : "es"} waiting. Two gyms are never merged just because they share a number or a similar name: branches often do.`} />
      {d.rows.length === 0 ? <Empty>Nothing to review.</Empty> : (
        <div className="flex flex-col gap-4">
          {d.rows.map((r) => (
            <Card key={r.id} title={`Match ${Math.round(r.score * 100)}%`} action={<span className="text-xs text-[var(--muted)]">{r.reasons.join(" · ")}</span>}>
              <div className="grid gap-3 sm:grid-cols-2"><Side g={r.a} label="Record A" /><Side g={r.b} label="Record B" /></div>
              <div className="mt-3 flex flex-wrap gap-2">
                <CrmForm action={decideDupAction} submit="Merge, keep A" className="contents"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="action" value="MERGE" /><input type="hidden" name="survivor" value={r.aId} /></CrmForm>
                <CrmForm action={decideDupAction} submit="Merge, keep B" className="contents"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="action" value="MERGE" /><input type="hidden" name="survivor" value={r.bId} /></CrmForm>
                <CrmForm action={decideDupAction} submit="Keep separate" className="contents"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="action" value="KEEP_SEPARATE" /></CrmForm>
                <CrmForm action={decideDupAction} submit="Dismiss" className="contents"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="action" value="DISMISS" /></CrmForm>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
