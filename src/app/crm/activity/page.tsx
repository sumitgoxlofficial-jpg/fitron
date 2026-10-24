import Link from "next/link";
import { requireCrm } from "@/lib/auth/crm";
import { ACTIVITY_KINDS, activityFeed } from "@/lib/services/crm-insights";
import { fmtTime, initials } from "@/lib/format";
import { Button, Select } from "@/components/ui";
import { LeadLink } from "../parts";

export const metadata = { title: "Activity · FITRON CRM" };
const KIND_LABEL: Record<string, string> = { call: "Call or note", stage: "Stage change", assign: "Assignment", verify: "Verification", task: "Task", create: "New lead or contact", import: "Import", export: "Export", user: "Account" };

export default async function ActivityPage({ searchParams }: PageProps<"/crm/activity">) {
  const u = await requireCrm();
  const sp = await searchParams;
  const person = typeof sp.person === "string" ? sp.person : "";
  const kind = typeof sp.kind === "string" ? sp.kind : "";
  const feed = await activityFeed(u, { person, kind });
  const mine = u.role === "sales";
  const day = (iso: string) => new Date(`${iso}T00:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" });
  return (
    <section className="flex max-w-[900px] flex-col gap-5">
      <div className="flex flex-col gap-2"><span className="text-[11px] font-semibold tracking-[0.24em] text-[var(--accent)] uppercase">{mine ? "Your actions" : u.can("leads.all") ? "All leads" : "Your team's leads"}</span><h1 className="m-0">{mine ? "My activity" : "Activity"}</h1><span className="text-[13px] text-[var(--muted)]">Calls, notes, stage changes, assignments and approvals, newest first.</span></div>
      <form className="flex flex-wrap gap-2.5">
        {!mine && <Select name="person" defaultValue={person} aria-label="Person" className="w-auto!"><option value="">Everyone</option>{feed.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>}
        <Select name="kind" defaultValue={kind} aria-label="Activity type" className="w-auto!"><option value="">All activity</option>{ACTIVITY_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</Select>
        <Button>Filter</Button>{(person || kind) && <Link href="/crm/activity" className="self-center text-sm underline">Clear</Link>}
      </form>
      {feed.days.length === 0 ? <div className="rounded-2xl border border-dashed border-[var(--line-2)] p-8 text-center text-[var(--muted)]">No activity matches these filters.</div> : feed.days.map((d) => (
        <div key={d.day} className="flex flex-col gap-1">
          <span className="pb-1 text-[11px] font-bold tracking-[0.18em] text-[var(--muted)] uppercase">{day(d.day)}</span>
          <div className="flex flex-col rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-[18px] py-1.5">
            {d.items.map((a) => (
              <div key={a.id} className="flex gap-3 border-b border-[var(--line-soft)] py-2.5 last:border-0">
                {a.hasPhoto ? (
                  // eslint-disable-next-line @next/next/no-img-element -- private, session-checked image
                  <img src={`/api/crm/photo/${a.actorId}`} alt="" className="size-8 shrink-0 rounded-full border border-[var(--line-2)] object-cover" />
                ) : (
                  <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full border border-[var(--line-2)] bg-[var(--surface-2)] font-[var(--font-head)] text-xs font-semibold text-[var(--accent-strong)]">{initials(a.actor)}</span>
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[13px] leading-snug"><b>{a.actor}</b> <span className="text-[var(--text-2)]">{a.text}</span></span>
                  <span className="text-[11px] text-[var(--faint)]">{KIND_LABEL[a.kind] ?? a.kind} · {fmtTime(a.at)}{a.leadId && <> · <LeadLink id={a.leadId}>{a.gym ?? a.leadId}</LeadLink></>}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
