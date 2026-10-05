import { memberWithRenewal } from "@/lib/services/trainer";
import { confirmTrainerSubscription } from "@/lib/services/trainer-billing";
import { db } from "@/lib/db";
import { body, json, withTrainer } from "../../../_lib/http";

/**
 * Razorpay Checkout finished for a plan that renews itself: the app sends what Checkout returned. Answers PAID once the
 * plan is on, or PROCESSING when Razorpay hasn't captured the payment yet (the plan then turns on by itself).
 */
export async function POST(req: Request, ctx: RouteContext<"/api/trainer/pay/[id]/confirm">) {
  const { id } = await ctx.params;
  return withTrainer(async (m) => {
    const b = await body<{ razorpay_payment_id?: unknown; razorpay_subscription_id?: unknown; razorpay_signature?: unknown }>(req);
    const { status } = await confirmTrainerSubscription(m.id, id, { paymentId: String(b.razorpay_payment_id ?? ""), subscriptionId: String(b.razorpay_subscription_id ?? ""), signature: String(b.razorpay_signature ?? "") });
    return json({ status, member: await memberWithRenewal(await db.trainerMember.findUniqueOrThrow({ where: { id: m.id } })) });
  });
}
