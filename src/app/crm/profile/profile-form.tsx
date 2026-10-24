"use client";

import { useActionState, useState, type ComponentProps, type ReactNode } from "react";
import { TERMS, TERMS_EFFECTIVE, TERMS_VERSION } from "@/lib/domain/crm-pay";
import type { FormState } from "@/lib/validation/common";
import { saveProfileAction } from "../actions";

const field = "min-h-11 w-full rounded-[10px] border border-[var(--line-2)] bg-[var(--input)] px-3 py-2 text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none";
const Label = ({ t, children }: { t: string; children: ReactNode }) => <label className="flex flex-col gap-1.5 text-xs text-[var(--muted)]">{t}{children}</label>;
const In = (p: ComponentProps<"input">) => <input {...p} className={field} />;
const Panel = ({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) => (
  <section className="flex flex-col gap-3.5 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-[22px]">
    <div className="flex flex-wrap items-center justify-between gap-2.5"><h2 className="m-0">{title}</h2>{aside}</div>
    {children}
  </section>
);

export type ProfileData = { empId: string; email: string; name: string; role: string; profile: { fullName: string; phone: string; address: string; city: string; state: string; pin: string }; payout: { method: "bank" | "upi"; text: string; accName: string; bankName: string; upi: string; upiName: string; last4: string } | null; termsAccepted: boolean; termsAcceptedText: string; needsSetup: boolean };

/** The profile, payout account and terms page from the design. A saved account number is never sent back to the browser: leave it empty to keep it. */
export function ProfileForm({ d }: { d: ProfileData }) {
  const [state, run, pending] = useActionState<FormState, FormData>(saveProfileAction, undefined);
  const v = (k: string, dflt = "") => (state?.values?.[k] as string | undefined) ?? dflt;
  const [method, setMethod] = useState<"bank" | "upi">(d.payout?.method ?? "bank");
  const p = d.profile;
  const keep = d.payout?.method === "bank" && method === "bank";
  return (
    <form action={run} key={state?.nonce} className="flex max-w-[880px] flex-col gap-6">
      <input type="hidden" name="payMethod" value={method} />
      {d.needsSetup && <div className="rounded-[14px] border border-[var(--line-2)] bg-[var(--accent-soft)] px-[18px] py-3.5 text-[13px] leading-relaxed">Complete your profile, add a bank account or UPI ID, and accept the terms to start using the CRM. Your earnings are paid to this account.</div>}
      <Panel title="Personal details">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-3">
          <Label t="Full name (as per bank)"><In name="fullName" autoComplete="name" defaultValue={v("fullName", p.fullName)} /></Label>
          <Label t="Mobile number"><In name="phone" inputMode="tel" autoComplete="tel" placeholder="98xxxxxxxx" defaultValue={v("phone", p.phone)} /></Label>
        </div>
        <Label t="Address"><In name="address" autoComplete="street-address" placeholder="House / flat, street, area" defaultValue={v("address", p.address)} /></Label>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))] gap-3">
          <Label t="City"><In name="city" defaultValue={v("city", p.city)} /></Label>
          <Label t="State"><In name="state" defaultValue={v("state", p.state)} /></Label>
          <Label t="PIN code"><In name="pin" inputMode="numeric" maxLength={6} defaultValue={v("pin", p.pin)} /></Label>
        </div>
      </Panel>

      <Panel title="Payout account" aside={
        <div className="flex gap-1 rounded-full border border-[var(--line)] p-1">
          {(["bank", "upi"] as const).map((m) => <button key={m} type="button" onClick={() => setMethod(m)} className={`min-h-[34px] rounded-full px-4 text-xs font-semibold ${method === m ? "bg-gradient-to-b from-[#f3d88f] via-[#d9b45a] to-[#c49a3c] text-[#17140d]" : ""}`}>{m === "bank" ? "Bank account" : "UPI"}</button>)}
        </div>}>
        {method === "bank" ? (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-3">
            <Label t="Account holder name"><In name="accName" defaultValue={v("accName", d.payout?.accName ?? "")} /></Label>
            <Label t="Bank name"><In name="bankName" placeholder="e.g. HDFC Bank" defaultValue={v("bankName", d.payout?.bankName ?? "")} /></Label>
            <Label t="Account number"><In name="accNo" type="password" inputMode="numeric" autoComplete="off" placeholder={keep ? `Saved ••••${d.payout!.last4}. Leave empty to keep` : ""} /></Label>
            <Label t="Confirm account number"><In name="accNo2" inputMode="numeric" autoComplete="off" placeholder={keep ? "Only when changing it" : ""} /></Label>
            <Label t="IFSC code"><In name="ifsc" placeholder="HDFC0001234" maxLength={11} className="uppercase" defaultValue={v("ifsc")} /></Label>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-3">
            <Label t="UPI ID"><In name="upi" placeholder="name@okhdfcbank" autoComplete="off" defaultValue={v("upi", d.payout?.upi ?? "")} /></Label>
            <Label t="Name on UPI account"><In name="upiName" defaultValue={v("upiName", d.payout?.upiName ?? "")} /></Label>
          </div>
        )}
        <span className="text-xs text-[var(--faint)]">{d.payout ? `On file: ${d.payout.text}. ` : ""}Your account details are stored encrypted and shown back only in part. Changes apply from the next payout, are logged, and the Super Admin is told.</span>
      </Panel>

      {(d.needsSetup || !d.termsAccepted) ? (
        <Panel title="Terms & conditions" aside={<span className="text-xs text-[var(--faint)]">Terms {TERMS_VERSION} · effective {TERMS_EFFECTIVE}</span>}>
          <ol className="m-0 flex max-h-[280px] flex-col gap-2.5 overflow-y-auto rounded-[10px] border border-[var(--line)] bg-[var(--input)] py-4 pr-[18px] pl-9 text-[13px] leading-relaxed text-[var(--text-2)]">
            {TERMS.map(([h, b]) => <li key={h}><strong className="text-[var(--text)]">{h}.</strong> {b}</li>)}
          </ol>
          <label className="flex cursor-pointer items-start gap-2.5 text-[13px] leading-normal"><input type="checkbox" name="agree" className="mt-px size-5 shrink-0 accent-[var(--accent)]" /><span>I have read and accept these terms, including that my earnings will be paid to the account above by the 2nd of every month.</span></label>
        </Panel>
      ) : <span className="text-[13px] text-[var(--accent-strong)]">{d.termsAcceptedText}</span>}

      {state?.message && <span role={state.ok ? "status" : "alert"} className={`text-[13px] ${state.ok ? "text-[var(--ok)]" : "text-[var(--alert-strong)]"}`}>{state.message}</span>}
      <div><button disabled={pending} className="min-h-12 rounded-full bg-gradient-to-b from-[#f3d88f] via-[#d9b45a] to-[#c49a3c] px-[26px] text-sm font-bold text-[#17140d] disabled:opacity-60">{pending ? "Saving…" : d.needsSetup ? "Save and continue" : "Save profile"}</button></div>
    </form>
  );
}
