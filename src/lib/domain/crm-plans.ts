// What the team sells: the plans on fitron.in (src/lib/domain/pricing.ts is the one price list), the one-time add-ons, and how a
// deal's value follows from them. Money is paise, GST included, as on the website.

import { PLANS, type Cycle } from "./pricing";
import { FIRST_RATE, INCENTIVE_MAX } from "./crm-pay";
import type { Product } from "./crm";

export type SellablePlan = { key: string; product: Product; name: string; price: Record<Cycle, number> };

export const SELLABLE: SellablePlan[] = PLANS.filter((p) => p.product === "GYM_ACCOUNTING" || p.product === "PARTNER").map((p) => ({
  key: p.key,
  product: p.product === "PARTNER" ? "Partnership" : "SaaS",
  name: p.product === "GYM_ACCOUNTING" ? `Accounting ${p.name}` : p.name,
  price: p.price,
}));

export const planOf = (key: string) => SELLABLE.find((p) => p.key === key) ?? SELLABLE[0]!;
export const isPlanKey = (k: unknown): k is string => typeof k === "string" && SELLABLE.some((p) => p.key === k);
export const isBilling = (b: unknown): b is Cycle => b === "MONTHLY" || b === "YEARLY";
export const planPrice = (key: string, billing: Cycle) => planOf(key).price[billing];
export const planText = (key: string, billing: string) => `${planOf(key).name} · ${billing === "YEARLY" ? "Yearly" : "Monthly"}`;

export const ADD_ON_KEYS = ["setup", "brand"] as const;
export type AddOn = (typeof ADD_ON_KEYS)[number];
export const ADD_ON_PRICE: Record<AddOn, number> = { setup: 99_900, brand: 4_99_900 };
export const ADD_ON_LABEL: Record<AddOn, string> = { setup: "Gym onboarding and setup", brand: "Custom gym branding" };

/** What a deal is worth: the plan for its billing cycle plus any add-ons, in paise. This is what is verified and what commission is paid on. */
export function dealValue(d: { plan: string; billing: string; addons?: readonly string[] }) {
  const billing: Cycle = d.billing === "YEARLY" ? "YEARLY" : "MONTHLY";
  return planPrice(d.plan, billing) + (d.addons ?? []).reduce((a, k) => a + (ADD_ON_PRICE[k as AddOn] ?? 0), 0);
}
export const cleanAddons = (a: readonly string[] | undefined): AddOn[] => ADD_ON_KEYS.filter((k) => a?.includes(k));

// ── The price list page ────────────────────────────────────────────────────

export type PlanCard = { key: string; name: string; desc: string; features: string[]; recommended?: boolean };
export const PRICE_SECTIONS: { title: string; note: string; plans: PlanCard[] }[] = [
  {
    title: "Gym Accounting",
    note: "Memberships, payments, revenue, expenses and staff in one console. 7-day free trial.",
    plans: [
      { key: "starter", name: "Starter", desc: "For small gyms and fitness studios.", features: ["Up to 100 active members", "Members, plans, renewals, GST invoices", "Payments, expenses, basic reports", "Member data import and export"] },
      { key: "professional", name: "Professional", desc: "For growing gyms.", recommended: true, features: ["Up to 300 active members", "Everything in Starter", "Profit & loss, WhatsApp reminders*, staff & payroll", "Excel/CSV exports, AI Trainer for members"] },
      { key: "enterprise", name: "Enterprise", desc: "For large gyms, chains and multi-location businesses.", features: ["Unlimited members, multi-branch", "Consolidated and branch-wise reporting", "Custom staff roles and permissions", "Priority technical support"] },
    ],
  },
  {
    title: "Gym Partnership",
    note: "Partner gyms offer the FITRON AI Trainer to members and keep 70% of every eligible subscription. Partner plans are billed monthly.",
    plans: [
      { key: "partner-referral", name: "Referral Partner", desc: "For independent gyms and fitness professionals.", features: ["Official partner account and referral link", "Member subscription tracking", "70% AI Trainer revenue share to the gym", "Monthly commission statements"] },
      { key: "partner-software", name: "Software Partner", desc: "Full gym software plus AI Trainer revenue share.", recommended: true, features: ["Includes Gym Accounting Professional", "AI Trainer access for members", "70% AI Trainer revenue share to the gym", "Partner performance dashboard"] },
      { key: "partner-enterprise", name: "Enterprise Partner", desc: "For gym chains and multi-branch businesses.", features: ["Includes Gym Accounting Enterprise", "Multi-branch, centralised reporting", "70% AI Trainer revenue share to the gym", "Priority partner support"] },
    ],
  },
];

/** The AI Trainer is sold to members on fitron.in, not through the CRM, so no sales commission applies; it is shown so a salesperson can explain what a partner gym earns. */
export const AI_REFERENCE = [
  { name: "AI Pro", desc: "Structured workouts and personalised fitness guidance.", features: ["Personalised workout and diet plans", "Calorie, protein and progress tracking", "AI Coach: 25 messages a day", "Partner gym earns ≈ ₹177 / month"] },
  { name: "AI Premium", desc: "Everything in AI Pro, with a higher daily AI Coach limit.", features: ["Everything in AI Pro", "AI Coach: 100 messages a day", "Partner gym earns ≈ ₹296 / month"] },
];

export const ADDONS_LIST: { name: string; kind: string; price: number | null; from?: boolean; per?: string }[] = [
  { name: "Gym onboarding and setup", kind: "One-time", price: 99_900 },
  { name: "Custom gym branding", kind: "One-time", price: 4_99_900 },
  { name: "Member data migration", kind: "Custom · quoted", price: 99_900, from: true },
  { name: "Custom integrations", kind: "Custom · quoted", price: 99_900, from: true },
  { name: "Branded mobile app", kind: "Custom · quoted", price: 9_99_900, from: true },
  { name: "Additional gym branch", kind: "Recurring", price: 49_900, per: "/ month" },
  { name: "Extra WhatsApp messaging", kind: "Recurring", price: null },
];

/** What a salesperson earns on a sale at the first-month rate and at the top incentive rate. */
export const commissionAt = (paise: number) => ({ first: Math.round(paise * FIRST_RATE), incentive: Math.round((paise * INCENTIVE_MAX) / 100) });
