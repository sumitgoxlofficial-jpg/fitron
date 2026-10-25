import "@/lib/zod-config";
import { z } from "zod";
import { DISPOSITIONS } from "./constants";
import { TOPICS } from "./knowledge";

// The agent's tools. Every one is a server call that checks who is asking, validates what it was given and writes to the CRM
// itself; the model never touches the database. call_id and call_token are bound to the call's dynamic variables in the
// ElevenLabs agent (docs/AI_CALLING.md), so the model does not choose them.

const ctx = { call_id: z.string().min(1).max(64), call_token: z.string().min(32).max(128) };
const text = (n: number) => z.string().trim().min(1).max(n);

export const TOOL_SCHEMAS = {
  get_gym_details: z.object({ ...ctx }),
  get_fitron_product_information: z.object({ ...ctx, topic: z.enum(TOPICS) }),
  get_current_offer: z.object({ ...ctx }),
  save_call_disposition: z.object({ ...ctx, disposition: z.enum(DISPOSITIONS), summary: text(600), follow_up_date: z.iso.date().optional() }),
  schedule_demo: z.object({ ...ctx, slot_start: z.iso.datetime({ offset: true }), attendee_name: text(80).optional(), note: text(300).optional() }),
  request_human_followup: z.object({ ...ctx, reason: text(300), preferred_time: text(100).optional() }),
  record_opt_out: z.object({ ...ctx, reason: text(200).optional() }),
  end_call: z.object({ ...ctx, reason: text(200) }),
} as const;
export type ToolName = keyof typeof TOOL_SCHEMAS;
export const TOOL_NAMES = Object.keys(TOOL_SCHEMAS) as ToolName[];
export const isToolName = (v: string): v is ToolName => (TOOL_NAMES as string[]).includes(v);

/** For the setup page: each tool with the words the model reads. The model is given no call_id/call_token parameters; those are bound from dynamic variables. */
export const TOOL_HELP: Record<ToolName, string> = {
  get_gym_details: "Get the name, city and contact name of the gym being called. Use it if you are unsure who you are speaking to.",
  get_fitron_product_information: "Get approved facts about FITRON for a topic (overview, features, plans, trial, demo). Say only what it returns. If it returns nothing for the question, say the team will confirm.",
  get_current_offer: "Get the current introductory offer and the exact prices. Never quote a price or offer from memory.",
  save_call_disposition: "Record how the call ended: the disposition and a short factual summary of what the owner said. Call it once, near the end of every conversation.",
  schedule_demo: "Book a demo at the time the owner chose (ISO 8601 with +05:30). Tell the owner it is booked only if this returns booked:true; otherwise offer the alternatives it returns.",
  request_human_followup: "Ask for a FITRON salesperson to call the owner back, when they ask for a person or have a question you cannot answer.",
  record_opt_out: "Record that the owner does not want to be called again. Use it as soon as they say so, then apologise and end the call.",
  end_call: "Record why you are ending the call. Then use the end-call action to hang up.",
};

/** JSON Schema for one tool's parameters (without the bound ids), for the ElevenLabs tool definition. */
export function toolParamsJson(name: ToolName): unknown {
  const j = z.toJSONSchema(TOOL_SCHEMAS[name], { target: "draft-7" }) as { properties?: Record<string, unknown>; required?: string[] };
  const props = Object.fromEntries(Object.entries(j.properties ?? {}).filter(([k]) => k !== "call_id" && k !== "call_token"));
  return { type: "object", properties: props, required: (j.required ?? []).filter((k) => k !== "call_id" && k !== "call_token") };
}
