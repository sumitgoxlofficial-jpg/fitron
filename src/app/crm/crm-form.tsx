"use client";

import { useActionState, type ComponentProps, type ReactNode } from "react";
import { Button, Notice } from "@/components/ui";
import type { FormState } from "@/lib/validation/common";

/** A form for a CRM action: shows what the server said (done, or why not) and refills what was typed after a refusal. */
export function CrmForm({ action, submit, children, className = "flex flex-col gap-3", variant = "primary", reset }: { action: (s: FormState, fd: FormData) => Promise<FormState>; submit: string; children: ReactNode; className?: string; variant?: ComponentProps<typeof Button>["variant"]; reset?: boolean }) {
  const [state, run, pending] = useActionState(action, undefined);
  return (
    <form action={run} key={reset && state?.ok ? state.nonce : undefined} className={className}>
      {state?.message && <Notice tone={state.ok ? "ok" : "alert"}>{state.message}</Notice>}
      {children}
      <div>
        <Button variant={variant} disabled={pending}>
          {pending ? "Saving…" : submit}
        </Button>
      </div>
    </form>
  );
}
