import Link from "next/link";
import { Badge, ScrollRegion, TABLE, TD, TH, TR, type Tone } from "@/components/ui";
import { GEO_STATUSES, PHONE_STATUS_LABEL, type PhoneStatus } from "@/lib/domain/gym-intel/constants";

const PHONE_TONE: Record<string, Tone> = { SOURCE_CONFIRMED: "ok", REACHABILITY_CONFIRMED: "ok", FORMAT_VALID: "accent", UNTESTED: "neutral", INVALID_FORMAT: "alert", CONFLICTING_SOURCES: "alert", STALE: "neutral", UNAVAILABLE: "alert" };
export const PhoneStatusBadge = ({ s }: { s: string }) => <Badge tone={PHONE_TONE[s] ?? "neutral"}>{PHONE_STATUS_LABEL[s as PhoneStatus] ?? s}</Badge>;

const GEO_TONE: Record<string, Tone> = { COMPLETED_WITH_RESULTS: "ok", COMPLETED_NO_RESULTS: "neutral", IN_PROGRESS: "accent", QUEUED: "accent", PARTIALLY_COMPLETED: "accent", FAILED: "alert", REQUIRES_REVIEW: "alert", NOT_STARTED: "neutral" };
export const GeoStatusBadge = ({ s }: { s: string }) => <Badge tone={GEO_TONE[s] ?? "neutral"}>{s.replace(/_/g, " ").toLowerCase()}</Badge>;
export { GEO_STATUSES };

const JOB_TONE: Record<string, Tone> = { COMPLETED: "ok", RUNNING: "accent", QUEUED: "accent", PAUSED: "neutral", FAILED: "alert", CANCELLED: "neutral", DRAFT: "neutral" };
export const JobStatusBadge = ({ s }: { s: string }) => <Badge tone={JOB_TONE[s] ?? "neutral"}>{s.toLowerCase()}</Badge>;

type G = { id: string; name: string; phoneShown: string; phoneKind: string | null; phoneStatus: string; state: string | null; district: string | null; city: string | null; pin: string | null; promotion: string; leadId: string | null; _count?: { sources: number } };

export function GymTable({ rows }: { rows: G[] }) {
  return (
    <ScrollRegion label="Gyms">
      <table className={TABLE}>
        <thead><tr><th className={TH}>Gym</th><th className={TH}>Business phone</th><th className={TH}>Phone status</th><th className={TH}>Place</th><th className={TH}>PIN</th><th className={`${TH} text-right`}>Sources</th><th className={TH}>CRM</th></tr></thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.id} className={TR}>
              <td className={TD}><Link href={`/crm/intel/gyms/${g.id}`} className="font-semibold underline">{g.name}</Link><div className="text-xs text-[var(--muted)]">{g.id}</div></td>
              <td className={`${TD} whitespace-nowrap tabular-nums`}>{g.phoneShown || <span className="text-[var(--muted)]">none published</span>}{g.phoneKind && <div className="text-xs text-[var(--muted)]">{g.phoneKind.toLowerCase().replace("_", " ")}</div>}</td>
              <td className={TD}><PhoneStatusBadge s={g.phoneStatus} /></td>
              <td className={TD}>{[g.city, g.district, g.state].filter(Boolean).join(", ") || "—"}</td>
              <td className={`${TD} tabular-nums`}>{g.pin ?? "—"}</td>
              <td className={`${TD} text-right tabular-nums`}>{g._count?.sources ?? "—"}</td>
              <td className={TD}>{g.leadId ? <Link href={`/crm/leads/${g.leadId}`} className="underline">{g.leadId}</Link> : <span className="text-xs text-[var(--muted)]">{g.promotion.replace(/_/g, " ").toLowerCase()}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

export const when = (d: Date | null | undefined) => (d ? new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) : "—");
