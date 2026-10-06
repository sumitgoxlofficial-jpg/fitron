import type { Block, Faq } from "./gym-pages";
import { findPlan, rupeesLabel, TRIAL_DAYS } from "./pricing";
import { COACH_DAILY_LIMIT } from "./trainer";

// The words of the public page about the FITRON AI Trainer (/ai-personal-trainer). Like gym-pages.ts, every sentence is
// a statement about what the member app (public/trainer) really does, in the words the home page already uses for it.
// Do not add a claim the app cannot back: no medical advice, no promised results, no ratings, no named competitors.

const pro = findPlan("ai-pro")!;
const premium = findPlan("ai-premium")!;
const trial = `${TRIAL_DAYS}-day free trial`;

export const TRAINER_PAGE = {
  path: "/ai-personal-trainer",
  label: "AI personal trainer",
  title: "AI Personal Trainer App in India: Workouts & Diet | FITRON",
  description: `An AI personal trainer for India: 4-week workout plans for home or gym, Indian meal plans and a 24/7 AI coach. ${trial}, from ${rupeesLabel(pro.price.MONTHLY)} a month.`,
  kicker: "FITRON AI Trainer",
  h1: "An AI personal trainer that plans your workouts and your Indian meals",
  intro:
    "FITRON AI Trainer builds a workout plan around your body, your goal and the equipment you have, plans meals from foods sold near you, and gives you an AI coach to talk to any time of day. At home with a pair of dumbbells or in a full gym.",
  blocks: [
    {
      id: "workouts",
      heading: "Workout plans built for you",
      body: "Tell FITRON your goal, your level and what equipment you have, and it builds a personalised 4-week plan with a workout for each training day. Log your sets as you go: the app keeps your heaviest set for every exercise, so you can see your strength go up.",
      points: ["Plans for home or the gym, from bodyweight to a full rack", "A daily workout schedule", "Every set logged, with your first and best lift for each exercise"],
    },
    {
      id: "diet",
      heading: "Indian meal plans",
      body: "Meals are planned by your city, your diet and your budget, from foods you can buy near you: dal and rice, poha, paneer, eggs, chicken and the rest. Pick vegetarian, eggetarian or non-vegetarian, and track your calories and protein through the day.",
      points: ["Veg, egg or non-veg", "Calorie and protein tracking", "Built around your budget"],
    },
    {
      id: "coach",
      heading: "An AI coach, any time",
      body: `Ask the AI Coach about your plan, a missed workout, a meal swap or a sore muscle. It knows your plan and your history, so you do not start from zero each time. AI Pro includes ${COACH_DAILY_LIMIT["ai-pro"]} messages a day and AI Premium ${COACH_DAILY_LIMIT["ai-premium"]}.`,
    },
    {
      id: "progress",
      heading: "Habits, progress and a weekly review",
      body: "Tick off water, steps, protein, meals, sleep and your workout each day, keep a streak going, log your weight and read a weekly review of how the week went.",
    },
    {
      id: "gyms",
      heading: "For gyms: give it to your members",
      body: "Gyms on FITRON Gym Accounting can offer the AI Trainer to their members, and gym partners earn 70% of every eligible member subscription.",
      link: ["Gym management software", "/gym-management-software"],
    },
    {
      id: "privacy",
      heading: "Your data",
      body: "FITRON follows India's DPDP Act, 2023: data is hosted in India, you can export or delete it any time, and your conversations with the AI Coach are never shown to your gym. The AI replies are written by an AI provider that may process them outside India; the privacy policy says what is sent.",
      link: ["Read the privacy policy", "/privacy"],
    },
  ] satisfies readonly Block[],
  faq: [
    {
      q: "What is an AI personal trainer?",
      a: "An AI personal trainer is an app that plans your workouts and meals around your goal and answers your training questions, the way a coach would, at any time of day. FITRON AI Trainer does this for people in India, with Indian meals and prices in rupees.",
    },
    {
      q: "Do I need a gym to use the AI trainer?",
      a: "No. Tell FITRON what equipment you have, whether that's a full gym or a pair of dumbbells at home, and your plan is built around it.",
    },
    {
      q: "How much does the FITRON AI Trainer cost?",
      a: `AI Pro is ${rupeesLabel(pro.price.MONTHLY)} a month or ${rupeesLabel(pro.price.YEARLY)} a year, and AI Premium is ${rupeesLabel(premium.price.MONTHLY)} a month or ${rupeesLabel(premium.price.YEARLY)} a year. Prices include GST. Both start with a ${trial}, no card needed.`,
    },
    {
      q: "What is the difference between AI Pro and AI Premium?",
      a: `Only the AI Coach limit: ${COACH_DAILY_LIMIT["ai-pro"]} messages a day on AI Pro and ${COACH_DAILY_LIMIT["ai-premium"]} on AI Premium. Workouts, meal plans, habits, progress and the weekly review are the same on both.`,
    },
    {
      q: "Does it make vegetarian diet plans?",
      a: "Yes. Choose vegetarian, eggetarian or non-vegetarian, and meals are planned from foods sold in your city, within your budget.",
    },
    {
      q: "How do I cancel?",
      a: "Plans renew automatically for the period you chose, monthly or yearly. Cancel any time from Settings › Subscription in the AI Trainer; the plan stays active until the end of the period you have already paid for.",
    },
  ] satisfies readonly Faq[],
} as const;

export const TRAINER_PLAN_LIST = [pro, premium];
