import "server-only";
import { cache } from "react";
import { forbidden, notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import type { CrmPermission } from "@/lib/domain/crm";
import type { CrmUser } from "@/lib/services/crm-access";
import { crmUserFor } from "@/lib/services/crm-people";
import { readSession, sessionCheck } from "./session";

/** The signed-in CRM employee, or null: no session, not an employee, or deactivated. Read from the database on every request. */
export const getCrmUser = cache(async (): Promise<CrmUser | null> => {
  const session = await readSession();
  if (!session) return null;
  const user = await db.user.findFirst({ where: { id: session.userId, active: true, deletedAt: null }, select: { id: true, email: true } });
  return user ? crmUserFor(user.id, user.email) : null;
});

/** For every CRM page and action: sign in first, then be an employee (anyone else gets the plain 404 a wrong address gets), then hold the permission (else 403). */
export async function requireCrm(p?: CrmPermission): Promise<CrmUser> {
  const u = await getCrmUser();
  if (!u) {
    if (!(await readSession())) {
      const { endedBy, idleMinutes } = await sessionCheck();
      redirect(endedBy === "idle" ? `/login?idle=${idleMinutes}&next=/crm` : "/login?next=/crm");
    }
    notFound();
  }
  if (p && !u.can(p)) forbidden();
  return u;
}
