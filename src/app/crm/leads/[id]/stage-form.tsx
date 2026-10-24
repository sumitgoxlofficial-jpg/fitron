"use client";

import { useState } from "react";
import { Field, Input, Select } from "@/components/ui";
import { LOSS_REASONS, PROOF_TYPES, STAGES, stageLabel } from "@/lib/domain/crm";
import { ADD_ON_KEYS, ADD_ON_LABEL, ADD_ON_PRICE, SELLABLE, dealValue, type AddOn } from "@/lib/domain/crm-plans";
import { formatRupees } from "@/lib/format";
import type { FormState } from "@/lib/validation/common";
import { CrmForm } from "../../crm-form";

/** Changes the stage. Closing as lost, disqualifying and closing as won each ask for what the rules need; the server checks it again. */
export function StageForm({ action, current, initial, today, version, plan: plan0, billing: billing0 }: { action: (s: FormState, fd: FormData) => Promise<FormState>; current: string; initial?: string; today: string; version: number; plan: string; billing: string }) {
  const [to, setTo] = useState(initial ?? current);
  const [plan, setPlan] = useState(plan0);
  const [billing, setBilling] = useState(billing0);
  const [addons, setAddons] = useState<AddOn[]>([]);
  const total = dealValue({ plan, billing, addons });
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
      {to === "Closed Won" && current !== "Closed Won" && (
        <>
          <p className="text-[13px] text-muted">A closed deal waits for a manager&apos;s approval and is not counted as revenue until it is approved.</p>
          <Field label="Proof"><Select name="proofType" required defaultValue=""><option value="" disabled>Choose…</option>{PROOF_TYPES.map((p) => <option key={p}>{p}</option>)}</Select></Field>
          <Field label="Reference" hint="Payment reference or agreement number, at least 4 characters."><Input name="proofRef" required minLength={4} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Plan sold"><Select name="plan" value={plan} onChange={(e) => setPlan(e.target.value)}>{SELLABLE.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</Select></Field>
            <Field label="Billing"><Select name="billing" value={billing} onChange={(e) => setBilling(e.target.value)}><option value="MONTHLY">Monthly</option><option value="YEARLY">Yearly</option></Select></Field>
          </div>
          <fieldset className="flex flex-col gap-1.5 border-0 p-0">
            <legend className="mb-1 text-xs text-[var(--muted)]">Add-ons</legend>
            {ADD_ON_KEYS.map((k) => (
              <label key={k} className="flex items-center gap-2.5 text-[13px]"><input type="checkbox" name="addons" value={k} checked={addons.includes(k)} onChange={(e) => setAddons(e.target.checked ? [...addons, k] : addons.filter((x) => x !== k))} className="size-[18px] accent-[var(--accent)]" />{ADD_ON_LABEL[k]} · {formatRupees(ADD_ON_PRICE[k])}</label>
            ))}
          </fieldset>
          <div className="flex items-baseline justify-between rounded-[10px] bg-[var(--accent-soft)] px-3.5 py-2.5 text-[13px]"><span>Deal value (GST included)</span><b className="font-[var(--font-head)] text-xl text-[var(--accent-strong)]">{formatRupees(total)}</b></div>
          <Field label="Closed date"><Input name="closedDate" type="date" required max={today} defaultValue={today} /></Field>
        </>
      )}
    </CrmForm>
  );
}
