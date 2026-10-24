import { describe, expect, it } from "vitest";
import { ROLE_WIDGETS, defaultLayout, move, normaliseLayout, visible } from "./crm-dash";

describe("dashboard layout", () => {
  it("starts with every widget of the role, in order, in tiles", () => {
    expect(defaultLayout("sales")).toEqual({ order: ROLE_WIDGETS.sales, hidden: [], mode: "tiles" });
  });
  it("keeps only widgets the role has, once each, and appends any that are missing", () => {
    const l = normaliseLayout("sales", { order: ["activity", "people", "activity", "kpis", "bogus"], hidden: ["trend", "people", "kpis"], mode: "focus" });
    expect(l.order).toEqual(["activity", "kpis", "target", "tasks", "trend"]);
    expect(l.hidden).toEqual(["trend"]); // "people" isn't a sales widget; the key figures can't be hidden
    expect(l.mode).toBe("focus");
  });
  it("survives anything the browser sends", () => {
    for (const bad of [null, undefined, 5, "x", [], { order: "no", hidden: 3, mode: {} }]) expect(normaliseLayout("admin", bad)).toEqual(defaultLayout("admin"));
  });
  it("moves a widget one place and stops at the ends", () => {
    expect(move(["kpis", "trend", "tasks"], "tasks", -1)).toEqual(["kpis", "tasks", "trend"]);
    expect(move(["kpis", "trend", "tasks"], "kpis", -1)).toEqual(["kpis", "trend", "tasks"]);
    expect(move(["kpis", "trend", "tasks"], "tasks", 1)).toEqual(["kpis", "trend", "tasks"]);
  });
  it("lists what is shown", () => {
    expect(visible({ order: ["kpis", "trend", "tasks"], hidden: ["trend"], mode: "tiles" })).toEqual(["kpis", "tasks"]);
  });
});
