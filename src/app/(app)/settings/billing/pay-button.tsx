"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Select } from "@/components/ui";
import { formatInr } from "@/lib/format";
import type { Checkout, PaymentFor } from "@/lib/services/saas";
import { confirmCheckoutAction, confirmDemoAction, confirmSubscriptionAction, startPaymentAction, submitUtrAction } from "./actions";

/** What Checkout hands back: an order's id for one payment, or a subscription's id for a plan that renews itself. */
type RazorpayResponse = {
  razorpay_order_id?: string;
  razorpay_subscription_id?: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};
type RazorpayCtor = new (o: Record<string, unknown>) => {
  open(): void;
  on(ev: string, fn: (r: { error?: { description?: string } }) => void): void;
};

function loadCheckout(): Promise<RazorpayCtor> {
  const w = window as unknown as { Razorpay?: RazorpayCtor };
  if (w.Razorpay) return Promise.resolve(w.Razorpay);
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => (w.Razorpay ? res(w.Razorpay) : rej(new Error("Checkout didn't load")));
    s.onerror = () => rej(new Error("Couldn't load Razorpay Checkout. Check the internet connection."));
    document.head.appendChild(s);
  });
}

type Upi = Extract<Checkout, { mode: "UPI" }>;

/** Scan-and-pay to FITRON's UPI ID, then the UTR. The FITRON team confirms it. */
function UpiPanel({ c, onClose }: { c: Upi; onClose: () => void }) {
  const router = useRouter();
  const [utr, setUtr] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "alert"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const sent = msg?.tone === "ok";

  const submit = () =>
    start(async () => {
      const r = await submitUtrAction(c.id, utr);
      if (!r.ok) return setMsg({ tone: "alert", text: r.error });
      setMsg({ tone: "ok", text: "Thanks. We're checking the payment and will confirm by email. You can keep using FITRON meanwhile." });
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line p-4 text-sm">
      <p className="font-semibold">Pay {formatInr(c.total)} by UPI</p>
      {!sent && (
        <>
          <div className="flex flex-col items-center gap-2 sm:flex-row sm:items-start">
            {/* The SVG is made on the server by the qrcode library from FITRON's own UPI link. */}
            <div className="w-44 shrink-0 rounded-md bg-white p-2" aria-label="UPI QR code" role="img" dangerouslySetInnerHTML={{ __html: c.qr }} />
            <ol className="list-decimal space-y-1 pl-5">
              <li>Scan the QR with any UPI app (GPay, PhonePe, Paytm, BHIM), or <a href={c.link} className="text-accent underline">open your UPI app</a> on this phone.</li>
              <li>
                Pay <strong>{formatInr(c.total)}</strong> to <strong>{c.payee}</strong> ({c.upiId}). Reference: <strong>{c.ref}</strong>.
              </li>
              <li>Copy the 12-digit UTR (also called UPI reference or transaction ID) from the app and enter it below.</li>
            </ol>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input value={utr} onChange={(e) => setUtr(e.target.value)} inputMode="numeric" placeholder="12-digit UTR" aria-label="UTR number" className="w-48" maxLength={20} />
            <Button variant="primary" type="button" onClick={submit} disabled={pending || utr.replace(/\s/g, "").length < 12}>
              {pending ? "Sending…" : "I've paid"}
            </Button>
            <Button type="button" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
          </div>
        </>
      )}
      {msg && <p className={msg.tone === "ok" ? "text-ok" : "text-alert"}>{msg.text}</p>}
    </div>
  );
}

/** Pay FITRON for the gym's plan, an extra branch (new slot, or renewing one) or a one-time add-on. */
export function PayButton({
  what,
  label,
  prices,
  success,
  fixedCycle,
  wide,
}: {
  what: PaymentFor;
  label: string;
  /** Shown in the cycle picker; not needed when the cycle is fixed. */
  prices?: { MONTHLY: number; YEARLY: number };
  success: string;
  /** Set when the cycle is picked outside the button (the plan cards' Monthly/Yearly switch), or ONCE for an add-on. */
  fixedCycle?: "YEARLY" | "MONTHLY" | "ONCE";
  wide?: boolean;
}) {
  const router = useRouter();
  const [picked, setCycle] = useState<"YEARLY" | "MONTHLY">("YEARLY");
  const cycle: "YEARLY" | "MONTHLY" | "ONCE" = fixedCycle ?? picked;
  const [msg, setMsg] = useState<{ tone: "ok" | "alert"; text: string } | null>(null);
  const [upi, setUpi] = useState<Upi | null>(null);
  const [pending, start] = useTransition();

  const done = (r: { ok: boolean; error?: string }) => {
    if (!r.ok) return setMsg({ tone: "alert", text: r.error ?? "Payment failed." });
    setMsg({ tone: "ok", text: success });
    router.refresh();
  };

  const pay = () =>
    start(async () => {
      setMsg(null);
      const r = await startPaymentAction(what, cycle);
      if (!r.ok) return setMsg({ tone: "alert", text: r.error });
      const c = r.data;
      if (c.mode === "UPI") return setUpi(c);
      if (c.mode === "DEMO") {
        if (!window.confirm(`Demo mode: FITRON's UPI ID isn't set on this server, so no money is charged. Mark ${formatInr(c.total)} as paid?`)) return;
        return done(await confirmDemoAction(c.id));
      }
      try {
        const Razorpay = await loadCheckout();
        const common = { key: c.keyId, name: c.name, description: c.description, prefill: c.prefill, theme: { color: "#cfa94f" } };
        const rz =
          c.mode === "SUBSCRIPTION"
            ? new Razorpay({
                ...common,
                subscription_id: c.subscriptionId,
                handler: (resp: RazorpayResponse) =>
                  start(async () => {
                    const res = await confirmSubscriptionAction({ paymentId: resp.razorpay_payment_id, subscriptionId: resp.razorpay_subscription_id ?? c.subscriptionId, signature: resp.razorpay_signature });
                    if (res.ok && res.data.status === "PROCESSING") {
                      setMsg({ tone: "ok", text: "Payment received. Razorpay is still confirming it; your plan turns on within a few minutes and you'll get an email." });
                      router.refresh();
                      return;
                    }
                    done(res);
                  }),
              })
            : new Razorpay({
                ...common,
                order_id: c.orderId,
                amount: c.total,
                currency: "INR",
                handler: (resp: RazorpayResponse) =>
                  start(async () =>
                    done(
                      await confirmCheckoutAction({
                        orderId: resp.razorpay_order_id ?? "",
                        paymentId: resp.razorpay_payment_id,
                        signature: resp.razorpay_signature,
                      }),
                    ),
                  ),
              });
        rz.on("payment.failed", (e) =>
          setMsg({
            tone: "alert",
            text: e.error?.description ?? "The payment failed. No money was taken.",
          }),
        );
        rz.open();
      } catch (e) {
        setMsg({ tone: "alert", text: (e as Error).message });
      }
    });

  if (upi) return <UpiPanel c={upi} onClose={() => setUpi(null)} />;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {!fixedCycle && prices && (
          <Select value={cycle} onChange={(e) => setCycle(e.target.value as "YEARLY" | "MONTHLY")} aria-label="Billing cycle" className="w-auto">
            <option value="YEARLY">Yearly · {formatInr(prices.YEARLY)}</option>
            <option value="MONTHLY">Monthly · {formatInr(prices.MONTHLY)}</option>
          </Select>
        )}
        <Button variant="primary" onClick={pay} disabled={pending} type="button" className={wide ? "w-full" : undefined}>
          {pending ? "Working…" : label}
        </Button>
      </div>
      {msg && <p className={msg.tone === "ok" ? "text-sm text-ok" : "text-sm text-alert"}>{msg.text}</p>}
    </div>
  );
}
