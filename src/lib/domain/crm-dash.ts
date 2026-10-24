// The dashboard's widgets and a person's layout of them: which are shown and in what order. Pure, so the page and the
// server action agree on what a saved layout means, and a layout from the browser is cleaned before it is kept.

import type { CrmRole } from "./crm";

export type Widget = "kpis" | "target" | "tasks" | "activity" | "trend" | "stages" | "people" | "products" | "sources" | "campaigns" | "geo" | "ageing";

export const WIDGET_LABEL: Record<Widget, string> = {
  kpis: "Key figures",
  target: "Monthly target",
  tasks: "Follow-ups to clear",
  activity: "Recent activity",
  trend: "Pipeline & revenue",
  stages: "Leads by stage",
  people: "Employee performance",
  products: "By product",
  sources: "By source",
  campaigns: "Campaigns",
  geo: "Where leads come from",
  ageing: "Open leads by age",
};

/** What each role's dashboard can show, in the default order. */
export const ROLE_WIDGETS: Record<CrmRole, Widget[]> = {
  admin: ["kpis", "trend", "tasks", "activity", "stages", "people", "products", "sources", "campaigns", "geo", "ageing"],
  marketing: ["kpis", "trend", "campaigns", "sources", "geo", "ageing", "stages", "activity"],
  manager: ["kpis", "target", "trend", "tasks", "activity", "stages", "people", "products", "sources"],
  sales: ["kpis", "target", "tasks", "trend", "activity"],
};

export type Layout = { order: Widget[]; hidden: Widget[]; mode: "tiles" | "focus" };

export const defaultLayout = (role: CrmRole): Layout => ({ order: [...ROLE_WIDGETS[role]], hidden: [], mode: "tiles" });

/** A saved layout, cleaned: only widgets this role has, each once, anything new appended, so a role change or a new widget never breaks it. */
export function normaliseLayout(role: CrmRole, raw: unknown): Layout {
  const all = ROLE_WIDGETS[role];
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof Layout, unknown>>;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is Widget => typeof x === "string" && (all as string[]).includes(x)) : []);
  const order = [...new Set(list(r.order))];
  for (const w of all) if (!order.includes(w)) order.push(w);
  const hidden = [...new Set(list(r.hidden))].filter((w) => w !== "kpis");
  return { order, hidden, mode: r.mode === "focus" ? "focus" : "tiles" };
}

/** Moves a widget one place up or down among the visible ones' order. */
export function move(order: Widget[], w: Widget, dir: -1 | 1): Widget[] {
  const i = order.indexOf(w);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return order;
  const out = [...order];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

export const visible = (l: Layout) => l.order.filter((w) => !l.hidden.includes(w));
