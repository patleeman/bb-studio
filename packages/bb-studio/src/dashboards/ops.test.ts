import { describe, expect, it } from "vitest";
import { applyOps, compact, firstFit, placeAt } from "./ops";
import { EMPTY_LAYOUTS, LIMITS, normalizeSource, type DashboardDoc } from "./shared";

let n = 0;
const ctx = { newId: () => `w${++n}`, hasType: (id: string) => id === "wt_known" };
const empty: DashboardDoc = { widgets: [], layouts: EMPTY_LAYOUTS };

describe("layout", () => {
  it("fills a row before starting the next", () => {
    expect(firstFit([{ i: "a", x: 0, y: 0, w: 3, h: 2 }], 3, 2, 12)).toEqual({ x: 3, y: 0 });
    expect(firstFit([{ i: "a", x: 0, y: 0, w: 12, h: 2 }], 3, 2, 12)).toEqual({ x: 0, y: 2 });
  });

  it("compacts upward and pushes what a moved item lands on", () => {
    expect(compact([{ i: "a", x: 0, y: 5, w: 2, h: 2 }])).toEqual([{ i: "a", x: 0, y: 0, w: 2, h: 2 }]);
    const layout = placeAt([{ i: "a", x: 0, y: 0, w: 4, h: 2 }, { i: "b", x: 0, y: 2, w: 4, h: 2 }], { i: "b", x: 0, y: 0, w: 4, h: 2 }, 12);
    expect(layout.find((item) => item.i === "b")).toMatchObject({ y: 0 });
    expect(layout.find((item) => item.i === "a")).toMatchObject({ y: 2 });
  });
});

describe("ops", () => {
  it("adds widgets side by side on every breakpoint", () => {
    const { doc, results } = applyOps(empty, [
      { op: "add", type: "stat", title: "Revenue", source: { kind: "static", data: 12 } },
      { op: "add", type: "stat", title: "Users" },
      { op: "add", type: "line" },
    ], ctx);
    expect(doc.widgets.map((widget) => widget.type)).toEqual(["stat", "stat", "line"]);
    expect(doc.layouts.lg.map(({ x, y, w }) => [x, y, w])).toEqual([[0, 0, 3], [3, 0, 3], [6, 0, 6]]);
    expect(doc.layouts.md).toHaveLength(3);
    expect(doc.layouts.sm.every((item) => item.x + item.w <= 4)).toBe(true);
    expect(doc.widgets[1]!.source).toEqual({ kind: "push" });
    expect(results[0]).toMatch(/Added stat widget w\d+ "Revenue" at 0,0/);
  });

  it("moves, resizes, updates and removes", () => {
    const base = applyOps(empty, [{ op: "add", type: "note", options: { markdown: "hi", keep: 1 } }, { op: "add", type: "clock" }], ctx).doc;
    const [note, clock] = base.widgets;
    let { doc } = applyOps(base, [{ op: "move", widgetId: clock!.id, x: 0, y: 0 }], ctx);
    expect(doc.layouts.lg.find((item) => item.i === clock!.id)).toMatchObject({ x: 0, y: 0 });
    expect(doc.widgets[0]!.id).toBe(clock!.id);
    ({ doc } = applyOps(doc, [{ op: "resize", widgetId: note!.id, w: 12, h: 2 }], ctx));
    expect(doc.layouts.lg.find((item) => item.i === note!.id)).toMatchObject({ w: 12, h: 2 });
    ({ doc } = applyOps(doc, [{ op: "update", widgetId: note!.id, title: "Hello", options: { markdown: "bye", keep: null } }], ctx));
    expect(doc.widgets.find((widget) => widget.id === note!.id)).toMatchObject({ title: "Hello", options: { markdown: "bye" } });
    ({ doc } = applyOps(doc, [{ op: "remove", widgetId: clock!.id }], ctx));
    expect(doc.widgets.map((widget) => widget.id)).toEqual([note!.id]);
    expect(doc.layouts.lg).toEqual([{ i: note!.id, x: 0, y: 0, w: 12, h: 2 }]);
  });

  it("applies all ops or none, naming the one that failed", () => {
    const base = applyOps(empty, [{ op: "add", type: "note" }], ctx).doc;
    expect(() => applyOps(base, [{ op: "remove", widgetId: base.widgets[0]!.id }, { op: "remove", widgetId: "nope" }], ctx)).toThrow(/Op 2: no widget nope/);
    expect(base.widgets).toHaveLength(1);
  });

  it("checks custom widgets, sizes and the widget limit", () => {
    expect(() => applyOps(empty, [{ op: "add", type: "custom" }], ctx)).toThrow(/customType .* or html/);
    expect(() => applyOps(empty, [{ op: "add", type: "custom", customType: "wt_missing" }], ctx)).toThrow(/widget_define/);
    expect(applyOps(empty, [{ op: "add", type: "custom", customType: "wt_known" }], ctx).doc.widgets).toHaveLength(1);
    expect(() => applyOps(empty, [{ op: "add", type: "note", options: { markdown: "x".repeat(LIMITS.optionsBytes) } }], ctx)).toThrow(/Options are over/);
    expect(() => applyOps(empty, [{ op: "add", type: "custom", html: "x".repeat(LIMITS.htmlBytes + 1) }], ctx)).toThrow(/HTML is over/);
    const full = applyOps(empty, Array.from({ length: LIMITS.widgets }, () => ({ op: "add" as const, type: "clock" as const })), ctx).doc;
    expect(() => applyOps(full, [{ op: "add", type: "clock" }], ctx)).toThrow(/at most 60 widgets/);
  });

  it("reports source changes so their cached data is dropped", () => {
    const base = applyOps(empty, [{ op: "add", type: "stat", source: { kind: "push" } }], ctx).doc;
    const id = base.widgets[0]!.id;
    expect(applyOps(base, [{ op: "update", widgetId: id, title: "x" }], ctx).sourceChanged).toEqual([]);
    expect(applyOps(base, [{ op: "update", widgetId: id, source: { kind: "url", url: "https://example.com/x.json" } }], ctx).sourceChanged).toEqual([id]);
  });
});

describe("sources", () => {
  it("enforces refresh floors and http(s) URLs", () => {
    expect(normalizeSource({ kind: "url", url: "https://example.com", intervalSec: 5 })).toMatchObject({ intervalSec: 60 });
    expect(normalizeSource({ kind: "script", command: "echo 1", intervalSec: 60 })).toMatchObject({ intervalSec: 300 });
    expect(() => normalizeSource({ kind: "url", url: "file:///etc/passwd" })).toThrow(/http or https/);
    expect(() => normalizeSource({ kind: "url", url: "https://user:pw@example.com" })).toThrow(/http or https/);
    expect(() => normalizeSource({ kind: "script", command: "  " })).toThrow(/needs a command/);
    expect(() => normalizeSource({ kind: "static", data: "x".repeat(LIMITS.staticBytes) })).toThrow(/Static data is over/);
  });
});
