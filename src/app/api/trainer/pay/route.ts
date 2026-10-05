import { startTrainerPayment } from "@/lib/services/trainer";
import { body, json, withTrainer } from "../_lib/http";

/** Start a payment to FITRON. With Razorpay set up it returns what Checkout needs (mode SUBSCRIPTION); otherwise the amount and the UPI link the app shows as a QR. */
export async function POST(req: Request) {
  return withTrainer(async (m) => {
    const b = await body<{ plan?: string; cycle?: string; kind?: string }>(req);
    return json(await startTrainerPayment(m.id, { plan: String(b.plan ?? ""), cycle: String(b.cycle ?? ""), kind: String(b.kind ?? "") }));
  });
}
