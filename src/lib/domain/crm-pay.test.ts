import { describe, expect, it } from "vitest";
import { checkProfile, commissionRate, earningTotals, earnings, isWorkEmail, needsSetup, nextPayoutDate, passwordError, passwordRules, payToText, payoutDue, signInKey, type ProfileInput } from "./crm-pay";

const good: ProfileInput = { fullName: "Rahul Sharma", phone: "+91 98765 43210", address: "12 MG Road", city: "Pune", state: "Maharashtra", pin: "411001", payMethod: "bank", accName: "Rahul Sharma", bankName: "HDFC Bank", accNo: "50100234567812", accNo2: "50100234567812", ifsc: "hdfc0000523", upi: "", upiName: "", agree: true };

describe("passwords", () => {
  it("needs length, both cases and a number, and nothing guessable", () => {
    expect(passwordError("Str0ngPass", "rahul@fitron.in")).toBeNull();
    expect(passwordError("short1A", "")).toMatch(/at least 8/);
    expect(passwordError("alllowercase1", "")).toMatch(/at least 8/);
    expect(passwordError("Rahul1234Pass", "rahul@fitron.in")).toMatch(/doesn’t contain/);
    expect(passwordError("Fitron12345", "x@fitron.in")).toMatch(/doesn’t contain/);
    expect(passwordRules("", "").every((r) => !r.ok || r.key === "name")).toBe(true);
  });
  it("accepts only work addresses", () => {
    expect(isWorkEmail("a.b@fitron.in")).toBe(true);
    for (const bad of ["a@gmail.com", "a@fitron.in.evil.com", "a@evilfitron.in", "a b@fitron.in", ""]) expect(isWorkEmail(bad), bad).toBe(false);
  });
  it("reads an employee ID however it is typed", () => {
    expect(signInKey("FIT-EMP-0004")).toEqual({ empId: "FIT-EMP-0004" });
    expect(signInKey("fitemp4")).toEqual({ empId: "FIT-EMP-0004" });
    expect(signInKey("4")).toEqual({ empId: "FIT-EMP-0004" });
    expect(signInKey(" Rahul@Fitron.in ")).toEqual({ email: "rahul@fitron.in" });
  });
});

describe("profile and payout", () => {
  it("accepts a complete profile and cleans it", () => {
    const r = checkProfile(good, true);
    expect(r).toMatchObject({ ok: true, profile: { phone: "9876543210" }, payout: { method: "bank", ifsc: "HDFC0000523" } });
  });
  it.each([
    [{ fullName: "Al" }, /full name/],
    [{ phone: "12345" }, /10-digit/],
    [{ address: "x" }, /address/],
    [{ pin: "0123" }, /PIN/],
    [{ accNo2: "1" }, /do not match/],
    [{ accNo: "123", accNo2: "123" }, /9 to 18/],
    [{ ifsc: "BAD" }, /IFSC/],
    [{ agree: false }, /terms/],
    [{ payMethod: "upi" as const, upi: "nope" }, /UPI ID/],
  ])("refuses %j", (over, msg) => {
    const r = checkProfile({ ...good, ...over }, true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(msg);
  });
  it("takes UPI instead of a bank account, and does not ask again for terms already accepted", () => {
    expect(checkProfile({ ...good, payMethod: "upi", upi: "rahul@okhdfc", upiName: "Rahul Sharma", agree: false }, false)).toMatchObject({ ok: true, payout: { method: "upi", accNo: "" } });
  });
  it("masks the account", () => {
    expect(payToText({ method: "bank", accName: "", bankName: "HDFC Bank", accNo: "50100234567812", ifsc: "X", upi: "", upiName: "" })).toBe("HDFC Bank ••••7812");
    expect(payToText({ method: "upi", accName: "", bankName: "", accNo: "", ifsc: "", upi: "vikram.mehta@okicici", upiName: "" })).toBe("UPI · vi•••@okicici");
    expect(payToText(null)).toBe("No payout account");
  });
  it("keeps a new employee on the profile page until everything is given", () => {
    const p = { fullName: "R", address: "12 MG Road" };
    expect(needsSetup({ termsVersion: null, termsAcceptedAt: null }, null, false)).toBe(true);
    expect(needsSetup({ termsVersion: "v1.1", termsAcceptedAt: new Date() }, p, true)).toBe(false);
    expect(needsSetup({ termsVersion: "v1.1", termsAcceptedAt: new Date() }, p, false)).toBe(true); // no payout account yet
    expect(needsSetup({ termsVersion: "v1.0", termsAcceptedAt: new Date() }, p, true)).toBe(true); // new terms: accept again
  });
});

describe("commission", () => {
  const joined = "2026-10-05";
  it("pays 20% for 30 days after joining, then the incentive", () => {
    expect(commissionRate(joined, 5, new Date("2026-11-03T10:00:00+05:30"))).toBe(0.2);
    expect(commissionRate(joined, 5, new Date("2026-11-04T10:00:00+05:30"))).toBe(0.05);
    expect(commissionRate(joined, 3, new Date("2026-12-01T10:00:00+05:30"))).toBe(0.03);
    expect(commissionRate(joined, 99, new Date("2026-12-01T10:00:00+05:30"))).toBe(0.05); // capped
    expect(commissionRate(joined, -2, new Date("2026-12-01T10:00:00+05:30"))).toBe(0);
  });
  it("earns on each deal at the rate in force the day it was verified", () => {
    const list = earnings([{ value: 1000000, verifiedAt: new Date("2026-10-20T10:00:00+05:30") }, { value: 1000000, verifiedAt: new Date("2026-11-20T10:00:00+05:30") }], joined, 5);
    expect(list.map((e) => e.amount)).toEqual([200000, 50000]);
  });
  it("totals today, this month and all time, and keeps pending apart", () => {
    const now = new Date("2026-10-24T12:00:00+05:30");
    const list = earnings([{ value: 1000000, verifiedAt: new Date("2026-10-24T09:00:00+05:30") }, { value: 500000, verifiedAt: new Date("2026-10-03T09:00:00+05:30") }, { value: 700000, verifiedAt: new Date("2026-09-30T09:00:00+05:30") }], "2026-01-01", 5);
    const t = earningTotals(list, 200000, "2026-01-01", 5, now);
    expect(t).toMatchObject({ today: 50000, todayN: 1, month: 75000, total: 110000, n: 3, pending: 10000 });
  });
  it("pays on the 2nd of the next month", () => {
    expect(nextPayoutDate(new Date("2026-10-24T12:00:00+05:30"))).toBe("2026-11-02");
    expect(nextPayoutDate(new Date("2026-10-01T12:00:00+05:30"))).toBe("2026-10-02");
    expect(nextPayoutDate(new Date("2026-12-15T12:00:00+05:30"))).toBe("2027-01-02");
  });
  it("adds salary only after the first month", () => {
    expect(payoutDue({ salary: 1800000, joinedAt: "2026-10-05", monthCommission: 100000, at: new Date("2026-10-24T12:00:00+05:30") })).toBe(100000);
    expect(payoutDue({ salary: 1800000, joinedAt: "2026-10-05", monthCommission: 100000, at: new Date("2026-12-01T12:00:00+05:30") })).toBe(1900000);
    expect(payoutDue({ salary: null, joinedAt: "2026-01-05", monthCommission: 0 })).toBe(0);
  });
});
