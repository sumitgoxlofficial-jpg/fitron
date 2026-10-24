"use client";

import { useState } from "react";
import { Field, Input, Select } from "@/components/ui";
import { LOSS_REASONS, PROOF_TYPES, STAGES, stageLabel } from "@/lib/domain/crm";
import type { FormState } from "@/lib/validation/common";
import { CrmForm } from "../../crm-form";

/** Changes the stage. Closing as lost, disqualifying and closing as won each ask for what the rules need; the server checks it again. */
export function StageForm({ action, current, initial, today, version, value }: { action: (s: FormState, fd: FormData) => Promise<FormState>; current: string; initial?: string; today: string; version: number; value: number }) {
  const [to, setTo] = useState(initial ?? current);
  return (
    <CrmForm action={action} submit="Update stage">
      <input type="hidden" name="version" value={version} />
      <Field label="Stage">
        <Select name="to" value={to} onChange={(e) => setTo(e.target.value)}>
          {STAGES.map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
        </Select>
      </Field>
      {(to === "Closed Lost" || to === "Disqualified") && (
        <Field label="Reason (required)">
          <Select name="lossReason" required defaultValue=""><option value="" disabled>Choose…</option>{LOSS_REASONS.map((r) => <option key={r}>{r}</option>)}</Select>
        </Field>
      )}
      {to === "Closed Won" && (
        <>
          <p className="text-[13px] text-muted">A closed deal waits for a manager&apos;s approval and is not counted as revenue until it is approved.</p>
          <Field label="Proof"><Select name="proofType" required defaultValue=""><option value="" disabled>Choose…</option>{PROOF_TYPES.map((p) => <option key={p}>{p}</option>)}</Select></Field>
          <Field label="Reference" hint="Payment reference or agreement number, at least 4 characters."><Input name="proofRef" required minLength={4} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Deal value (₹)"><Input name="value" inputMode="numeric" required defaultValue={value ? String(value / 100) : ""} /></Field>
            <Field label="Closed date"><Input name="closedDate" type="date" required max={today} defaultValue={today} /></Field>
          </div>
        </>
      )}
    </CrmForm>
  );
}
