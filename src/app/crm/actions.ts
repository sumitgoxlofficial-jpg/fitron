"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCrm } from "@/lib/auth/crm";
import { destroySession } from "@/lib/auth/session";
import { simpleAction } from "@/lib/form-action";
import { isStage, type ImportField, type StageChange } from "@/lib/domain/crm";
import type { FormState } from "@/lib/validation/common";
import { addNote, addTask, approveDeal, assignLead, changeStage, completeTask, createLead, logCall, rejectDeal, updateLead } from "@/lib/services/crm-leads";
import { commitImport, previewImport } from "@/lib/services/crm-io";
import { removeCrmPhoto, saveProfile, setCrmPhoto } from "@/lib/services/crm-profile";
import { inviteEmployee, markAllRead, saveCampaign, updateEmployee } from "@/lib/services/crm-people";
import { istInstant } from "@/lib/services/time";

// Every action starts by finding out who is asking, from the session, and the services decide what that person may do.
// Nothing the browser sends (not even a hidden field) says who someone is or what they may touch. A refusal comes back as the
// message "You don't have access…" and is written to the audit trail.

const s = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? (fd.get(k) as string).trim() : "");
const num = (fd: FormData, k: string) => (s(fd, k) === "" ? undefined : Number(s(fd, k).replace(/[₹,\s]/g, "")));
const version = (fd: FormData) => (s(fd, "version") ? Number(s(fd, "version")) : undefined);
/** "2026-10-30" + "15:30" (India) → the moment. */
const when = (fd: FormData, d: string, t: string) => (s(fd, d) ? istInstant(s(fd, d), s(fd, t) || "10:00") : null);

async function run(fn: (u: Awaited<ReturnType<typeof requireCrm>>) => Promise<unknown>, ok: string, paths: string[]): Promise<FormState> {
  const u = await requireCrm();
  const r = await simpleAction(() => fn(u), ok);
  for (const p of paths) revalidatePath(p);
  return r;
}

const lead = (id: string) => ["/crm", "/crm/leads", `/crm/leads/${id}`, "/crm/pipeline", "/crm/tasks", "/crm/verification"];

export async function saveNewLead(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requireCrm();
  let id = "";
  const r = await simpleAction(async () => {
    id = (await createLead(u, { contactName: s(fd, "contactName"), gymName: s(fd, "gymName"), phone: s(fd, "phone"), altPhone: s(fd, "altPhone"), email: s(fd, "email"), city: s(fd, "city"), state: s(fd, "state"), pin: s(fd, "pin"), plan: s(fd, "plan"), billing: s(fd, "billing"), campaignId: s(fd, "campaignId") || undefined, source: s(fd, "source") })).id;
  }, "Lead added.");
  if (!r?.ok) return { ...r, values: Object.fromEntries([...fd].filter(([, v]) => typeof v === "string")) as Record<string, string>, nonce: r?.nonce };
  revalidatePath("/crm/leads");
  redirect(`/crm/leads/${id}`);
}

export async function saveLeadDetails(id: string, _: FormState, fd: FormData): Promise<FormState> {
  return run((u) => updateLead(u, id, { priority: s(fd, "priority") || undefined, plan: s(fd, "plan") || undefined, billing: s(fd, "billing") || undefined, contactName: s(fd, "contactName"), gymName: s(fd, "gymName"), city: s(fd, "city"), district: s(fd, "district"), state: s(fd, "state"), pin: s(fd, "pin"), address: s(fd, "address"), ...(fd.has("phone") ? { phone: s(fd, "phone"), altPhone: s(fd, "altPhone"), email: s(fd, "email") } : {}), campaignId: fd.has("campaignId") ? s(fd, "campaignId") : undefined }, version(fd)), "Saved.", lead(id));
}

export async function assignAction(id: string, _: FormState, fd: FormData): Promise<FormState> {
  return run((u) => assignLead(u, id, s(fd, "ownerId") || null, version(fd)), "Owner updated.", lead(id));
}

export async function stageAction(id: string, _: FormState, fd: FormData): Promise<FormState> {
  const to = s(fd, "to");
  if (!isStage(to)) return { message: "Choose a stage." };
  // The deal's value is not read from the form: the service works it out from the plan and add-ons.
  const c: StageChange = { to, lossReason: s(fd, "lossReason") || undefined, proofType: s(fd, "proofType") || undefined, proofRef: s(fd, "proofRef") || undefined, closedDate: s(fd, "closedDate") || undefined, plan: s(fd, "plan") || undefined, billing: s(fd, "billing") || undefined, addons: fd.getAll("addons").map(String) };
  return run((u) => changeStage(u, id, c, version(fd)), "Stage updated.", lead(id));
}

/** The pipeline board's drop: stages that need no extra details only. */
export async function moveCard(id: string, to: string): Promise<{ ok: boolean; message?: string }> {
  if (!isStage(to)) return { ok: false, message: "That is not a stage." };
  const r = await run((u) => changeStage(u, id, { to }), "Moved.", lead(id));
  return { ok: !!r?.ok, message: r?.message };
}

