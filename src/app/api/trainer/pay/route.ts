import { startTrainerPayment } from "@/lib/services/trainer";
import { body, json, withTrainer } from "../_lib/http";

/** Start a payment to FITRON: returns what Razorpay Checkout needs (mode SUBSCRIPTION). Without Razorpay set up it answers that payments are not switched on. */
export async function POST(req: Request) {
  return withTrainer(async (m) => {
    const b = await body<{ plan?: string; cycle?: string; kind?: string }>(req);
    return json(await startTrainerPayment(m.id, { plan: String(b.plan ?? ""), cycle: String(b.cycle ?? ""), kind: String(b.kind ?? "") }));
  });
}
