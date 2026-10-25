import "server-only";
import type { z } from "zod";
import { db } from "@/lib/db";
import { type Disposition } from "@/lib/domain/ai-calling/constants";
import { demoSlotProblem, nextSlots } from "@/lib/domain/ai-calling/demo";
import { productInfo } from "@/lib/domain/ai-calling/knowledge";
import { currentOffer } from "@/lib/domain/ai-calling/offer";
import { hashToken, safeEqual } from "@/lib/domain/ai-calling/signature";
import { TOOL_SCHEMAS, isToolName, type ToolName } from "@/lib/domain/ai-calling/tools";
import { rateLimit } from "@/lib/rate-limit";
import { activeAdmins, notify, scrub } from "../crm-access";
import { AI_ACTOR, callAudit, getAcSettings } from "./core";
import { applyOutcome } from "./outcome";
import { addSuppression } from "./people";

// What the agent can do during a call. Each tool proves which call it belongs to (a key only that call was given), validates what
// the model sent, and does the one thing it is for. The result is exactly what the agent is told: it only reports a booking or a
// save as done when the answer here says so.

export type ToolReply = { status: number; body: Record<string, unknown> };
const reply = (status: number, body: Record<string, unknown>): ToolReply => ({ status, body });
const DEMO_CAPACITY = 2;
const clip = (s: string, n: number) => scrub(s).replace(/\s+/g, " ").trim().slice(0, n);
const ist = (d: Date) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(d);

