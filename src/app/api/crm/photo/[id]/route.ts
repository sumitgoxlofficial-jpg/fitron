import { getCrmUser } from "@/lib/auth/crm";
import { readCrmPhoto } from "@/lib/services/crm-profile";

// Employee photos are private: streamed only to signed-in employees.
export async function GET(_: Request, ctx: RouteContext<"/api/crm/photo/[id]">) {
  if (!(await getCrmUser())) return new Response("Sign in again.", { status: 401 });
  const { id } = await ctx.params;
  const r = await readCrmPhoto(id);
  if (!r) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(r.body), { headers: { "Content-Type": r.mime, "Cache-Control": "private, max-age=3600", "Content-Security-Policy": "sandbox; default-src 'none'" } });
}
