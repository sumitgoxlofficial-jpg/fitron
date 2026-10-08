import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import type { Prisma } from "@/generated/prisma/client";
import { UserError } from "./errors";
import type { ProposalEvent } from "./ai";

// Fitron AI's saved conversations. Each belongs to the person who had it: nobody else in the gym sees or deletes it.
// Attached files are never kept here, only their names.

export type ChatAttachment = { name: string; kind: string };
export type SavedProposal = ProposalEvent & { status?: string; result?: string | null };
export type ChatTurn = { role: "user" | "assistant"; content: string; attachments?: ChatAttachment[]; proposals?: SavedProposal[]; error?: string };

const mine = (u: CurrentUser) => ({ orgId: u.orgId, userId: u.id });

/** A chat's title: the start of its first question, on one line. */
export const chatTitle = (question: string, files: ChatAttachment[] = []) => {
  const q = question.replace(/\s+/g, " ").trim();
  const t = q || (files.length ? `File: ${files.map((f) => f.name).join(", ")}` : "New chat");
  return t.length > 60 ? `${t.slice(0, 57).trimEnd()}…` : t;
};

/** The person's chats, newest first. */
export function listChats(u: CurrentUser, take = 50) {
  return db.aiChat.findMany({ where: mine(u), orderBy: { updatedAt: "desc" }, take, select: { id: true, title: true, updatedAt: true } });
}

/** One of the person's chats with its messages; drafts it offered carry their current state (pending, done, dismissed). */
export async function getChat(u: CurrentUser, id: string): Promise<{ id: string; title: string; turns: ChatTurn[] }> {
  const chat = await db.aiChat.findFirst({ where: { id, ...mine(u) }, include: { messages: { orderBy: { createdAt: "asc" } } } });
  if (!chat) throw new UserError("That chat was not found. It may have been deleted.");
  const ids = chat.messages.flatMap((m) => ((m.proposals as SavedProposal[] | null) ?? []).map((p) => p.id));
  const state = new Map((ids.length ? await db.aiProposal.findMany({ where: { id: { in: ids }, ...mine(u) }, select: { id: true, status: true, result: true } }) : []).map((p) => [p.id, p]));
  return {
    id: chat.id,
    title: chat.title,
    turns: chat.messages.map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
      attachments: (m.attachments as ChatAttachment[] | null) ?? undefined,
      proposals: ((m.proposals as SavedProposal[] | null) ?? []).map((p) => ({ ...p, status: state.get(p.id)?.status ?? "DISMISSED", result: state.get(p.id)?.result ?? null })),
      error: m.error ?? undefined,
    })),
  };
}

/** Deletes one of the person's chats and its messages. */
export async function deleteChat(u: CurrentUser, id: string) {
  const { count } = await db.aiChat.deleteMany({ where: { id, ...mine(u) } });
  if (!count) throw new UserError("That chat was not found. It may have been deleted already.");
}

/** The chat a question goes into: the given one if it is the person's, or a new one titled after the question. */
export async function chatFor(u: CurrentUser, id: string | undefined, question: string, files: ChatAttachment[]) {
  if (id) {
    const chat = await db.aiChat.findFirst({ where: { id, ...mine(u) }, select: { id: true, title: true } });
    if (!chat) throw new UserError("That chat was not found. It may have been deleted. Start a new one.");
    return chat;
  }
  return db.aiChat.create({ data: { ...mine(u), title: chatTitle(question, files) }, select: { id: true, title: true } });
}

/** Adds a message to a chat and moves the chat to the top of the history. */
export async function saveTurn(chatId: string, t: ChatTurn) {
  await db.$transaction([
    db.aiChatMessage.create({
      data: {
        chatId,
        role: t.role,
        content: t.content,
        attachments: t.attachments?.length ? (t.attachments as Prisma.InputJsonValue) : undefined,
        proposals: t.proposals?.length ? (t.proposals as unknown as Prisma.InputJsonValue) : undefined,
        error: t.error,
      },
    }),
    db.aiChat.update({ where: { id: chatId }, data: { updatedAt: new Date() } }),
  ]);
}
