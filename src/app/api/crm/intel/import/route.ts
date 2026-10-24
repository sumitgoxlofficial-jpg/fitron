import { getCrmUser } from "@/lib/auth/crm";
import { CrmDenied } from "@/lib/services/crm-access";
import { UserError } from "@/lib/services/errors";
import { importPinDirectory } from "@/lib/services/gym-intel/geo";
import { importOsmFile } from "@/lib/services/gym-intel/jobs";

export const maxDuration = 300;

// Super Admin file uploads for Gym Intelligence: an OpenStreetMap (Overpass JSON) export, or the India Post PIN directory CSV.
// Files over about 4 MB can't be sent through the host; use the live OpenStreetMap collection for those.
export async function POST(req: Request) {
  const u = await getCrmUser();
  if (!u) return Response.json({ error: "Sign in again." }, { status: 401 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const kind = form?.get("kind");
  if (!(file instanceof File) || (kind !== "osm" && kind !== "pin")) return Response.json({ error: "Choose a file and what it is." }, { status: 400 });
  if (file.size > 4_400_000) return Response.json({ error: "That file is over 4 MB. Split it, or use the live collection." }, { status: 413 });
  try {
    const text = await file.text();
    return Response.json({ ok: true, ...(kind === "osm" ? await importOsmFile(u, text, file.name) : await importPinDirectory(u, text, file.name)) });
  } catch (e) {
    if (e instanceof UserError || e instanceof CrmDenied) return Response.json({ error: e.message }, { status: e instanceof CrmDenied ? 403 : 400 });
    throw e;
  }
}
