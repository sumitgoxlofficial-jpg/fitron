import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { deleteObject, getObject, putObject, sniffType } from "@/lib/integrations/storage";
import { checkProfile, payToText, termsOk, TERMS_VERSION, type Payout, type PayMethod, type Profile, type ProfileInput } from "@/lib/domain/crm-pay";
import { sealSecret, unsealSecret } from "./two-step";
import { activeAdmins, crmAudit, notify, type CrmUser } from "./crm-access";
import { UserError } from "./errors";

// What an employee gives before they can work: who they are, where to pay them, and the terms they accept. The bank or UPI
// details are sealed (AES-256-GCM) in the database and only shown back masked; the audit trail records that they changed, never what they are.

export type PayoutView = { method: PayMethod; text: string; hasAccount: boolean; accName: string; bankName: string; ifscSet: boolean; upi: string; upiName: string; last4: string };

export const openPayout = (b: Uint8Array | null): Payout | null => {
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
  const pay = openPayout(s.payout);
  return {
    empId: s.empId,
    email: s.user.email,
    name: s.user.name,
    hasPhoto: !!s.user.photoKey,
    /** Changes with every new photo, so the browser fetches it again. */
    photoTag: s.user.photoKey?.split("/").pop()?.split(".")[0] ?? "",
    profile: { fullName: profile.fullName ?? s.user.name, phone: profile.phone ?? "", address: profile.address ?? "", city: profile.city ?? "", state: profile.state ?? "", pin: profile.pin ?? "" },
    payout: pay ? { method: pay.method, text: payToText(pay), hasAccount: true, accName: pay.accName, bankName: pay.bankName, ifscSet: !!pay.ifsc, upi: pay.upi, upiName: pay.upiName, last4: pay.accNo.slice(-4) } : null,
    termsAccepted: termsOk(s),
    termsAcceptedAt: s.termsAcceptedAt,
  };
}

/** Saves the profile. The account number may be left empty to keep the one on file. The first save (and any new terms version) needs the terms accepted. */
export async function saveProfile(u: CrmUser, input: ProfileInput) {
  const s = await db.crmStaff.findUniqueOrThrow({ where: { userId: u.id } });
  const old = openPayout(s.payout);
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

// ── Profile photo ──────────────────────────────────────────────────────────

const MAX_PHOTO = 5 * 1024 * 1024;
const PHOTO_MIME = ["image/jpeg", "image/png", "image/webp"];

/** Saves the photo the person picked (the page crops it square first). Stored privately; only signed-in employees can see it. */
export async function setCrmPhoto(u: CrmUser, file: File) {
  if (!file || typeof file.arrayBuffer !== "function" || file.size === 0) throw new UserError("Choose a photo.", "photo");
  if (file.size > MAX_PHOTO) throw new UserError("That photo is over 5 MB. Choose a smaller one.", "photo");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffType(bytes);
  if (!type || !PHOTO_MIME.includes(type.mime)) throw new UserError("Choose a JPG, PNG or WebP image.", "photo");
  const key = `crm/${u.id}/${randomUUID()}.${type.ext}`;
  await putObject(key, bytes, type.mime);
  let old: string | null;
  try {
    old = await db.$transaction(async (tx) => {
      const { photoKey } = await tx.user.findUniqueOrThrow({ where: { id: u.id }, select: { photoKey: true } });
      await tx.user.update({ where: { id: u.id }, data: { photoKey: key } });
      await crmAudit(tx, { actorId: u.id, kind: "user", text: `${u.name} updated their profile photo` });
      return photoKey;
    });
  } catch (e) {
    await deleteObject(key).catch(() => {});
    throw e;
  }
  if (old) await deleteObject(old).catch(() => {});
}

export async function removeCrmPhoto(u: CrmUser) {
  const old = await db.$transaction(async (tx) => {
    const { photoKey } = await tx.user.findUniqueOrThrow({ where: { id: u.id }, select: { photoKey: true } });
    if (!photoKey) return null;
    await tx.user.update({ where: { id: u.id }, data: { photoKey: null } });
    await crmAudit(tx, { actorId: u.id, kind: "user", text: `${u.name} removed their profile photo` });
    return photoKey;
  });
  if (old) await deleteObject(old).catch(() => {});
}

/** A colleague's photo for any signed-in employee: the bytes and type, or null. */
export async function readCrmPhoto(userId: string) {
  const row = await db.user.findFirst({ where: { id: userId, crmStaff: { isNot: null } }, select: { photoKey: true } });
  if (!row?.photoKey) return null;
  const body = await getObject(row.photoKey).catch(() => null);
  const mime = sniffType(body ?? new Uint8Array())?.mime;
  return body && mime ? { body, mime, key: row.photoKey } : null;
}
