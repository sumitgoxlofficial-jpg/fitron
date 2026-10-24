// The employee side of the CRM, with no database in it: passwords for new accounts, the profile and payout details a
// person must give before they can work, the terms they accept, and the commission rules. Applied on the server
// (src/lib/services/crm-auth.ts, crm-profile.ts); the pages use the same functions to show the rules as someone types.

import { normalizePhone } from "./crm";

export const TERMS_VERSION = "v1.1";
/** The first 30 days after joining pay 20% of each verified deal; after that, a monthly salary plus an incentive of up to 5%. */
export const FIRST_RATE = 0.2;
export const FIRST_DAYS = 30;
export const INCENTIVE_MAX = 5;
export const WORK_DOMAIN = "fitron.in";

// ── Passwords ──────────────────────────────────────────────────────────────

export type PasswordRule = { key: string; text: string; ok: boolean };

/** The rules for a new password, each with whether it holds; a password is acceptable when every rule does. */
export function passwordRules(pw: string, email = ""): PasswordRule[] {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  return [
    { key: "length", text: "8+ characters", ok: pw.length >= 8 },
    { key: "upper", text: "Uppercase", ok: /[A-Z]/.test(pw) },
    { key: "lower", text: "Lowercase", ok: /[a-z]/.test(pw) },
    { key: "number", text: "Number", ok: /\d/.test(pw) },
    { key: "name", text: "No name, email or “fitron”", ok: pw.length > 0 && !(local.length >= 3 && pw.toLowerCase().includes(local)) && !/^(password|fitron)/i.test(pw) },
  ];
}
export const passwordError = (pw: string, email = "") =>
  passwordRules(pw, email).every((r) => r.ok) ? null : /^(password|fitron)/i.test(pw) || passwordRules(pw, email).find((r) => r.key === "name" && !r.ok) ? "Choose a password that doesn’t contain your name, email or “fitron”." : "Set a password with at least 8 characters, an uppercase letter, a lowercase letter and a number.";

export const isWorkEmail = (e: string) => new RegExp(`^[^@\\s]+@${WORK_DOMAIN.replace(".", "\\.")}$`, "i").test(e.trim());

/** What someone types to sign in: an email, or an employee ID written as FIT-EMP-0004, FITEMP4 or just 4. Returns the lookup. */
export function signInKey(raw: string): { email: string } | { empId: string } {
  const k = raw.trim().toLowerCase();
  const m = k.match(/^(?:fit-?emp-?)?(\d{1,4})$/);
  return m ? { empId: `FIT-EMP-${String(Number(m[1])).padStart(4, "0")}` } : { email: k };
}

// ── Profile and payout ─────────────────────────────────────────────────────

export type PayMethod = "bank" | "upi";
export type ProfileInput = { fullName: string; phone: string; address: string; city: string; state: string; pin: string; payMethod: PayMethod; accName: string; bankName: string; accNo: string; accNo2: string; ifsc: string; upi: string; upiName: string; agree: boolean };
export type Profile = { fullName: string; phone: string; address: string; city: string; state: string; pin: string };
export type Payout = { method: PayMethod; accName: string; bankName: string; accNo: string; ifsc: string; upi: string; upiName: string };
export type ProfileCheck = { ok: true; profile: Profile; payout: Payout } | { ok: false; error: string; field?: keyof ProfileInput };

