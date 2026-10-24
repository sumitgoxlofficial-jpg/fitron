import { getCrmUser } from "@/lib/auth/crm";
import { crmCan } from "@/lib/domain/crm";
import { EXPORTS, buildExport, type ExportKind } from "@/lib/services/gym-intel/export";
import { UserError } from "@/lib/services/errors";
import { CrmDenied, noteDenied } from "@/lib/services/crm-access";

export const maxDuration = 120;

// Super Admin only: the spreadsheet is built from the stored records, with the filters in the address.
export async function GET(req: Request) {
  const u = await getCrmUser();
  if (!u) return new Response("Sign in again.", { status: 401 });
  if (!crmCan(u.role, "intel.manage")) {
    await noteDenied(u, "gym database export");
    return new Response("Your role can't export the gym database.", { status: 403 });
  }
  const p = new URL(req.url).searchParams;
  const kind = (p.get("kind") ?? "master") as ExportKind;
  if (!(kind in EXPORTS)) return new Response("Unknown export.", { status: 400 });
  const g = (k: string) => p.get(k) || undefined;
  try {
    const out = await buildExport(u, kind, { state: g("state"), district: g("district"), city: g("city"), pin: g("pin"), phoneStatus: g("phoneStatus"), source: g("source"), promotion: g("promotion") }, p.get("format") === "csv" ? "csv" : "xlsx");
    return new Response(new Uint8Array(out.buffer), { headers: { "Content-Type": out.contentType, "Content-Disposition": `attachment; filename="${out.file}"`, "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof UserError || e instanceof CrmDenied) return new Response(e.message, { status: 400 });
    throw e;
  }
}
