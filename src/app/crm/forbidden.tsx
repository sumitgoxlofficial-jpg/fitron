import Link from "next/link";
import { LinkButton } from "@/components/ui";

export const metadata = { title: "Access denied · FITRON CRM" };

/** The 403 page: a lead, an action or a screen outside the person's role. */
export default function Forbidden() {
  return (
    <div className="mx-auto mt-24 max-w-md text-center">
      <div className="text-[11px] tracking-[0.1em] text-muted uppercase">Error 403</div>
      <h1 className="mt-1 text-[32px] font-semibold">Access denied</h1>
      <p className="mt-2 text-sm text-muted">Your role doesn&apos;t have access to this. If you think it should, ask a Super Admin. The attempt has been noted in the audit log.</p>
      <div className="mt-6 flex justify-center gap-2">
        <LinkButton href="/crm" variant="primary">Back to the dashboard</LinkButton>
        <Link href="/crm/leads" className="inline-flex items-center rounded-md border border-line px-[18px] py-2.5 text-sm font-semibold hover:bg-fg/7">My leads</Link>
      </div>
    </div>
  );
}