export function checkProfile(p: ProfileInput, termsNeeded: boolean): ProfileCheck {
  const bad = (error: string, field?: keyof ProfileInput): ProfileCheck => ({ ok: false, error, field });
  const phone = normalizePhone(p.phone);
  if ((p.fullName ?? "").trim().length < 3) return bad("Enter your full name as it appears on your bank account.", "fullName");
  if (!phone) return bad("Enter a valid 10-digit mobile number.", "phone");
  if ((p.address ?? "").trim().length < 6) return bad("Enter your full address.", "address");
  if (!p.city?.trim() || !p.state?.trim()) return bad("City and state are required.", "city");
  if (!/^[1-9]\d{5}$/.test(p.pin ?? "")) return bad("PIN code must be 6 digits.", "pin");
  const payout: Payout = { method: p.payMethod, accName: "", bankName: "", accNo: "", ifsc: "", upi: "", upiName: "" };
  if (p.payMethod === "bank") {
    if ((p.accName ?? "").trim().length < 3) return bad("Enter the account holder name.", "accName");
    if ((p.bankName ?? "").trim().length < 3) return bad("Enter the bank name.", "bankName");
    if (!/^\d{9,18}$/.test(p.accNo ?? "")) return bad("Account number must be 9 to 18 digits.", "accNo");
    if (p.accNo !== p.accNo2) return bad("Account numbers do not match.", "accNo2");
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test((p.ifsc ?? "").toUpperCase())) return bad("IFSC must be 11 characters, like HDFC0001234.", "ifsc");
    Object.assign(payout, { accName: p.accName.trim(), bankName: p.bankName.trim(), accNo: p.accNo, ifsc: p.ifsc.toUpperCase() });
  } else if (p.payMethod === "upi") {
    if (!/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test((p.upi ?? "").trim())) return bad("Enter a valid UPI ID, like name@okhdfcbank.", "upi");
    if ((p.upiName ?? "").trim().length < 3) return bad("Enter the name on your UPI account.", "upiName");
    Object.assign(payout, { upi: p.upi.trim(), upiName: p.upiName.trim() });
  } else return bad("Choose how you want to be paid.", "payMethod");
  if (termsNeeded && !p.agree) return bad("Accept the terms and conditions to continue.", "agree");
  return { ok: true, profile: { fullName: p.fullName.trim(), phone, address: p.address.trim(), city: p.city.trim(), state: p.state.trim(), pin: p.pin }, payout };
}

/** "UPI · na•••@oksbi" or "HDFC Bank ••••7812": enough to recognise the account, never enough to use it. */
export const payToText = (p: Payout | null | undefined) => (!p || (p.method === "upi" ? !p.upi : !p.accNo || !p.ifsc) ? "No payout account" : p.method === "upi" ? `UPI · ${p.upi.replace(/^(.{2}).*(@.*)$/, "$1•••$2")}` : `${p.bankName} ••••${p.accNo.slice(-4)}`);

/** Everything needed to be paid and to work: the profile, a payout account (only ever saved once it passed `checkProfile`) and the accepted terms. */
export const profileDone = (profile: Partial<Profile> | null | undefined, hasPayout: boolean) => !!(profile?.fullName && profile.address && hasPayout);
export const termsOk = (s: { termsVersion: string | null; termsAcceptedAt: Date | null }) => !!(s.termsAcceptedAt && s.termsVersion === TERMS_VERSION);
/** Until they have both, a new employee can only open their profile. */
export const needsSetup = (s: { termsVersion: string | null; termsAcceptedAt: Date | null }, profile: Partial<Profile> | null | undefined, hasPayout: boolean) => !profileDone(profile, hasPayout) || !termsOk(s);

// ── Commission ─────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const istDay = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const dayMs = (iso: string) => new Date(`${iso}T00:00:00+05:30`).getTime();

/** The rate that applies to a deal verified at `at`: 20% inside the first 30 days after joining, the person's incentive (0–5%) after that. */
export function commissionRate(joinedAt: string, incentive: number, at: Date) {
  const firstEnds = dayMs(joinedAt) + FIRST_DAYS * DAY;
  return at.getTime() < firstEnds ? FIRST_RATE : Math.min(INCENTIVE_MAX, Math.max(0, incentive)) / 100;
}
/** The first day the person is on salary and incentive. */
export const firstMonthEnds = (joinedAt: string) => istDay(new Date(dayMs(joinedAt) + FIRST_DAYS * DAY));
export const rateText = (r: number) => `${Math.round(r * 1000) / 10}%`;

