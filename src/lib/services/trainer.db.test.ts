import { randomInt, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hasDb } from "@/test/db";
import { db } from "@/lib/db";
import { appUrl } from "./accounts";
import { addDays } from "@/lib/domain/dates";
import { COACH_DAILY_LIMIT } from "@/lib/domain/trainer";
import {
  deleteTrainerAccount,
  deleteTrainerChat,
  exportTrainer,
  findOrCreateTrainer,
  loadTrainer,
  redeemTrainerLink,
  refundCoachMessage,
  requestTrainerLink,
  saveTrainerChat,
  saveTrainerState,
  startTrainerPayment,
  startTrainerTrial,
  submitTrainerUtr,
  takeCoachMessage,
} from "./trainer";
import { reviewTrainerPayment, trainerPaymentsToCheck } from "./trainer-admin";
import { coachSystem, profileLines } from "./trainer-coach";
import { currentPlan } from "./trainer-session";
import { fromIso, toIso, todayIso } from "./time";

const email = () => `t-${randomUUID().slice(0, 8)}@test.local`;
const utr = () => String(randomInt(100_000, 999_999)) + String(randomInt(100_000, 999_999));
const member = (id: string) => db.trainerMember.findUniqueOrThrow({ where: { id } });

describe.skipIf(!hasDb)("AI Trainer (database)", () => {
  it("an email link creates the account once and works only once", async () => {
    const e = email();
    const r = await requestTrainerLink(e.toUpperCase());
    // No SMTP in tests: the link comes back to show on screen. It points at APP_URL, not the request's host.
    expect(r.devLink!.startsWith(`${appUrl()}/api/trainer/auth/verify?token=`)).toBe(true);
    const token = new URL(r.devLink!).searchParams.get("token")!;
    const m = await redeemTrainerLink(token);
    expect(m?.email).toBe(e);
    expect(m?.emailVerifiedAt).toBeTruthy();
    expect(await redeemTrainerLink(token)).toBeNull();
    expect(await redeemTrainerLink("not-a-token")).toBeNull();
    // Google with the same email finds the same account.
    expect((await findOrCreateTrainer(e, "GOOGLE", "Asha")).id).toBe(m!.id);
    await expect(requestTrainerLink("nope")).rejects.toThrow(/valid email/);
  });

  it("saves the app state and today's log, and loads progress and the week's review", async () => {
    const m = await findOrCreateTrainer(email(), "EMAIL");
    const plan = { Mon: "Push", Tue: "Pull", Wed: "Legs", Thu: "Rest", Fri: "Push", Sat: "Pull", Sun: "Rest" };
    const today = "2026-09-30"; // a Wednesday
    await saveTrainerState(m.id, { profile: { ob: { name: "Asha", weight: "72" }, plan, junk: "dropped" }, day: { water: 1.5, habits: { workout: true, meals: true, extra: true }, workoutDone: true }, onboarded: true }, "2026-09-29");
    await saveTrainerState(m.id, { day: { water: 2.04, habits: { protein: true }, workoutDone: true } }, today);

    const d = await loadTrainer(m.id, today);
    expect(d.member.name).toBe("Asha");
    expect(d.member.onboarded).toBe(true);
    expect(d.member.access).toBe("LOCKED");
    expect(d.profile).toEqual({ ob: { name: "Asha", weight: "72" }, plan });
    expect(d.today).toMatchObject({ date: today, water: 2, focus: "Legs", workoutDone: true, habits: { workout: false, protein: true } });
    expect(d.progress.streak).toBe(2);
    expect(d.progress.weights).toEqual([{ date: "2026-09-29", kg: 72 }]);
    expect(d.progress.byFocus).toEqual([{ focus: "Pull", count: 1 }, { focus: "Legs", count: 1 }]);
    expect(d.review).toMatchObject({ weekStart: "2026-09-28", workouts: 2, planned: 5, consistency: 40, nutrition: 50, avgWater: 1.8 });
    expect(d.coach).toEqual({ used: 0, limit: COACH_DAILY_LIMIT["ai-pro"] });
    expect(await db.trainerReview.count({ where: { memberId: m.id } })).toBe(1);
  });

  it("keeps chats without photos, and deletes them", async () => {
    const m = await findOrCreateTrainer(email(), "EMAIL");
    await saveTrainerChat(m.id, "c1", "Knee pain", [{ role: "user", text: "Hi", media: { kind: "image", name: "knee.jpg", url: "data:image/png;base64,AAA" } }, { role: "coach", text: "Hello" }]);
    let d = await loadTrainer(m.id);
    expect(d.chats).toHaveLength(1);
    expect(d.chats[0]!.messages).toEqual([{ role: "user", text: "Hi", media: { kind: "image", name: "knee.jpg" } }, { role: "coach", text: "Hello" }]);
    await expect(saveTrainerChat(m.id, "../x", "t", [])).rejects.toThrow(/Bad chat id/);
    await deleteTrainerChat(m.id, "c1");
    d = await loadTrainer(m.id);
    expect(d.chats).toHaveLength(0);
  });

  it("the coach needs a trial or a plan, and stops at the plan's daily limit", async () => {
    const m = await findOrCreateTrainer(email(), "EMAIL");
    const today = todayIso();
    expect(await takeCoachMessage(m, today)).toMatchObject({ ok: false, reason: "LOCKED" });

    const t = await startTrainerTrial(m.id, "ai-pro");
    await expect(startTrainerTrial(m.id)).rejects.toThrow(/already been used/);
    expect(await takeCoachMessage(t, today)).toEqual({ ok: true, used: 1, limit: 25 });
    await refundCoachMessage(m.id, today);
    await db.trainerCoachUsage.update({ where: { memberId_date: { memberId: m.id, date: fromIso(today) } }, data: { count: 24 } });
    expect(await takeCoachMessage(t, today)).toEqual({ ok: true, used: 25, limit: 25 });
    expect(await takeCoachMessage(t, today)).toMatchObject({ ok: false, reason: "LIMIT" });
    expect(await takeCoachMessage(t, today)).toMatchObject({ ok: false, reason: "LIMIT" });

    // AI Premium has the higher limit, and messages turned away earlier don't use it up.
    const p = await db.trainerMember.update({ where: { id: m.id }, data: { plan: "ai-premium" } });
    expect(await takeCoachMessage(p, today)).toEqual({ ok: true, used: 26, limit: 100 });
  });

  it("a UPI payment waits for FITRON, and confirming it starts the plan after the trial", async () => {
    const m = await findOrCreateTrainer(email(), "EMAIL", "Ravi");
    await startTrainerTrial(m.id, "ai-pro");
    const pay = await startTrainerPayment(m.id, { plan: "ai-premium", cycle: "YEARLY", kind: "purchase" });
    // The listed ₹4,999 is what is paid; the GST is inside it.
    expect(pay).toMatchObject({ mode: "DEMO", base: 423_644, gst: 76_256, total: 4_99_900 });
    if (pay.mode !== "DEMO") throw new Error("expected a demo payment");
    expect(pay.link).toMatch(/^upi:\/\/pay\?/);
    expect(pay.link).toContain("am=4999.00");
    expect((await db.trainerPayment.findUniqueOrThrow({ where: { id: pay.id } })).gstIncluded).toBe(true);
    await expect(startTrainerPayment(m.id, { plan: "elite", cycle: "MONTHLY", kind: "purchase" })).rejects.toThrow(/Pick AI Pro/);

    await expect(submitTrainerUtr(m.id, pay.id, "12345")).rejects.toThrow(/12-digit UTR/);
    const u = utr();
    expect(await submitTrainerUtr(m.id, pay.id, ` ${u.slice(0, 6)} ${u.slice(6)} `)).toMatchObject({ status: "SUBMITTED", utr: u });
    await expect(submitTrainerUtr(m.id, pay.id, utr())).rejects.toThrow(/already has a UTR/);
    const again = await startTrainerPayment(m.id, { plan: "ai-pro", cycle: "MONTHLY", kind: "purchase" });
    await expect(submitTrainerUtr(m.id, again.id, u)).rejects.toThrow(/already entered/);

    const list = await trainerPaymentsToCheck();
    expect(list.waiting.find((r) => r.id === pay.id)).toMatchObject({ member: "Ravi", what: "AI Premium, yearly", total: 4_99_900, utr: u, mode: "DEMO" });

    const admin = { email: "team@fitron.in" };
    await expect(reviewTrainerPayment(admin, pay.id, "REJECT", " ")).rejects.toThrow(/Say why/);
    await reviewTrainerPayment(admin, pay.id, "REJECT", "Not in the statement");
    expect((await db.trainerPayment.findUniqueOrThrow({ where: { id: pay.id } })).status).toBe("REJECTED");

    const done = await reviewTrainerPayment(admin, pay.id, "CONFIRM");
    const after = await member(m.id);
    const trialEnd = todayIso(after.trialEndsAt!);
    expect(done?.status).toBe("PAID");
    expect(toIso(done!.periodStart!)).toBe(trialEnd);
    expect(after).toMatchObject({ plan: "ai-premium", cycle: "YEARLY", planCancelled: false });
    expect(toIso(after.paidUntil!)).toBe(toIso(done!.periodEnd!));
    expect(toIso(after.paidUntil!) > addDays(trialEnd, 360)).toBe(true);
    expect((await loadTrainer(m.id)).member.access).toBe("ACTIVE");
    await expect(reviewTrainerPayment(admin, pay.id, "CONFIRM")).rejects.toThrow(/isn't waiting/);
    await expect(reviewTrainerPayment(admin, pay.id, "REJECT", "late click")).rejects.toThrow(/isn't waiting/);
    expect((await trainerPaymentsToCheck()).recent.find((r) => r.id === pay.id)?.status).toBe("PAID");
  });

  it("moving down to AI Pro waits until the AI Premium time already paid for runs out", async () => {
    const m = await findOrCreateTrainer(email(), "EMAIL");
    const admin = { email: "team@fitron.in" };
    const premium = await startTrainerPayment(m.id, { plan: "ai-premium", cycle: "MONTHLY", kind: "purchase" });
    await submitTrainerUtr(m.id, premium.id, utr());
    await reviewTrainerPayment(admin, premium.id, "CONFIRM");
    const pro = await startTrainerPayment(m.id, { plan: "ai-pro", cycle: "MONTHLY", kind: "renew" });
    await submitTrainerUtr(m.id, pro.id, utr());
    const done = await reviewTrainerPayment(admin, pro.id, "CONFIRM");
    // Still Premium for the month already paid; Pro starts the day after.
    expect((await member(m.id)).plan).toBe("ai-premium");
    expect(await currentPlan(await member(m.id))).toMatchObject({ plan: "ai-premium" });
    // When the Pro month has started, the plan follows it.
    await db.trainerPayment.update({ where: { id: pro.id }, data: { periodStart: fromIso(todayIso()) } });
    expect(await currentPlan(await member(m.id))).toMatchObject({ plan: "ai-pro" });
    expect((await member(m.id)).plan).toBe("ai-pro");
    expect(done?.periodStart && toIso(done.periodStart) > todayIso()).toBe(true);
  });

  it("moving up to AI Premium starts at once", async () => {
    const m = await findOrCreateTrainer(email(), "EMAIL");
    const admin = { email: "team@fitron.in" };
    const pro = await startTrainerPayment(m.id, { plan: "ai-pro", cycle: "MONTHLY", kind: "purchase" });
    await submitTrainerUtr(m.id, pro.id, utr());
    await reviewTrainerPayment(admin, pro.id, "CONFIRM");
    const up = await startTrainerPayment(m.id, { plan: "ai-premium", cycle: "MONTHLY", kind: "upgrade" });
    await submitTrainerUtr(m.id, up.id, utr());
    await reviewTrainerPayment(admin, up.id, "CONFIRM");
    expect(await currentPlan(await member(m.id))).toMatchObject({ plan: "ai-premium" });
  });

  it("exports the member's data, and deleting the account keeps only the payments", async () => {
    const m = await findOrCreateTrainer(email(), "EMAIL");
    await saveTrainerState(m.id, { profile: { ob: { name: "Del", weight: "80" } }, day: { water: 1 } });
    await saveTrainerChat(m.id, "c1", "Hi", [{ role: "user", text: "Hi" }]);
    const pay = await startTrainerPayment(m.id, { plan: "ai-pro", cycle: "MONTHLY", kind: "purchase" });
    await db.trainerSession.create({ data: { id: `secret-${m.id}`, memberId: m.id, expiresAt: new Date(Date.now() + 86_400_000), ip: "203.0.113.5", userAgent: "Phone" } });
    await db.trainerCoachUsage.create({ data: { memberId: m.id, date: fromIso(todayIso()), count: 3 } });
    const x = await exportTrainer(m.id);
    expect(x.account.email).toBe(m.email);
    expect(x.account.signupVia).toBe("EMAIL");
    expect(x.days).toHaveLength(1);
    expect(x.chats).toHaveLength(1);
    expect(x.signedInDevices).toEqual([expect.objectContaining({ ip: "203.0.113.5", device: "Phone" })]);
    expect(x.coachMessagesPerDay).toEqual([{ date: todayIso(), messages: 3 }]);
    expect(JSON.stringify(x)).not.toContain(`secret-${m.id}`);

    await deleteTrainerAccount(m.id);
    const gone = await member(m.id);
    expect(gone.email).toBe(`deleted-${m.id}@deleted.fitron.in`);
    expect(gone.profile).toEqual({});
    expect(await db.trainerDay.count({ where: { memberId: m.id } })).toBe(0);
    expect(await db.trainerChat.count({ where: { memberId: m.id } })).toBe(0);
    expect(await db.trainerPayment.count({ where: { id: pay.id } })).toBe(1);
    // The email is free to sign up again as a new account.
    expect((await findOrCreateTrainer(m.email, "EMAIL")).id).not.toBe(m.id);
  });

  it("the free trial is once per email, even after deleting the account", async () => {
    const e = email();
    const first = await findOrCreateTrainer(e, "EMAIL");
    await startTrainerTrial(first.id, "ai-premium");
    await deleteTrainerAccount(first.id);
    const again = await findOrCreateTrainer(e, "GOOGLE");
    expect(again.id).not.toBe(first.id);
    await expect(startTrainerTrial(again.id, "ai-premium")).rejects.toThrow(/already had a free trial/);
    // A deleted account that never used a trial doesn't block anyone.
    const f = email();
    const unused = await findOrCreateTrainer(f, "EMAIL");
    await deleteTrainerAccount(unused.id);
    await expect(startTrainerTrial((await findOrCreateTrainer(f, "EMAIL")).id)).resolves.toBeTruthy();
  });

  it("the app can't change the member's plan: only the trial or a confirmed payment can", async () => {
    const m = await findOrCreateTrainer(email(), "EMAIL");
    await startTrainerTrial(m.id, "ai-pro");
    await saveTrainerState(m.id, { plan: "ai-premium", cycle: "YEARLY" } as Parameters<typeof saveTrainerState>[1]);
    const after = await member(m.id);
    expect(after.plan).toBe("ai-pro");
    expect(after.cycle).toBe("YEARLY");
  });

  it("the coach prompt uses the saved onboarding answers over what the app sent", () => {
    const lines = profileLines({ ob: { name: "Asha", goal: "Lose fat", injuries: ["Knee"], timeOfDay: "Morning", supps: ["Whey"], suppCustom: ["Creatine"] } }, { name: "Old", kcal: 1800 });
    expect(lines).toEqual(["- Main goal: Lose fat", "- Injuries: Knee", "- Trains at: Morning", "- Supplements: Whey, Creatine", "- Calorie target (kcal/day): 1800"]);
    const sys = coachSystem({ name: "Asha", plan: "ai-premium" }, lines);
    expect(sys).toContain("AI Premium plan");
    expect(sys).toContain("- Main goal: Lose fat");
    expect(sys).not.toMatch(/Asha|Old/);
    // City and state only when the member left "Use my city for food suggestions" on.
    const where = { ob: { city: "Ranchi", state: "Jharkhand", goal: "Lose fat" } };
    expect(profileLines(where, {})).toContain("- City: Ranchi");
    const off = profileLines({ ...where, consentPrefs: { city: false } }, { city: "Ranchi", state: "Jharkhand" });
    expect(off.join("\n")).not.toMatch(/Ranchi|Jharkhand/);
  });

  it("keeps the day's logged sets, cleaned, and shows each lift's progress", async () => {
    const m = await findOrCreateTrainer(email(), "EMAIL");
    await saveTrainerState(m.id, { day: { workoutDone: true, sets: [{ ex: "Bench Press", kg: 40, reps: 10 }, { ex: " Bench Press ", kg: "42.3", reps: 8.4 }, { ex: "", kg: 10, reps: 5 }, { ex: "Squat", kg: 999, reps: 5 }, { ex: "Squat", kg: 60, reps: 0 }, "junk"] } }, "2026-09-20");
    await saveTrainerState(m.id, { day: { workoutDone: true, sets: [{ ex: "Bench Press", kg: 45, reps: 8 }] } }, "2026-09-27");
    const d = await loadTrainer(m.id, "2026-09-27");
    expect(d.today?.sets).toEqual([{ ex: "Bench Press", kg: 45, reps: 8 }]);
    expect(d.progress.strength).toEqual([{ ex: "Bench Press", first: { kg: 42.5, reps: 8, date: "2026-09-20" }, best: { kg: 45, reps: 8, date: "2026-09-27" }, sessions: 2 }]);
    // Saving the day without sets leaves them as they are.
    await saveTrainerState(m.id, { day: { water: 1 } }, "2026-09-27");
    expect((await loadTrainer(m.id, "2026-09-27")).today?.sets).toHaveLength(1);
    expect((await exportTrainer(m.id)).days.map((d) => d.sets?.length)).toEqual([2, 1]);
  });
});
