import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/current";
import { isFitronAdmin } from "@/lib/integrations/fitron-team";

/** FITRON team only (FITRON_ADMIN_EMAILS). Payments to FITRON go through Razorpay, so there is nothing to check by hand: on to the AI Trainer pages. */
export default async function FitronAdminPage() {
  const u = await requireUser();
  if (!isFitronAdmin(u.email)) notFound();
  redirect("/fitron-admin/trainer");
}
