"use client";

import Link from "next/link";
import { useActionState } from "react";
import { verifyTwoStep } from "./actions";
import { Button, Field, Input, Notice } from "@/components/ui";

export function TwoStepForm() {
  const [state, action, pending] = useActionState(verifyTwoStep, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      {state?.message && <Notice tone="alert">{state.message}</Notice>}
      <Field label="Code from your authenticator app" hint="Six digits. Lost your phone? Type one of your recovery codes instead.">
        <Input name="code" inputMode="text" autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} required autoFocus maxLength={20} placeholder="123456" className="tracking-widest" />
      </Field>
      <Button variant="primary" disabled={pending} className="!rounded-full min-h-[50px] bg-gradient-to-b from-[#f3d88f] via-[#d9b45a] to-[#c49a3c] !text-[#17140d] text-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,.5),0_12px_26px_-8px_rgba(217,180,90,.5)] hover:brightness-105">
        {pending ? "Checking…" : "Verify and sign in"}
      </Button>
      <Link href="/login" className="self-start py-1 text-[13px] text-accent no-underline">
        Start again with a different account
      </Link>
    </form>
  );
}
