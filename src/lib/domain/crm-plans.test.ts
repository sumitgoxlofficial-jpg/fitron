import { describe, expect, it } from "vitest";
import { ADDONS_LIST, SELLABLE, commissionAt, dealValue, isBilling, isPlanKey, planOf, planText } from "./crm-plans";

describe("what the team sells", () => {
  it("sells the Gym Accounting and Partner plans of the website's price list", () => {
    expect(SELLABLE.map((p) => p.key)).toEqual(["starter", "professional", "enterprise", "partner-referral", "partner-software", "partner-enterprise"]);
    expect(planOf("starter")).toMatchObject({ product: "SaaS", name: "Accounting Starter", price: { MONTHLY: 99_900, YEARLY: 9_99_000 } });
    expect(planOf("partner-software").product).toBe("Partnership");
    expect(isPlanKey("ai-pro")).toBe(false); // sold to members on the website, not by the team
    expect(isBilling("YEARLY")).toBe(true);
    expect(isBilling("weekly")).toBe(false);
  });
  it("values a deal as the plan for its cycle plus the add-ons, and nothing else", () => {
    expect(dealValue({ plan: "professional", billing: "YEARLY" })).toBe(19_99_000);
    expect(dealValue({ plan: "starter", billing: "MONTHLY", addons: ["setup"] })).toBe(99_900 + 99_900);
    expect(dealValue({ plan: "starter", billing: "MONTHLY", addons: ["setup", "brand", "made-up"] })).toBe(99_900 + 99_900 + 4_99_900);
  });
  it("describes the plan and the commission on it", () => {
    expect(planText("professional", "YEARLY")).toBe("Accounting Professional · Yearly");
    expect(commissionAt(1_99_900)).toEqual({ first: 39_980, incentive: 9_995 });
    expect(ADDONS_LIST.find((a) => a.name === "Extra WhatsApp messaging")?.price).toBeNull();
  });
});