export type Earning = { dealValue: number; at: Date; rate: number; amount: number };

/** The commission on verified deals: each deal at the rate in force the day it was verified, in paise. */
export function earnings(deals: { value: number; verifiedAt: Date }[], joinedAt: string, incentive: number): Earning[] {
  return deals.map((d) => {
    const rate = commissionRate(joinedAt, incentive, d.verifiedAt);
    return { dealValue: d.value, at: d.verifiedAt, rate, amount: Math.round(d.value * rate) };
  });
}

/** Commission earned today, this month (India calendar), in all, and what is still pending (submitted, not yet approved; not earned). */
export function earningTotals(list: Earning[], pendingValue: number, joinedAt: string, incentive: number, now = new Date()) {
  const today = istDay(now);
  const month = today.slice(0, 7);
  const sum = (f: (e: Earning) => boolean) => list.filter(f).reduce((a, e) => a + e.amount, 0);
  return {
    today: sum((e) => istDay(e.at) === today),
    todayN: list.filter((e) => istDay(e.at) === today).length,
    month: sum((e) => istDay(e.at).startsWith(month)),
    total: sum(() => true),
    n: list.length,
    // A pending deal would earn at the rate in force today.
    pending: Math.round(pendingValue * commissionRate(joinedAt, incentive, now)),
  };
}

/** The payout date for earnings of a month: the 2nd of the next month. */
export function nextPayoutDate(now = new Date()) {
  const [y, m, d] = istDay(now).split("-").map(Number) as [number, number, number];
  const next = d < 2 ? new Date(Date.UTC(y, m - 1, 2)) : new Date(Date.UTC(y, m, 2));
  return next.toISOString().slice(0, 10);
}

/** What FITRON owes an employee on the next payout: the salary (once the first month is over) plus the month's commission. */
export function payoutDue(opts: { salary: number | null; joinedAt: string; monthCommission: number; at?: Date }) {
  const at = opts.at ?? new Date();
  const onSalary = at.getTime() >= dayMs(opts.joinedAt) + FIRST_DAYS * DAY;
  return (onSalary ? (opts.salary ?? 0) : 0) + opts.monthCommission;
}

// ── Terms ──────────────────────────────────────────────────────────────────

export const TERMS: [heading: string, body: string][] = [
  ["First-month commission", "For your first 30 days from your joining date, you earn 20% commission on the sale value of Gym Accounting and Gym Partnership deals you close. A deal counts only after an authorised manager or Super Admin verifies the payment or signed agreement."],
  ["Salary and incentive", "From day 31 you receive a fixed monthly salary set in your offer, plus an incentive of up to 5% on verified sales. The salary amount and incentive rate are set by FITRON and shown in your profile."],
  ["Monthly payout", "Your salary for the month and all commission or incentive verified in that month are paid to your registered bank account or UPI ID by the 2nd day of the following month."],
  ["Payout account", "You are responsible for keeping your bank or UPI details correct. Changes apply from the next payout and are logged and reviewed. FITRON is not liable for payments sent to details you provided."],
  ["Reversals", "If a customer is refunded, charges back or cancels within the refund period, the related commission may be deducted from your next payout."],
  ["Taxes", "Payouts are subject to tax deductions at source and other deductions required by law."],
  ["Attribution", "The closer recorded on a verified deal receives the commission. Disputes are reviewed by the Super Admin, whose decision is final for payout purposes."],
  ["Confidentiality", "Lead and customer data must stay inside the CRM. Copying, exporting or sharing it without permission is not allowed, and personal data is handled in line with the DPDP Act, 2023."],
  ["Changes", "FITRON may update these terms. You will be asked to accept the new version before you continue using the CRM."],
];
export const TERMS_EFFECTIVE = "24 October 2026";
