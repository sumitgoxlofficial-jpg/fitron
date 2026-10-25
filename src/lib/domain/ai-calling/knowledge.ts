import { PLANS, TRIAL_DAYS, findPlan } from "../pricing";

// What the agent may say about FITRON. Built from the price list, which the pricing page is tested against, so the agent
// can't state a plan, limit or feature the site doesn't. Anything not covered here the agent must say it will have the team confirm.

export const TOPICS = ["overview", "features", "plans", "trial", "demo", "pain_points", "roi"] as const;
export type Topic = (typeof TOPICS)[number];

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN")}`;
const gymPlans = PLANS.filter((p) => p.product === "GYM_ACCOUNTING");

export function productInfo(topic: Topic): string[] {
  switch (topic) {
    case "overview":
      return [
        "FITRON is gym accounting and management software built for Indian gym owners.",
        "It manages members, membership plans, payments and outstanding fees, expenses and revenue — all in one place.",
        "It replaces notebooks, spreadsheets, and manual WhatsApp tracking with a single digital system.",
        "Website: fitron.in.",
      ];
    case "features": {
      const starter = findPlan("starter");
      const pro = findPlan("professional");
      const enterprise = findPlan("enterprise");
      return [
        `Starter plan features: ${(starter?.card?.features ?? []).join("; ")}.`,
        `Professional plan adds: ${(pro?.card?.features ?? []).join("; ")}.`,
        `Enterprise plan adds: ${(enterprise?.card?.features ?? []).join("; ")}.`,
        "The most popular feature with gym owners is automated WhatsApp payment reminders — members get a reminder when their membership is about to expire or when a payment is due, without the owner doing anything manually.",
      ];
    }
    case "plans":
      return [
        ...gymPlans.map((p) => `${p.name}: ${rupees(p.price.MONTHLY)} a month or ${rupees(p.price.YEARLY)} a year (GST included). ${p.card?.limit ?? ""}.`),
        `All plans include a ${TRIAL_DAYS}-day free trial — no credit card needed.`,
        "Starter is for small gyms up to 100 active members. Professional is for growing gyms up to 300 active members — the most commonly chosen plan. Enterprise supports unlimited members and multiple branches.",
        "The yearly plan saves roughly 2 months of cost compared to paying monthly.",
      ];
    case "trial":
      return [
        `Every plan starts with a ${TRIAL_DAYS}-day free trial.`,
        "No credit card or advance payment is needed for the trial.",
        "The gym owner signs up at fitron.in and has full access for 7 days at no cost.",
      ];
    case "demo":
      return [
        "A demo is a 15–20 minute walkthrough of FITRON by the FITRON team, on a phone or video call, at a time the owner chooses.",
        "The owner sees the software live — how to add members, track payments, send reminders, and read reports.",
        "Demos are free and there is no obligation to buy.",
      ];
    case "pain_points":
      return [
        "Gym owners typically face: (1) members whose memberships expire without anyone noticing; (2) outstanding fees that pile up because there is no follow-up system; (3) no clear picture of monthly income and expenses; (4) manually sending WhatsApp reminders to members about dues — time-consuming and easy to miss; (5) difficulty tracking which staff collected which payment; (6) losing member history when a register is damaged or misplaced.",
        "FITRON is designed to solve each of these: renewal alerts, automated WhatsApp reminders, revenue and expense reports, payment tracking by staff, and cloud-based records that cannot be lost.",
      ];
    case "roi":
      return [
        `The Professional plan costs ${rupees(findPlan("professional")?.price.MONTHLY ?? 0)} a month (GST included).`,
        "If automated WhatsApp reminders recover even 2–3 lapsed memberships a month, or remind members to renew on time, the software pays for itself.",
        "Gym owners who track finances on FITRON typically find outstanding dues they were not chasing, giving them a clearer picture of cash flow.",
        `The ${TRIAL_DAYS}-day free trial lets the owner verify this for themselves before committing.`,
      ];
  }
}

export const NOT_COVERED = "I don't have that detail, so I'll have the FITRON team confirm it.";
