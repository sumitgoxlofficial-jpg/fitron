import "server-only";
import { db } from "@/lib/db";
import { FINDER_SYSTEM, SELECTOR_SYSTEM, finderPrompt, parseFinderAnswer, parseSelection, selectorPrompt, type NumberCandidate } from "@/lib/domain/gym-intel/ai";
import { aiReady, anthropicMessages } from "@/lib/integrations/anthropic";
import { todayIso } from "../time";
import { politely } from "./fetch";

// Claude's part in Gym Intelligence. Two jobs only: find a gym's own website, and choose among numbers a real page printed.
// It cannot add a number: the finder returns an address that is then read like any site, and the chooser returns indexes.

/** One question to the model, with an optional tool list; returns the text it answered. Replaceable in tests. */
export type AiAsk = (req: { system: string; prompt: string; webSearch?: boolean; maxTokens?: number }) => Promise<{ text: string; searches?: string[] }>;

export const aiAvailable = () => aiReady();

export const askClaude: AiAsk = async ({ system, prompt, webSearch, maxTokens }) => {
  const res = await anthropicMessages({
    system,
    messages: [{ role: "user", content: prompt }],
    ...(webSearch ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2, user_location: { type: "approximate", country: "IN" } }] } : {}),
    maxTokens: maxTokens ?? 700,
    timeoutMs: 60_000,
  });
  const blocks = res.content as unknown as { type: string; text?: string; input?: { query?: string } }[];
  return { text: blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim(), searches: blocks.filter((b) => b.type === "server_tool_use").map((b) => b.input?.query ?? "").filter(Boolean) };
};

/** Takes one call from today's allowance (India day). False when the cap is spent: nothing is called. Safe if two workers ask at once. */
export async function takeAiBudget(cap: number, now = new Date()): Promise<boolean> {
  if (cap <= 0) return false;
  const day = todayIso(now);
  await db.giSource.upsert({ where: { key: "ai_assisted" }, create: { key: "ai_assisted" }, update: {} });
  const rows = await db.$queryRaw<{ ok: number }[]>`
    UPDATE "GiSource"
    SET "config" = jsonb_set(jsonb_set(coalesce("config", '{}'::jsonb), '{aiDay}', to_jsonb(${day}::text)), '{aiUsed}', to_jsonb(CASE WHEN "config"->>'aiDay' = ${day} THEN coalesce(("config"->>'aiUsed')::int, 0) + 1 ELSE 1 END))
    WHERE "key" = 'ai_assisted' AND (CASE WHEN "config"->>'aiDay' = ${day} THEN coalesce(("config"->>'aiUsed')::int, 0) ELSE 0 END) < ${cap}
    RETURNING 1 AS ok`;
  return rows.length > 0;
}

export const aiUsedToday = async (now = new Date()) => {
  const c = ((await db.giSource.findUnique({ where: { key: "ai_assisted" }, select: { config: true } }))?.config ?? {}) as { aiDay?: string; aiUsed?: number };
  return c.aiDay === todayIso(now) ? (c.aiUsed ?? 0) : 0;
};

/** Looks for a gym's own website. Returns the address and the search it came from, or null (also when the allowance is spent or the model is unsure). */
export async function findGymWebsite(g: { name: string; address?: string | null; city?: string | null; district?: string | null; state?: string | null; pin?: string | null }, o: { ask: AiAsk; cap: number; perMinute: number; now?: Date }) {
  if (!(await takeAiBudget(o.cap, o.now))) return { spent: true as const };
  await politely("anthropic", o.perMinute);
  const r = await o.ask({ system: FINDER_SYSTEM, prompt: finderPrompt(g), webSearch: true, maxTokens: 800 });
  const a = parseFinderAnswer(r.text);
  return { spent: false as const, url: a.url, reason: a.reason, searches: r.searches ?? [] };
}

/** Of the numbers a page printed, those Claude says are the gym's own. It can only choose from the list; if it fails or the allowance is spent, all are kept. */
export async function chooseGymNumbers(gym: string, candidates: NumberCandidate[], o: { ask: AiAsk; cap: number; perMinute: number; now?: Date }): Promise<NumberCandidate[]> {
  if (candidates.length < 2) return candidates;
  if (!(await takeAiBudget(o.cap, o.now))) return candidates;
  try {
    await politely("anthropic", o.perMinute);
    const r = await o.ask({ system: SELECTOR_SYSTEM, prompt: selectorPrompt(gym, candidates), maxTokens: 300 });
    return parseSelection(r.text, candidates.length).map((i) => candidates[i]!);
  } catch {
    return candidates;
  }
}
