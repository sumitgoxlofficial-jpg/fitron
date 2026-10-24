import { requireCrm } from "@/lib/auth/crm";
import { myNotifications } from "@/lib/services/crm-people";
import { Button, Empty, PageHeader } from "@/components/ui";
import { fmtStamp } from "@/lib/format";
import { readAllAction } from "../actions";
import { LeadLink } from "../parts";

export const metadata = { title: "Notifications · FITRON CRM" };

export default async function NotificationsPage() {
  const u = await requireCrm();
  const rows = await myNotifications(u);
  return (
    <>
      <PageHeader kicker="In-app only" title="Notifications" subtitle="Assignments, deals waiting for approval and decisions appear here. WhatsApp and SMS alerts need an integration that isn't set up." actions={rows.some((r) => !r.read) ? <form action={readAllAction}><Button>Mark all read</Button></form> : undefined} />
      {rows.length === 0 ? <Empty>You&apos;re all caught up.</Empty> : (
        <ul className="divide-y divide-fg/8 rounded-lg border border-line bg-surface">
          {rows.map((n) => (
            <li key={n.id} className={`px-4 py-3 text-sm ${n.read ? "text-muted" : "font-semibold"}`}>
              {n.text}{n.leadId && <> · <LeadLink id={n.leadId} /></>}
              <div className="text-xs font-normal text-muted">{fmtStamp(n.createdAt)}</div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
