import { getCrmUser } from "@/lib/auth/crm";
import { exportLeads } from "@/lib/services/crm-io";
import { UserError } from "@/lib/services/errors";

/** The leads list as a CSV. The person is read from the session and the role decides, here and in the service: a role that can't export gets 403 and the attempt is audited. */
export async function GET(req: Request) {
  const u = await getCrmUser();
  if (!u) return new Response("Sign in first.", { status: 401 });
  const q = new URL(req.url).searchParams;
  const g = (k: string) => q.get(k) ?? undefined;
  try {
    const r = await exportLeads(u, { q: g("q"), stage: g("stage"), product: g("product"), ownerId: g("owner"), campaignId: g("campaign"), verification: g("verification") });
    return new Response(`﻿${r.csv}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${r.fileName}"`, "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof UserError) return new Response(e.message, { status: 403 });
    throw e;
  }
}
