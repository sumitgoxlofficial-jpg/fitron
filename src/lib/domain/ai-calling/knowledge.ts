import { PLANS, TRIAL_DAYS, findPlan } from "../pricing";

// What the agent may say about FITRON. Built from the price list, which the pricing page is tested against, so the agent
// can't state a plan, limit or feature the site doesn't. Anything not covered here the agent must say it will have the team confirm.

export const TOPICS = ["overview", "features", "plans", "trial", "demo"] as const;
export type Topic = (typeof TOPICS)[number];

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN")}`;
const gymPlans = PLANS.filter((p) => p.product === "GYM_ACCOUNTING");

export function productInfo(topic: Topic): string[] {
  switch (topic) {
    case "overview":
      return ["FITRON is gym accounting software: it manages members, membership plans, payments and outstanding fees, expenses and revenue, with reports.", "It replaces notebooks and spreadsheets with one place for the gym's records."];
    case "features": {
      const pro = findPlan("professional");
      return [...new Set([...(findPlan("starter")?.card?.features ?? []), ...(pro?.card?.features ?? [])])].map((f) => f.replace(/\*$/, ""));
    }
    case "plans":
      return gymPlans.map((p) => `${p.name}: ${rupees(p.price.MONTHLY)} a month or ${rupees(p.price.YEARLY)} a year (GST included). ${p.card?.limit ?? ""}.`);
    case "trial":
      return [`New gyms get a ${TRIAL_DAYS}-day free trial.`];
    case "demo":
      return ["A demo is a short walk-through of FITRON by the FITRON team, on a call or screen share, at a time the owner chooses."];
  }
}

export const NOT_COVERED = "I don't have that detail, so I'll have the FITRON team confirm it.";
