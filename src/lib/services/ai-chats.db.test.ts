import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { hasDb, makeGym } from "@/test/db";
import { POST } from "@/app/api/ai/chat/route";
import { GET as listRoute } from "@/app/api/ai/chats/route";
import { DELETE as deleteRoute, GET as getRoute } from "@/app/api/ai/chats/[id]/route";
import { chatTitle, deleteChat, getChat, listChats, saveTurn, chatFor } from "./ai-chats";

const mockUser = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/auth/current", async (orig) => ({ ...(await orig<typeof import("@/lib/auth/current")>()), getCurrentUser: async () => mockUser.current }));

const ask = (body: unknown) => POST(new Request("http://localhost/api/ai/chat", { method: "POST", body: JSON.stringify(body) }));
const events = async (res: Response) =>
  (await res.text())
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { type: string; id?: string; text?: string; message?: string });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as RouteContext<"/api/ai/chats/[id]">;

describe.skipIf(!hasDb)("Fitron AI chat history (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  let owner: Awaited<ReturnType<Awaited<ReturnType<typeof makeGym>>["user"]>>;
  let other: typeof owner;

  beforeAll(async () => {
    gym = await makeGym();
    owner = await gym.user("Super Admin");
    other = await gym.user("Super Admin");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    mockUser.current = null;
  });

  it("titles a chat after its first question, or its files", () => {
    expect(chatTitle("  How much   is due\nthis month? ")).toBe("How much is due this month?");
    expect(chatTitle("", [{ name: "bill.pdf", kind: "pdf" }])).toBe("File: bill.pdf");
    expect(chatTitle("x".repeat(80))).toHaveLength(58);
  });

  it("keeps each person's chats to themselves, and deletes them", async () => {
    const c = await chatFor(owner, undefined, "Who owes fees?", []);
    await saveTurn(c.id, { role: "user", content: "Who owes fees?" });
    await saveTurn(c.id, { role: "assistant", content: "Asha owes ₹1,180.", proposals: [{ type: "proposal", id: "missing-proposal", kind: "expense", title: "Rent", lines: [] } as never] });
    expect((await listChats(owner)).map((x) => x.id)).toContain(c.id);
    expect((await listChats(other)).map((x) => x.id)).not.toContain(c.id);
    const got = await getChat(owner, c.id);
    expect(got.turns.map((t) => [t.role, t.content])).toEqual([
      ["user", "Who owes fees?"],
      ["assistant", "Asha owes ₹1,180."],
    ]);
    // A draft whose record is gone reads as dismissed, so it can't be confirmed from history.
    expect(got.turns[1]!.proposals![0]!.status).toBe("DISMISSED");
    await expect(getChat(other, c.id)).rejects.toThrow(/not found/);
    await expect(deleteChat(other, c.id)).rejects.toThrow(/not found/);
    await expect(chatFor(other, c.id, "x", [])).rejects.toThrow(/not found/);
    await deleteChat(owner, c.id);
    expect(await db.aiChatMessage.count({ where: { chatId: c.id } })).toBe(0);
    await expect(getChat(owner, c.id)).rejects.toThrow(/not found/);
  });

  it("the chat API saves both sides of the conversation into the chat it names", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    mockUser.current = owner;
    const first = await events(await ask({ messages: [{ role: "user", content: "How many members are active?" }] }));
    const id = first[0]!.id!;
    expect(first[0]).toMatchObject({ type: "chat", title: "How many members are active?" });
    expect(first.some((e) => e.type === "text")).toBe(true);
    const again = await events(await ask({ chatId: id, messages: [{ role: "user", content: "How many members are active?" }, { role: "assistant", content: "…" }, { role: "user", content: "And expired?" }] }));
    expect(again[0]).toMatchObject({ type: "chat", id });
    const saved = await getChat(owner, id);
    expect(saved.turns.map((t) => t.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(saved.turns[2]!.content).toBe("And expired?");

    const list = await listRoute();
    expect(((await list.json()) as { chats: { id: string }[] }).chats[0]!.id).toBe(id);
    expect((await getRoute(new Request("http://localhost"), ctx(id))).status).toBe(200);

    // Someone else can't read, add to or delete it.
    mockUser.current = other;
    expect((await getRoute(new Request("http://localhost"), ctx(id))).status).toBe(404);
    expect((await deleteRoute(new Request("http://localhost"), ctx(id))).status).toBe(404);
    expect((await ask({ chatId: id, messages: [{ role: "user", content: "hi" }] })).status).toBe(404);

    mockUser.current = owner;
    expect((await deleteRoute(new Request("http://localhost"), ctx(id))).status).toBe(200);
    expect((await getRoute(new Request("http://localhost"), ctx(id))).status).toBe(404);
  });

  it("sends attached files to the model with the question and keeps only their names", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    mockUser.current = owner;
    const sent: { messages: { role: string; content: unknown }[] }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        sent.push(JSON.parse(String(init.body)));
        return Response.json({ content: [{ type: "text", text: "The bill is for ₹4,500 of cleaning supplies." }], stop_reason: "end_turn" });
      }),
    );
    const out = await events(
      await ask({
        messages: [{ role: "user", content: "" }],
        attachments: [
          { name: "bill.pdf", type: "application/pdf", data: "JVBERi0=" },
          { name: "list.csv", type: "text/csv", data: Buffer.from("item,amount\nMops,4500").toString("base64") },
        ],
      }),
    );
    expect(out.find((e) => e.type === "text")?.text).toContain("₹4,500");
    const last = sent[0]!.messages.at(-1)!.content as { type: string; text?: string }[];
    expect(last.map((b) => b.type)).toEqual(["document", "text", "text"]);
    expect(last[1]!.text).toContain("Mops,4500");
    expect(last[2]!.text).toMatch(/Read the attached file/);

    const saved = await getChat(owner, out[0]!.id!);
    expect(saved.title).toBe("File: bill.pdf, list.csv");
    expect(saved.turns[0]!.attachments).toEqual([
      { name: "bill.pdf", kind: "pdf" },
      { name: "list.csv", kind: "text" },
    ]);
    const row = await db.aiChatMessage.findFirst({ where: { chatId: out[0]!.id! } });
    expect(JSON.stringify(row)).not.toContain("JVBERi0=");
  });

  it("refuses files it can't read, too many files, too much, and an empty question", async () => {
    mockUser.current = owner;
    const before = await db.aiChat.count({ where: { userId: owner.id } });
    let res = await ask({ messages: [{ role: "user", content: "read" }], attachments: [{ name: "old.xls", type: "", data: "AAAA" }] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/save it as \.xlsx/);
    res = await ask({ messages: [{ role: "user", content: "read" }], attachments: Array.from({ length: 4 }, (_, i) => ({ name: `${i}.pdf`, type: "application/pdf", data: "JVBERi0=" })) });
    expect(res.status).toBe(400);
    res = await ask({ messages: [{ role: "user", content: "read" }], attachments: [{ name: "big.pdf", type: "application/pdf", data: "A".repeat(4_100_000) }] });
    expect(res.status).toBe(413);
    res = await ask({ messages: [{ role: "user", content: "   " }] });
    expect(res.status).toBe(400);
    expect(await db.aiChat.count({ where: { userId: owner.id } })).toBe(before);
  });
});