export async function callAction(id: string, _: FormState, fd: FormData): Promise<FormState> {
  return run((u) => logCall(u, id, { outcome: s(fd, "outcome"), notes: s(fd, "notes"), objection: s(fd, "objection"), nextAction: s(fd, "nextAction"), followUpAt: when(fd, "followDate", "followTime"), taskType: s(fd, "taskType") || undefined }), "Call logged.", lead(id));
}

export async function noteAction(id: string, _: FormState, fd: FormData): Promise<FormState> {
  return run((u) => addNote(u, id, s(fd, "notes")), "Note added.", lead(id));
}

export async function taskAction(id: string, _: FormState, fd: FormData): Promise<FormState> {
  const due = when(fd, "dueDate", "dueTime");
  if (!due) return { message: "Choose the date." };
  return run((u) => addTask(u, id, { type: s(fd, "type"), dueAt: due, priority: s(fd, "priority") || undefined }), "Task added.", lead(id));
}

export async function doneAction(taskId: string, leadId: string) {
  await run((u) => completeTask(u, taskId), "Done.", lead(leadId));
}

export async function approveAction(id: string) {
  await run((u) => approveDeal(u, id), "Deal verified.", lead(id));
}

export async function rejectAction(id: string, _: FormState, fd: FormData): Promise<FormState> {
  return run((u) => rejectDeal(u, id, s(fd, "reason")), "Deal rejected.", lead(id));
}

export async function inviteAction(_: FormState, fd: FormData): Promise<FormState> {
  return run((u) => inviteEmployee(u, { name: s(fd, "name"), email: s(fd, "email"), role: s(fd, "role"), managerId: s(fd, "managerId") || undefined, target: num(fd, "target") }), "Invited. They get an email to create their account.", ["/crm/employees"]);
}

export async function employeeAction(userId: string, patch: { active?: boolean; role?: string; managerId?: string | null; target?: number; salary?: number | null; incentive?: number }): Promise<FormState> {
  return run((u) => updateEmployee(u, userId, patch), "Saved.", ["/crm/employees"]);
}

export async function campaignAction(id: string | null, _: FormState, fd: FormData): Promise<FormState> {
  return run((u) => saveCampaign(u, id, { name: s(fd, "name"), source: s(fd, "source"), spend: num(fd, "spend") }), "Saved.", ["/crm/campaigns", "/crm"]);
}

export async function readAllAction() {
  const u = await requireCrm();
  await markAllRead(u);
  revalidatePath("/crm/notifications");
  revalidatePath("/crm");
}

export async function importPreview(text: string, mapping: Partial<Record<ImportField, number>>) {
  const u = await requireCrm();
  try {
    const r = await previewImport(u, text, mapping);
    return { ok: true as const, ...r };
  } catch (e) {
    return { ok: false as const, message: e instanceof Error ? e.message : "Couldn't read the file." };
  }
}

export async function importCommit(text: string, mapping: Partial<Record<ImportField, number>>, campaignId: string) {
  const u = await requireCrm();
  try {
    const r = await commitImport(u, text, mapping, campaignId || undefined);
    revalidatePath("/crm/leads");
    revalidatePath("/crm");
    return { ok: true as const, ...r };
  } catch (e) {
    return { ok: false as const, message: e instanceof Error ? e.message : "Couldn't import." };
  }
}

export async function crmLogout() {
  await destroySession();
  redirect("/login");
}

export async function saveProfileAction(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requireCrm(undefined, { setup: true });
  const g = (k: string) => (typeof fd.get(k) === "string" ? (fd.get(k) as string) : "");
  let first = false;
  const r = await simpleAction(async () => {
    first = (await saveProfile(u, { fullName: g("fullName"), phone: g("phone"), address: g("address"), city: g("city"), state: g("state"), pin: g("pin"), payMethod: g("payMethod") === "upi" ? "upi" : "bank", accName: g("accName"), bankName: g("bankName"), accNo: g("accNo").replace(/\s/g, ""), accNo2: g("accNo2").replace(/\s/g, ""), ifsc: g("ifsc"), upi: g("upi"), upiName: g("upiName"), agree: g("agree") === "on" })).firstTime;
  }, "Profile saved.");
  if (!r?.ok) return { ...r, values: Object.fromEntries([...fd].filter(([k, v]) => typeof v === "string" && !/accNo|password/i.test(k))) as Record<string, string> };
  revalidatePath("/crm", "layout");
  if (first) redirect("/crm");
  return r;
}

export async function savePhotoAction(fd: FormData): Promise<FormState> {
  const u = await requireCrm(undefined, { setup: true });
  const file = fd.get("photo");
  const r = await simpleAction(() => setCrmPhoto(u, file as File), "Profile photo updated.");
  revalidatePath("/crm", "layout");
  return r;
}

export async function removePhotoAction(): Promise<FormState> {
  const u = await requireCrm(undefined, { setup: true });
  const r = await simpleAction(() => removeCrmPhoto(u), "Photo removed.");
  revalidatePath("/crm", "layout");
  return r;
}
