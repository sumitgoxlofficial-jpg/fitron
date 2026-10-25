import { findPlan } from "../pricing";
import type { AcSettings } from "./settings";

// What the agent may say about price. The numbers come from the price list (pricing.ts) and the saved offer; the agent is
// never given a figure to remember, only to read back.

export type Offer = {
  active: boolean;
  /** Why not, when it isn't */
  reason?: string;
  planName: string;
  listMonthlyPaise: number;
  discountedMonthlyPaise: number;
  freeMonths: number;
  percentOff: number;
  slotsLeft: number;
  terms: string;
  lines: string[];
};

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
/** "about ₹1,000" for ₹999.50: rounded to the nearest ₹10 for speech, with the exact figure kept alongside */
const spoken = (paise: number) => `about ${rupees(Math.round(paise / 1000) * 10 * 100)}`;

export function currentOffer(s: AcSettings["offer"]): Offer {
  const plan = findPlan(s.plan);
  if (!plan) return { active: false, reason: "The offer's plan isn't in the price list.", planName: s.plan, listMonthlyPaise: 0, discountedMonthlyPaise: 0, freeMonths: 0, percentOff: 0, slotsLeft: 0, terms: s.terms, lines: ["There is no introductory offer to quote right now."] };
  const list = plan.price.MONTHLY;
  const discounted = Math.round((list * (100 - s.percentOff)) / 100);
  const slotsLeft = Math.max(0, s.slotsTotal - s.slotsClaimed);
  const base = { planName: plan.name, listMonthlyPaise: list, discountedMonthlyPaise: discounted, freeMonths: s.freeMonths, percentOff: s.percentOff, slotsLeft, terms: s.terms };
  if (!s.active) return { ...base, active: false, reason: "No introductory offer is running.", lines: [`The ${plan.name} plan is ${rupees(list)} a month (GST included). There is no introductory offer to quote right now.`] };
  if (slotsLeft <= 0) return { ...base, active: false, reason: "The first-customers offer is fully claimed.", lines: [`The ${plan.name} plan is ${rupees(list)} a month (GST included). The introductory offer has been fully claimed.`] };
  const lines = [
    `The ${plan.name} plan is ${rupees(list)} a month (GST included).`,
    ...(s.freeMonths > 0 ? [`Introductory offer: ${s.freeMonths} month${s.freeMonths === 1 ? "" : "s"} free.`] : []),
    ...(s.percentOff > 0 ? [`Then ${s.percentOff}% off the ${plan.name} plan: ${rupees(discounted)} a month, which is ${spoken(discounted)}.`] : []),
    `Limited to the first ${s.slotsTotal} customers; ${slotsLeft} places left.`,
    ...(s.terms ? [`Terms: ${s.terms}`] : []),
  ];
  return { ...base, active: true, lines };
}
