import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { hasDb } from "@/test/db";
import { loadCrmUser, nextEmpId, teamOrg, teamRoleId, type CrmUser } from "./crm-access";
import { confirmEmployeeEmail, employeeSignIn, employeeSignUp, requestEmployeeReset, resetEmployeePassword } from "./crm-auth";
import { saveProfile, myProfile } from "./crm-profile";
import { inviteEmployee } from "./crm-people";
import { issueCode, issueToken } from "./accounts";

const mail = () => `${randomUUID().slice(0, 8)}@fitron.in`;
const ip = () => `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const PW = "Str0ng-Passw0rd";
const base = (email: string) => ({ name: "Test Person", email, phone: "98765 43210", password: PW, confirm: PW });
const profileIn = { fullName: "Test Person", phone: "9876543210", address: "12 MG Road", city: "Pune", state: "Maharashtra", pin: "411001", payMethod: "bank" as const, accName: "Test Person", bankName: "HDFC Bank", accNo: "50100234567812", accNo2: "50100234567812", ifsc: "HDFC0000523", upi: "", upiName: "", agree: true };

describe.skipIf(!hasDb)("employee accounts (database)", () => {
  let admin: CrmUser;
  beforeAll(async () => {
    const [orgId, roleId] = await Promise.all([teamOrg(), teamRoleId()]);
    const u = await db.user.create({ data: { orgId, roleId, name: "Admin", email: `${randomUUID()}@test.local`, phone: "", passwordHash: "x", emailVerifiedAt: new Date() } });
    await db.crmStaff.create({ data: { userId: u.id, empId: await nextEmpId(), role: "admin" } });
    admin = (await loadCrmUser(u.id))!;
  });

  it("creates an account for a work email only, and refuses weak passwords and a mismatch", async () => {
    await expect(employeeSignUp(base("someone@gmail.com"), ip())).rejects.toThrow(/@fitron\.in/);
    await expect(employeeSignUp({ ...base(mail()), password: "weak", confirm: "weak" }, ip())).rejects.toThrow(/at least 8/);
    await expect(employeeSignUp({ ...base(mail()), confirm: "Different-Pass1" }, ip())).rejects.toThrow(/do not match/);
    await expect(employeeSignUp({ ...base(mail()), phone: "123" }, ip())).rejects.toThrow(/10-digit/);
    await expect(employeeSignUp({ ...base(mail()), name: "Al" }, ip())).rejects.toThrow(/full name/);
  });

  it("makes a Sales Employee with an employee ID, tells the Super Admins, and signs in by email or by ID", async () => {
    const email = mail();
    await employeeSignUp(base(email), ip());
    const staff = await db.crmStaff.findFirstOrThrow({ where: { user: { email } }, include: { user: true } });
    expect(staff).toMatchObject({ role: "sales", status: "Active" });
    expect(staff.empId).toMatch(/^FIT-EMP-\d{4}$/);
    expect(await db.crmNotification.count({ where: { userId: admin.id, text: { contains: "New account" } } })).toBeGreaterThan(0);
    // No email service in tests, so the address is trusted at once, as for gyms.
    expect(await employeeSignIn(email, PW, ip())).toMatchObject({ ok: true, userId: staff.userId });
    expect(await employeeSignIn(staff.empId, PW, ip())).toMatchObject({ ok: true });
    expect(await employeeSignIn(String(Number(staff.empId.slice(-4))), PW, ip())).toMatchObject({ ok: true });
    await expect(employeeSignUp(base(email), ip())).rejects.toThrow(/already exists/);
  });

  it("says the same thing for a wrong password and an unknown person, and locks after five tries", async () => {
    const email = mail();
    await employeeSignUp(base(email), ip());
    const a = await employeeSignIn(email, "Wrong-pass-1", "1.1.1.1");
    const b = await employeeSignIn(mail(), "Wrong-pass-1", "1.1.1.2");
    expect(a).toEqual({ ok: false, error: "Email / employee ID or password is incorrect." });
    expect(b).toEqual(a);
    let last: Awaited<ReturnType<typeof employeeSignIn>> = a;
    for (let i = 0; i < 6; i++) last = await employeeSignIn(email, "Wrong-pass-1", "1.1.1.1");
    expect(last).toMatchObject({ ok: false, error: expect.stringMatching(/locked/i) });
    expect(await employeeSignIn(email, PW, "1.1.1.1")).toMatchObject({ ok: false }); // still locked, even with the right one
  });

  it("finishes an invite: the invited account can't sign in until its owner creates it, and keeps its role and employee ID", async () => {
    const email = mail();
    const invited = await inviteEmployee(admin, { name: "Invited Person", email, role: "manager" });
    expect(invited.status).toBe("Invited");
    expect(await employeeSignIn(email, PW, ip())).toMatchObject({ ok: false, error: expect.stringMatching(/invited but not set up/) });
    expect(await loadCrmUser(invited.userId)).toBeNull();
    await employeeSignUp({ ...base(email), name: "Invited Person" }, ip());
    const after = await db.crmStaff.findUniqueOrThrow({ where: { userId: invited.userId } });
    expect(after).toMatchObject({ role: "manager", status: "Active", empId: invited.empId });
    expect(await employeeSignIn(email, PW, ip())).toMatchObject({ ok: true });
  });

  it("refuses a deactivated employee only once the password is right, and an unconfirmed email", async () => {
    const email = mail();
    await employeeSignUp(base(email), ip());
    const staff = await db.crmStaff.findFirstOrThrow({ where: { user: { email } } });
    await db.crmStaff.update({ where: { userId: staff.userId }, data: { status: "Inactive" } });
    expect(await employeeSignIn(email, "Wrong-pass-1", ip())).toMatchObject({ error: "Email / employee ID or password is incorrect." });
    expect(await employeeSignIn(email, PW, ip())).toMatchObject({ ok: false, error: expect.stringMatching(/deactivated/) });
    await db.crmStaff.update({ where: { userId: staff.userId }, data: { status: "Active" } });
    await db.user.update({ where: { id: staff.userId }, data: { emailVerifiedAt: null } });
    expect(await employeeSignIn(email, PW, ip())).toMatchObject({ ok: false, unverified: email });
    const code = await issueCode(staff.userId, "VERIFY_EMAIL");
    expect(await confirmEmployeeEmail({ email, code: "000000" })).toBe(false);
    expect(await confirmEmployeeEmail({ email, code })).toBe(true);
    expect(await employeeSignIn(email, PW, ip())).toMatchObject({ ok: true });
    const token = await issueToken(staff.userId, "VERIFY_EMAIL");
    expect(await confirmEmployeeEmail({ token })).toBe(true);
    expect(await confirmEmployeeEmail({ token })).toBe(false); // one use
  });

  it("resets a password with a link or a code, once, and signs the person out everywhere", async () => {
    const email = mail();
    await employeeSignUp(base(email), ip());
    const staff = await db.crmStaff.findFirstOrThrow({ where: { user: { email } } });
    await db.session.create({ data: { id: randomUUID(), userId: staff.userId, expiresAt: new Date(Date.now() + 1e6) } });
    await requestEmployeeReset(email, ip());
    const token = await issueToken(staff.userId, "RESET_PASSWORD");
    await expect(resetEmployeePassword({ token }, "weak", "weak")).rejects.toThrow(/at least 8/);
    await resetEmployeePassword({ token }, "New-Passw0rd-9", "New-Passw0rd-9"); // the weak try did not use the link up
    expect(await db.session.count({ where: { userId: staff.userId } })).toBe(0);
    expect(await employeeSignIn(email, PW, ip())).toMatchObject({ ok: false });
    expect(await employeeSignIn(email, "New-Passw0rd-9", ip())).toMatchObject({ ok: true });
    await expect(resetEmployeePassword({ token }, "Another-Passw0rd-1", "Another-Passw0rd-1")).rejects.toThrow(/expired or was already used/);
    const code = await issueCode(staff.userId, "RESET_PASSWORD");
    await resetEmployeePassword({ email, code }, "Third-Passw0rd-3", "Third-Passw0rd-3");
    expect(await employeeSignIn(email, "Third-Passw0rd-3", ip())).toMatchObject({ ok: true });
  });

  it("keeps a new employee on the profile page until profile, payout and terms are in, and seals the account number", async () => {
    const email = mail();
    await employeeSignUp(base(email), ip());
    const staff = await db.crmStaff.findFirstOrThrow({ where: { user: { email } } });
    let me = (await loadCrmUser(staff.userId))!;
    expect(me.setupNeeded).toBe(true);
    await expect(saveProfile(me, { ...profileIn, agree: false })).rejects.toThrow(/terms/);
    await expect(saveProfile(me, { ...profileIn, ifsc: "BAD" })).rejects.toThrow(/IFSC/);
    expect((await saveProfile(me, profileIn)).firstTime).toBe(true);
    me = (await loadCrmUser(staff.userId))!;
    expect(me.setupNeeded).toBe(false);
    const row = await db.crmStaff.findUniqueOrThrow({ where: { userId: staff.userId } });
    expect(Buffer.from(row.payout!).toString("utf8")).not.toContain("50100234567812");
    expect(JSON.stringify(row.profile)).not.toContain("50100234567812");
    expect(row.termsVersion).toBe("v1.1");
    const view = await myProfile(me);
    expect(view.payout).toMatchObject({ text: "HDFC Bank ••••7812", last4: "7812" });
    expect(JSON.stringify(view)).not.toContain("50100234567812");
    // Later edits keep the saved account number when it is left empty, and need no terms again.
    expect((await saveProfile(me, { ...profileIn, accNo: "", accNo2: "", ifsc: "", city: "Mumbai", agree: false })).firstTime).toBe(false);
    expect((await myProfile(me)).payout?.last4).toBe("7812");
    const audit = (await db.crmAudit.findMany({ where: { actorId: staff.userId } })).map((a) => a.text).join("\n");
    expect(audit).toContain("added their payout account");
    expect(audit).not.toContain("50100234567812");
  });

  it("tells the Super Admins when someone changes a payout account that was already set", async () => {
    const email = mail();
    await employeeSignUp(base(email), ip());
    const staff = await db.crmStaff.findFirstOrThrow({ where: { user: { email } } });
    const me = (await loadCrmUser(staff.userId))!;
    await saveProfile(me, profileIn);
    const before = await db.crmNotification.count({ where: { userId: admin.id, text: { contains: "changed their payout" } } });
    await saveProfile(me, { ...profileIn, payMethod: "upi", upi: "test@okhdfc", upiName: "Test Person", agree: false });
    expect(await db.crmNotification.count({ where: { userId: admin.id, text: { contains: "changed their payout" } } })).toBe(before + 1);
  });
});
