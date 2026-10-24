import { requireCrm } from "@/lib/auth/crm";
import { CRM_PERMISSIONS, CRM_ROLES, CRM_ROLE_LABEL, crmCan, type CrmPermission } from "@/lib/domain/crm";
import { Notice, PageHeader, ScrollRegion, TABLE, TD, TH, TR } from "@/components/ui";

export const metadata = { title: "Roles & permissions · FITRON CRM" };

export default async function RolesPage() {
  await requireCrm("employees.manage");
  return (
    <>
      <PageHeader kicker="Read-only" title="Roles & permissions" subtitle="Every permission is checked on the server for each page, action and download. The browser never supplies its own role." />
      <div className="mb-4"><Notice>Marketing Head sees every lead with phone numbers and emails masked. A Sales Employee can&apos;t export; the attempt is refused and recorded.</Notice></div>
      <ScrollRegion label="Role permissions">
        <table className={TABLE}>
          <thead><tr><th className={TH}>Permission</th>{CRM_ROLES.map((r) => <th key={r} className={TH}>{CRM_ROLE_LABEL[r]}</th>)}</tr></thead>
          <tbody>
            {(Object.keys(CRM_PERMISSIONS) as CrmPermission[]).map((p) => (
              <tr key={p} className={TR}>
                <td className={TD}>{CRM_PERMISSIONS[p]}</td>
                {CRM_ROLES.map((r) => <td key={r} className={`${TD} ${crmCan(r, p) ? "text-ok" : "text-muted"}`}>{crmCan(r, p) ? "Allowed" : "—"}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
    </>
  );
}
