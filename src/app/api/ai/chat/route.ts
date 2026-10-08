import * as z from "zod";
import "@/lib/zod-config";
import { aiReady, type Block, type Msg } from "@/lib/integrations/anthropic";
import { chat, type ChatEvent, type ProposalEvent } from "@/lib/services/ai";
import { localChat } from "@/lib/services/ai-local";
import { rateLimit } from "@/lib/rate-limit";
import { log } from "@/lib/log";
import { UserError } from "@/lib/services/errors";
import { chatFor, saveTurn } from "@/lib/services/ai-chats";
import { AttachmentError, attachmentBlocks, kindOf } from "@/lib/files/read-attachment";
import { readCapped } from "../../trainer/_lib/http";
import { aiUser } from "../_lib/access";

// Fitron AI chat. Streams newline-delimited JSON events: the chat it is saved in, tool progress, text, proposals, done.
// A question can bring up to three files (PDF, photo, Excel, Word, CSV). They are read for this answer only and never
// stored; the chat keeps their names.
export const maxDuration = 120;

const MAX_FILES = 3;
/** Base64 characters across all files: about 3 MB of files, under the host's 4.5 MB request limit. */
const MAX_FILE_CHARS = 4_000_000;

const body = z.object({
  chatId: z.string().max(40).optional(),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().max(4000) }))
    .min(1)
    .max(20)
    .refine((m) => m[m.length - 1]!.role === "user", "The last message must be the user's."),
  attachments: z
    .array(z.object({ name: z.string().trim().min(1).max(200), type: z.string().max(120), data: z.string().min(1) }))
    .max(MAX_FILES)
    .default([])
    .refine((a) => a.reduce((n, f) => n + f.data.length, 0) <= MAX_FILE_CHARS, "too big"),
});

type StreamEvent = ChatEvent | { type: "chat"; id: string; title: string };

export async function POST(req: Request) {
  const u = await aiUser();
  if (u instanceof Response) return u;
  if (!rateLimit(`ai:${u.id}`, 15, 60_000)) return Response.json({ error: "That's a lot of questions in a minute. Wait a moment and try again." }, { status: 429 });
  const raw = await readCapped(req, 4_400_000);
  if (raw === null) return Response.json({ error: "Those files are too big together. Attach up to about 3 MB at a time." }, { status: 413 });
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {}
  const parsed = body.safeParse(json);
  if (!parsed.success) {
    const big = parsed.error.issues.some((i) => i.message === "too big");
    return Response.json({ error: big ? "Those files are too big together. Attach up to about 3 MB at a time." : "Bad request." }, { status: big ? 413 : 400 });
  }
  const { messages, attachments } = parsed.data;
  const question = messages.at(-1)!.content;
  if (!question && !attachments.length) return Response.json({ error: "Type a question or attach a file." }, { status: 400 });

  // The files, read now: a file that can't be read is said before anything is saved.
  let fileBlocks: Block[];
  let files: { name: string; kind: string }[];
  try {
    files = attachments.map((a) => ({ name: a.name, kind: kindOf(a) }));
    fileBlocks = attachments.flatMap(attachmentBlocks);
  } catch (e) {
    if (e instanceof AttachmentError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }

  let saved: { id: string; title: string };
  try {
    saved = await chatFor(u, parsed.data.chatId, question, files);
  } catch (e) {
    if (e instanceof UserError) return Response.json({ error: e.message }, { status: 404 });
    throw e;
  }
  await saveTurn(saved.id, { role: "user", content: question, attachments: files });

  // The model reads the files with the last question; earlier turns are the conversation's text.
  const asked = question || "Read the attached file and tell me what it shows for the gym's accounts.";
  const history: Msg[] = [
    ...messages.slice(0, -1).filter((m) => m.content),
    { role: "user", content: fileBlocks.length ? [...fileBlocks, { type: "text", text: asked }] : asked },
  ];

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (e: StreamEvent) => ctrl.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      const answer: string[] = [];
      const proposals: ProposalEvent[] = [];
      let error: string | undefined;
      send({ type: "chat", id: saved.id, title: saved.title });
      try {
        // Without a model key, answer from live data the way the prototype does offline (it can't read files).
        const events: AsyncIterable<ChatEvent> = aiReady()
          ? chat(u, history)
          : fileBlocks.length
            ? (async function* () {
                yield { type: "text", text: "Reading attached files needs Fitron AI's model, which isn't switched on for this gym yet." } as ChatEvent;
                yield { type: "done" } as ChatEvent;
              })()
            : localChat(u, asked);
        for await (const e of events) {
          if (e.type === "text") answer.push(e.text);
          if (e.type === "proposal") proposals.push(e);
          if (e.type === "error") error = e.message;
          send(e);
        }
      } catch (e) {
        log.error("ai_chat.failed", e);
        error = "Fitron AI couldn't answer just now. Try again in a minute.";
        send({ type: "error", message: error });
      }
      try {
        await saveTurn(saved.id, { role: "assistant", content: answer.join("\n\n"), proposals, error });
      } catch (e) {
        log.error("ai_chat.save_failed", e);
      }
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