export async function executeTool(name: string, raw: unknown, now = new Date()): Promise<ToolReply> {
  if (!isToolName(name)) return reply(404, { error: "unknown_tool" });
  const parsed = TOOL_SCHEMAS[name].safeParse(raw);
  if (!parsed.success) return reply(400, { error: "invalid_input", detail: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`) });
  const input = parsed.data as { call_id: string; call_token: string };
  if (!rateLimit(`ac-tool:${input.call_id}`, 60, 60_000)) return reply(429, { error: "too_many_requests" });

  const call = await db.acCall.findUnique({ where: { id: input.call_id } });
  // The same answer for "no such call" and "wrong key", so the key can't be probed
  if (!call || !safeEqual(call.tokenHash, hashToken(input.call_token))) return reply(401, { error: "unauthorised" });
  if (call.status !== "DIALING" && call.status !== "IN_PROGRESS") return reply(409, { error: "call_ended" });
  if (call.status === "DIALING") await db.acCall.updateMany({ where: { id: call.id, status: "DIALING" }, data: { status: "IN_PROGRESS" } });

  const lead = await db.crmLead.findUnique({ where: { id: call.leadId } });
  if (!lead) return reply(404, { error: "lead_missing" });
  const settings = await getAcSettings();
  const body = parsed.data as never;
  switch (name as ToolName) {
    case "get_gym_details":
      return reply(200, { gym_name: lead.gymName, contact_name: lead.contactName, city: lead.city, state: lead.state });
    case "get_fitron_product_information":
      return reply(200, { facts: productInfo((body as { topic: Parameters<typeof productInfo>[0] }).topic) });
    case "get_current_offer": {
      const o = currentOffer(settings.offer);
      return reply(200, { offer_active: o.active, statements: o.lines });
    }
    case "save_call_disposition": {
      const b = body as z.infer<(typeof TOOL_SCHEMAS)["save_call_disposition"]>;
      await db.$transaction(async (tx) => {
        const fresh = await tx.acCall.findUniqueOrThrow({ where: { id: call.id } });
        // A booked demo is not turned into something weaker by a later, vaguer answer
        const d: Disposition = fresh.disposition === "DEMO_BOOKED" || fresh.disposition === "DO_NOT_CONTACT" ? (fresh.disposition as Disposition) : b.disposition;
        const summary = clip(b.summary, 600);
        await tx.acCall.update({ where: { id: call.id }, data: { disposition: d, summary: fresh.summary && fresh.disposition === d ? fresh.summary : summary } });
        await applyOutcome(tx, lead, d, summary, { callId: call.id, followUpDate: b.follow_up_date, test: call.test });
      });
      return reply(200, { saved: true });
    }
    case "schedule_demo": {
      const b = body as z.infer<(typeof TOOL_SCHEMAS)["schedule_demo"]>;
      const slot = new Date(b.slot_start);
      const problem = demoSlotProblem(slot, settings, now);
      const full = await db.acDemo.groupBy({ by: ["slotAt"], where: { status: "BOOKED", slotAt: { gte: now } }, _count: true });
      const taken = full.filter((f) => f._count >= DEMO_CAPACITY).map((f) => f.slotAt);
      const offer = () => nextSlots(taken, settings, now).map((d) => ({ slot_start: d.toISOString(), say: ist(d) }));
      if (problem) return reply(200, { booked: false, reason: problem, available: offer() });
      const existing = await db.acDemo.findFirst({ where: { leadId: lead.id, status: "BOOKED", slotAt: { gte: now } } });
      if (existing) return existing.slotAt.getTime() === slot.getTime() ? reply(200, { booked: true, when: ist(existing.slotAt), already: true }) : reply(200, { booked: false, reason: `A demo is already booked for ${ist(existing.slotAt)}.` });
      if (taken.some((t) => t.getTime() === slot.getTime())) return reply(200, { booked: false, reason: "That time is taken.", available: offer() });
      try {
        await db.$transaction(async (tx) => {
          const count = await tx.acDemo.count({ where: { slotAt: slot, status: "BOOKED" } });
          if (count >= DEMO_CAPACITY) throw new Error("full");
          await tx.acDemo.create({ data: { leadId: lead.id, callId: call.id, slotAt: slot, note: b.note ? clip(b.note, 300) : null } });
          await tx.acCall.update({ where: { id: call.id }, data: { disposition: "DEMO_BOOKED" } });
          const summary = `Demo booked for ${ist(slot)}${b.attendee_name ? ` with ${clip(b.attendee_name, 80)}` : ""}.`;
          if (!call.test) {
            const who = lead.ownerId ?? (await activeAdmins(tx))[0];
            if (who) await tx.crmTask.create({ data: { leadId: lead.id, ownerId: who, type: "Demo", dueAt: slot, priority: "High" } });
            await notify(tx, lead.ownerId ? [lead.ownerId] : await activeAdmins(tx), `${lead.gymName}: demo booked by the AI caller for ${ist(slot)}.`, lead.id);
          }
          await applyOutcome(tx, lead, "DEMO_BOOKED", summary, { callId: call.id, test: call.test });
        });
      } catch (e) {
        if (e instanceof Error && e.message === "full") return reply(200, { booked: false, reason: "That time is taken.", available: offer() });
        throw e;
      }
      return reply(200, { booked: true, when: ist(slot) });
    }
    case "request_human_followup": {
      const b = body as z.infer<(typeof TOOL_SCHEMAS)["request_human_followup"]>;
      await db.$transaction(async (tx) => {
        const fresh = await tx.acCall.findUniqueOrThrow({ where: { id: call.id } });
        if (!fresh.disposition || fresh.disposition === "INTERESTED" || fresh.disposition === "FOLLOW_UP") await tx.acCall.update({ where: { id: call.id }, data: { disposition: "HUMAN_HANDOFF" } });
        await applyOutcome(tx, lead, "HUMAN_HANDOFF", `Owner wants a person to call${b.preferred_time ? ` (${clip(b.preferred_time, 100)})` : ""}: ${clip(b.reason, 300)}`, { callId: call.id, test: call.test });
      });
      return reply(200, { requested: true });
    }
    case "record_opt_out": {
      const b = body as z.infer<(typeof TOOL_SCHEMAS)["record_opt_out"]>;
      await addSuppression(call.phone, clip(b.reason ?? "Asked not to be called", 200), "call", AI_ACTOR, call.id);
      await db.$transaction(async (tx) => {
        await tx.acCall.update({ where: { id: call.id }, data: { disposition: "DO_NOT_CONTACT" } });
        await applyOutcome(tx, lead, "DO_NOT_CONTACT", `Asked not to be called again. ${b.reason ? clip(b.reason, 200) : ""}`, { callId: call.id, test: call.test });
      });
      return reply(200, { recorded: true });
    }
    case "end_call": {
      const b = body as z.infer<(typeof TOOL_SCHEMAS)["end_call"]>;
      await callAudit(db, AI_ACTOR, `Agent ended the call · ${clip(b.reason, 120)}`, { callId: call.id }, lead.id);
      return reply(200, { ok: true });
    }
  }
}

