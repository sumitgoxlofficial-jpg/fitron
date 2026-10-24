import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCrm } from "@/lib/auth/crm";
import { listTasks } from "@/lib/services/crm-leads";
import { todayIso } from "@/lib/services/time";
import { Card, Empty, PageHeader, Segmented } from "@/components/ui";
import { fmtStamp } from "@/lib/format";
import { Button } from "@/components/ui";
import { doneAction } from "../actions";
import { LeadLink } from "../parts";

export const metadata = { title: "Tasks · FITRON CRM" };

export default async function TasksPage({ searchParams }: PageProps<"/crm/tasks">) {
  const u = await requireCrm();
  if (u.role === "admin") redirect("/crm"); // follow-ups belong to the employees; the dashboard shows the team's
  const sp = await searchParams;
  const scope = sp.scope === "team" && u.role !== "sales" ? "team" : "mine";
  const tasks = await listTasks(u, scope);
  const today = todayIso();
  const istDay = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  const open = tasks.filter((t) => !t.done);
  const groups = [
    { title: "Overdue", tone: "text-alert", rows: open.filter((t) => t.overdue) },
    { title: "Today", tone: "", rows: open.filter((t) => !t.overdue && istDay(t.dueAt) === today) },
    { title: "Upcoming", tone: "", rows: open.filter((t) => !t.overdue && istDay(t.dueAt) > today) },
    { title: "Completed", tone: "text-muted", rows: tasks.filter((t) => t.done).slice(-20) },
  ];
  return (
    <>
      <PageHeader kicker={scope === "team" ? "Your team" : "Assigned to you"} title="Tasks & follow-ups"
        actions={u.role !== "sales" ? <Segmented current={scope} options={[{ key: "mine", label: "Mine", href: "/crm/tasks" }, { key: "team", label: "Team", href: "/crm/tasks?scope=team" }]} /> : undefined} />
      <div className="flex flex-col gap-5">
        {groups.map((g) => (
          <Card key={g.title} title={`${g.title} · ${g.rows.length}`}>
            {g.rows.length === 0 ? <Empty>Nothing here.</Empty> : (
              <ul className="divide-y divide-fg/8">
                {g.rows.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <div className="min-w-0"><LeadLink id={t.lead.id}>{t.lead.gymName}</LeadLink> <span className="text-muted">· {t.lead.contactName}</span>
                      <div className={`text-xs ${g.tone || "text-muted"}`}>{t.type} · {fmtStamp(t.dueAt)}{scope === "team" ? ` · ${t.ownerName}` : ""}</div></div>
                    {!t.done && u.can("activity.log") && <form action={doneAction.bind(null, t.id, t.lead.id)}><Button className="px-3! py-1.5!">Done</Button></form>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted"><Link href="/crm/leads" className="underline">Open leads</Link> to add a follow-up.</p>
    </>
  );
}
