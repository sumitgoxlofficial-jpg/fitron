// Coupons the FITRON team makes for payments to FITRON (gym plans, extra branches, add-ons and AI Trainer plans).
// Prices are paise with the GST inside them; a coupon takes a share off that price and the rest is what is charged.
import type { IsoDate } from "./dates";

export { normaliseCode } from "./offers";

/** What a coupon works on: everything, the gym products, or the AI Trainer. */
export type CouponAudience = "ALL" | "GYM" | "TRAINER";
/** What is being paid for. */
export type CouponProduct = "GYM" | "TRAINER";

export const COUPON_AUDIENCES: Record<CouponAudience, string> = {
  ALL: "Everything",
  GYM: "Gym plans, branches and add-ons",
  TRAINER: "AI Trainer plans",
};

/** The audience in a sentence: "Coupon X only works on …". */
export const COUPON_AUDIENCE_PHRASE: Record<CouponAudience, string> = {
  ALL: "every payment",
  GYM: "gym plans, extra branches and add-ons",
  TRAINER: "AI Trainer plans",
};

/** Razorpay will not take less than ₹1, so a payment that is not free is never smaller than this. */
export const MIN_CHARGE = 100;

/** How long a payment that was started but not finished holds one of a coupon's uses. */
export const HOLD_MINUTES = 120;

export const couponCovers = (appliesTo: string, product: CouponProduct) => appliesTo === "ALL" || appliesTo === product;

export type CouponLike = { appliesTo: string; validTill: IsoDate | null; usageLimit: number | null; status: string };

/** "Active", "Paused", "Expired" (past its last day) or "Used up", as the admin page labels coupons. `taken` is how many uses are spoken for. */
export const couponState = (c: CouponLike, taken: number, today: IsoDate) =>
  c.validTill && c.validTill < today ? "Expired" : c.status === "PAUSED" ? "Paused" : c.usageLimit !== null && taken >= c.usageLimit ? "Used up" : "Active";

/** What a coupon does to a price: the amount taken off and what is left to pay (never 0 unless the coupon is 100%, never below MIN_CHARGE otherwise). */
export function applyCoupon(total: number, percentOff: number) {
  const pct = Math.min(100, Math.max(0, Math.round(percentOff)));
  let pay = total - Math.round((total * pct) / 100);
  if (pct < 100 && pay < MIN_CHARGE) pay = Math.min(total, MIN_CHARGE);
  return { discount: total - pay, total: pay };
}
