import { getCrmUser } from "@/lib/auth/crm";
import { reportCsv } from "@/lib/services/crm-insights";
import { UserError } from "@/lib/services/errors";
import { todayIso } from "@/lib/services/time";

/** The report as a CSV: the role decides, here and in the service; a role that can't export gets 403 and the attempt is audited. */
export async function GET(req: Request) {
  const u = await getCrmUser();
  if (!u) return new Response("Sign in first.", { status: 401 });
  const q = new URL(req.url).searchParams;
  const g = (k: string) => q.get(k) ?? undefined;
  try {
    const csv = await reportCsv(u, { range: g("range"), product: g("product"), campaignId: g("campaign"), ownerId: g("owner") });
    return new Response(`﻿${csv}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="fitron-report-${todayIso()}.csv"`, "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof UserError) return new Response(e.message, { status: 403 });
    throw e;
  }
}
