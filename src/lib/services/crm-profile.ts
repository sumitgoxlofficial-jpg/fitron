import "server-only";
import { db } from "@/lib/db";
import { checkProfile, payToText, termsOk, TERMS_VERSION, type Payout, type PayMethod, type Profile, type ProfileInput } from "@/lib/domain/crm-pay";
import { sealSecret, unsealSecret } from "./two-step";
import { activeAdmins, crmAudit, notify, type CrmUser } from "./crm-access";
import { UserError } from "./errors";

// What an employee gives before they can work: who they are, where to pay them, and the terms they accept. The bank or UPI
// details are sealed (AES-256-GCM) in the database and only shown back masked; the audit trail records that they changed, never what they are.

export type PayoutView = { method: PayMethod; text: string; hasAccount: boolean; accName: string; bankName: string; ifscSet: boolean; upi: string; upiName: string; last4: string };

const open = (b: Uint8Array | null): Payout | null => {
  if (!b) return null;
  try {
    return JSON.parse(unsealSecret(b)) as Payout;
  } catch {
    return null;
  }
};

export async function myProfile(u: CrmUser) {
  const s = await db.crmStaff.findUniqueOrThrow({ where: { userId: u.id }, include: { user: { select: { name: true, email: true, photoKey: true } } } });
  const profile = (s.profile as Partial<Profile> | null) ?? {};
  const pay = open(s.payout);
  return {
    empId: s.empId,
    email: s.user.email,
    name: s.user.name,
    hasPhoto: !!s.user.photoKey,
    profile: { fullName: profile.fullName ?? s.user.name, phone: profile.phone ?? "", address: profile.address ?? "", city: profile.city ?? "", state: profile.state ?? "", pin: profile.pin ?? "" },
    payout: pay ? { method: pay.method, text: payToText(pay), hasAccount: true, accName: pay.accName, bankName: pay.bankName, ifscSet: !!pay.ifsc, upi: pay.upi, upiName: pay.upiName, last4: pay.accNo.slice(-4) } : null,
    termsAccepted: termsOk(s),
    termsAcceptedAt: s.termsAcceptedAt,
  };
}

/** Saves the profile. The account number may be left empty to keep the one on file. The first save (and any new terms version) needs the terms accepted. */
export async function saveProfile(u: CrmUser, input: ProfileInput) {
  const s = await db.crmStaff.findUniqueOrThrow({ where: { userId: u.id } });
  const old = open(s.payout);
  const needTerms = !termsOk(s);
  // Keep the saved account number if the person didn't type a new one.
  const keep = input.payMethod === "bank" && old?.method === "bank" && !input.accNo && !input.accNo2;
  const merged: ProfileInput = keep ? { ...input, accNo: old!.accNo, accNo2: old!.accNo, ifsc: input.ifsc || old!.ifsc } : input;
  const c = checkProfile(merged, needTerms);
  if (!c.ok) throw new UserError(c.error, c.field);
  const payChanged = JSON.stringify(old) !== JSON.stringify(c.payout);
  const firstTime = !s.payout || needTerms;
  await db.$transaction(async (tx) => {
    await tx.crmStaff.update({
      where: { userId: u.id },
      data: { profile: c.profile, payout: sealSecret(JSON.stringify(c.payout)), ...(needTerms ? { termsVersion: TERMS_VERSION, termsAcceptedAt: new Date() } : {}) },
    });
    await tx.user.update({ where: { id: u.id }, data: { name: c.profile.fullName, phone: c.profile.phone } });
    await crmAudit(tx, { actorId: u.id, kind: "user", text: `${c.profile.fullName} updated their profile` });
    if (payChanged) await crmAudit(tx, { actorId: u.id, kind: "user", text: `${c.profile.fullName} ${old ? "changed" : "added"} their payout account (${c.payout.method === "upi" ? "UPI" : "bank"})` });
    if (needTerms) await crmAudit(tx, { actorId: u.id, kind: "user", text: `${c.profile.fullName} accepted terms ${TERMS_VERSION}` });
    if (payChanged && old) await notify(tx, await activeAdmins(tx), `${c.profile.fullName} changed their payout account. Review before the next payout.`, null, u.id);
  });
  return { firstTime };
}
