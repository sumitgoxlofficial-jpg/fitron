import Link from "next/link";
import { requireCrm } from "@/lib/auth/crm";
import { listAudit } from "@/lib/services/crm-people";
import { Button, PageHeader, Pager, ScrollRegion, Select, TABLE, TD, TH, TR } from "@/components/ui";
import { fmtStamp } from "@/lib/format";
import { LeadLink } from "../parts";

export const metadata = { title: "Audit log · FITRON CRM" };
const KINDS = ["create", "assign", "stage", "call", "task", "verify", "export", "import", "user", "denied"];

export default async function AuditPage({ searchParams }: PageProps<"/crm/audit">) {
  const u = await requireCrm("audit.view");
  const sp = await searchParams;
  const kind = typeof sp.kind === "string" && KINDS.includes(sp.kind) ? sp.kind : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const a = await listAudit(u, { kind, page });
  return (
    <>
      <PageHeader kicker="Append-only" title="Audit log" subtitle="Nobody can edit or remove an entry. It never holds phone numbers or email addresses." />
      <form className="mb-4 flex gap-2">
        <Select name="kind" defaultValue={kind} className="w-auto"><option value="">All events</option>{KINDS.map((k) => <option key={k}>{k}</option>)}</Select>
        <Button>Filter</Button>
        {kind && <Link href="/crm/audit" className="self-center text-sm underline">Clear</Link>}
      </form>
      <ScrollRegion label="Audit log">
        <table className={TABLE}>
          <thead><tr><th className={TH}>When</th><th className={TH}>Who</th><th className={TH}>Event</th><th className={TH}>Lead</th><th className={TH}>What</th></tr></thead>
          <tbody>
            {a.rows.map((r) => (
              <tr key={r.id} className={TR}>
                <td className={`${TD} whitespace-nowrap`}>{fmtStamp(r.at)}</td><td className={TD}>{r.actor}</td><td className={TD}>{r.kind}</td>
                <td className={TD}>{r.leadId ? <LeadLink id={r.leadId} /> : "—"}</td><td className={TD}>{r.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
      <div className="mt-4"><Pager page={page} pageSize={a.size} total={a.total} href={(p) => `/crm/audit?${new URLSearchParams({ ...(kind ? { kind } : {}), page: String(p) })}`} /></div>
    </>
  );
}
