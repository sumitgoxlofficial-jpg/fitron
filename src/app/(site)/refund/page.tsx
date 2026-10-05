import { LegalPage } from "../legal";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({ title: "Refund Policy · FITRON", description: "When FITRON refunds subscription payments, and how to ask for one.", path: "/refund" });

export default function RefundPage() {
  return (
    <LegalPage
      title="Refund Policy"
      updated="1 October 2026"
      intro={<p>Every FITRON plan starts with a 7-day free trial, so you can try everything before you pay. This policy covers payments made to FITRON for AI Trainer, Gym Accounting and partner plans.</p>}
    >
      <section>
        <h2 id="trial">Free trial</h2>
        <p>The trial is free and needs no card. If you don&apos;t pay when it ends, nothing is charged.</p>
      </section>
      <section>
        <h2 id="cancel">Cancelling</h2>
        <p>Nothing auto-debits, so there is nothing to cancel: simply don&apos;t renew. Your plan stays active until the end of the period you paid for.</p>
      </section>
      <section>
        <h2 id="when">When we refund</h2>
        <ul>
          <li><b>Charged twice or charged by mistake:</b> full refund of the extra amount.</li>
          <li><b>Paid but we couldn&apos;t activate your plan</b> within 2 working days: full refund.</li>
          <li><b>First paid month or year, cancelled within 7 days of payment:</b> full refund if you tell us within those 7 days.</li>
        </ul>
        <p>Otherwise, payments for a period that has started are not refundable, including unused days of a monthly or yearly plan. One-time setup, branding and migration fees are refundable only if the work hasn&apos;t started.</p>
      </section>
      <section>
        <h2 id="how">How to ask</h2>
        <p>Write to <a href="mailto:hello@fitron.in?subject=Refund%20request">hello@fitron.in</a> or use the <a href="/contact?topic=support">contact form</a> with your registered email and the payment reference (UTR or Razorpay ID). We reply within 2 working days.</p>
        <p>Approved refunds go back to the original payment method within 5 to 7 working days. GST is refunded with the amount it was charged on.</p>
      </section>
      <section>
        <h2 id="gym-members">Gym members</h2>
        <p>If you paid a gym for a membership, that payment went to the gym, not to FITRON. Ask the gym about refunds.</p>
      </section>
    </LegalPage>
  );
}
