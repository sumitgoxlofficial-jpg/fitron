import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import { claude, type Block, type Msg } from "@/lib/integrations/anthropic";
import { runTool, TOOL_DEFS } from "./ai-tools";
import { UserError } from "./errors";
import { getSetting } from "./settings";
import { getAiSettings } from "./ai-settings";
import { sendCampaign } from "./whatsapp";
import { audit } from "./audit";
import { getTax } from "./tax";
import { auditConfirm, DRAFT_PERMISSIONS, executeDraft, type Executed } from "./ai-actions";
import { accountingSystem } from "@/lib/domain/ai-knowledge";
import { TOOL_LABEL } from "@/lib/domain/ai-labels";
import { canUsePermission } from "@/lib/domain/features";
import { CONFIRM_LABEL, draftExpired, isDraftKind, type DraftKind } from "@/lib/domain/ai-drafts";
import { todayIso } from "./time";

/** A draft for the user to confirm: a WhatsApp message (members, body = the text) or an accounting action (body = the preview). */
export type ProposalEvent = { type: "proposal"; id: string; kind: string; summary: string; members: number; body: string; confirm: string };
export type ChatEvent = { type: "tool"; name: string } | { type: "text"; text: string } | ProposalEvent | { type: "error"; message: string } | { type: "done" };

export const proposalEvent = (p: { id: string; kind: string; summary: string; memberIds: string[]; body: string }): ProposalEvent => ({
  type: "proposal",
  id: p.id,
  kind: p.kind,
  summary: p.summary,
  members: p.memberIds.length,
  body: p.body,
  confirm: isDraftKind(p.kind) ? CONFIRM_LABEL[p.kind] : p.summary.replace(/^(\w)/, (c) => c.toUpperCase()),
});

export const toolLabel = (n: string) => TOOL_LABEL[n] ?? n;

async function systemPrompt(u: CurrentUser) {
  const gym = (await getSetting<{ name?: string }>(u.orgId, "gym"))?.name ?? u.orgName;
  const [{ autoWinback }, tax] = await Promise.all([getAiSettings(u.orgId), getTax(u.orgId)]);
  const branch = u.branch === "ALL" ? "all branches" : (u.branches.find((b) => b.id === u.branch)?.name ?? "");
  return accountingSystem({ gym, user: u.name, role: u.role, branch, today: todayIso(), autoWinback, gst: tax });
}

/** One chat turn: calls Claude, runs the tools it asks for (up to 8 rounds), and reports progress. */
export async function* chat(u: CurrentUser, history: Msg[]): AsyncGenerator<ChatEvent> {
  const system = await systemPrompt(u);
  const messages: Msg[] = history.slice(-20);
  for (let round = 0; round < 8; round++) {
    const res = await claude({ system, messages, tools: TOOL_DEFS });
    const text = res.content.filter((b): b is Extract<Block, { type: "text" }> => b.type === "text").map((b) => b.text).join("");
    if (text) yield { type: "text", text };
    const uses = res.content.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !uses.length) {
      yield { type: "done" };
      return;
    }
    messages.push({ role: "assistant", content: res.content });
    const results: Block[] = [];
    for (const t of uses) {
      yield { type: "tool", name: t.name };
      let out: unknown;
      try {
        out = await runTool(u, t.name, t.input ?? {});
      } catch (e) {
        out = { error: e instanceof UserError ? e.message : "The tool failed." };
      }
      if (out && typeof out === "object" && "proposal_id" in out) {
        const p = await db.aiProposal.findUniqueOrThrow({ where: { id: String((out as { proposal_id: string }).proposal_id) } });
        yield proposalEvent(p);
      }
      results.push({ type: "tool_result", tool_use_id: t.id, content: JSON.stringify(out).slice(0, 30_000), is_error: !!(out && typeof out === "object" && "error" in out) });
    }
    messages.push({ role: "user", content: results });
  }
  yield { type: "text", text: "That needed more steps than I can take in one go. Try a narrower question." };
  yield { type: "done" };
}

/** Staff pressed Send on a WhatsApp suggestion: send it under their own name, through the normal WhatsApp path. */
async function confirmWhatsApp(u: CurrentUser, p: { id: string; memberIds: string[]; body: string; summary: string }) {
  if (!u.can("whatsapp.send")) throw new UserError("Your role can't send WhatsApp messages.");
  // Claim it first so a double-click can't send twice.
  const claimed = await db.aiProposal.updateMany({ where: { id: p.id, status: "PENDING" }, data: { status: "DONE", doneAt: new Date() } });
  if (!claimed.count) throw new UserError("Already handled.");
  const r = await sendCampaign(u, p.memberIds, p.body);
  const result = `${r.sent} sent${r.failed ? `, ${r.failed} failed` : ""}`;
  await db.aiProposal.update({ where: { id: p.id }, data: { result } });
  await db.$transaction((tx) => audit(tx, { orgId: u.orgId, userId: u.id, action: "ai.proposal.send", entity: "AiProposal", entityId: p.id, after: { summary: p.summary, result } }));
  return r;
}

/**
 * Staff pressed Confirm on an accounting draft. It runs as them, through the same service function the page uses, so
 * their role, the plan, locked months and the audit log all apply. Drafts go stale after two hours.
 */
async function confirmDraft(u: CurrentUser, p: { id: string; kind: DraftKind; summary: string; createdAt: Date; payload: unknown }): Promise<Executed> {
  if (draftExpired(p.createdAt)) {
    await db.aiProposal.updateMany({ where: { id: p.id, status: "PENDING" }, data: { status: "DISMISSED", doneAt: new Date() } });
    throw new UserError("This draft is over two hours old and the figures may have changed. Ask me to prepare it again.");
  }
  if (!DRAFT_PERMISSIONS[p.kind].every((perm) => canUsePermission(u, perm))) throw new UserError("Your role can't do this.");
  // Claim it first so a double-click can't book it twice.
  const claimed = await db.aiProposal.updateMany({ where: { id: p.id, status: "PENDING" }, data: { status: "DONE", doneAt: new Date() } });
  if (!claimed.count) throw new UserError("Already handled.");
  let done: Executed;
  try {
    done = await executeDraft(u, p.kind, (p.payload ?? {}) as Parameters<typeof executeDraft>[2]);
  } catch (e) {
    // Nothing was booked (the service runs in one transaction): let the user fix the cause and press Confirm again.
    await db.aiProposal.updateMany({ where: { id: p.id }, data: { status: "PENDING", doneAt: null } });
    throw e;
  }
  await db.aiProposal.update({ where: { id: p.id }, data: { result: done.message } });
  await auditConfirm(u, p, done.message);
  return done;
}

export type Confirmed = { kind: "WHATSAPP"; sent: number; failed: number } | ({ kind: "ACTION" } & Executed);

export async function confirmProposal(u: CurrentUser, id: string): Promise<Confirmed> {
  const p = await db.aiProposal.findFirst({ where: { id, orgId: u.orgId, userId: u.id } });
  if (!p) throw new UserError("Suggestion not found.");
  if (p.status !== "PENDING") throw new UserError("Already handled.");
  if (isDraftKind(p.kind)) return { kind: "ACTION", ...(await confirmDraft(u, { ...p, kind: p.kind })) };
  const r = await confirmWhatsApp(u, p);
  return { kind: "WHATSAPP", sent: r.sent, failed: r.failed };
}

export async function dismissProposal(u: CurrentUser, id: string) {
  await db.aiProposal.updateMany({ where: { id, orgId: u.orgId, userId: u.id, status: "PENDING" }, data: { status: "DISMISSED", doneAt: new Date() } });
}
