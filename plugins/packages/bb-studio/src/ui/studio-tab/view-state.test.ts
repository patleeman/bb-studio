// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TAB_KINDS, enabledKinds } from "./model";
import { applyScroll, elementAt, elementPath, forgetView, loadView, onViewForgotten, saveView, validTarget, VIEW_LIMIT, VIEW_STORAGE_KEY, viewKey } from "./view-state";

beforeEach(() => localStorage.clear());

describe("Studio tab view state", () => {
  it("keys an instance by thread and params", () => {
    expect(viewKey("thr_1", null)).toBe("thr_1|null");
    expect(viewKey("thr_1", undefined)).toBe("thr_1|null");
    expect(viewKey("thr_1", { kind: "page", id: "pg_1" })).toBe('thr_1|{"kind":"page","id":"pg_1"}');
  });

  it.each([
    [{ view: "list" }],
    [{ view: "save", seq: 3 }],
    [{ view: "save", seq: null }],
    [{ view: "item", kind: "page", id: "pg_1" }],
    [{ view: "item", kind: "artifact", id: "art_0123456789abcdef" }],
    [{ view: "item", kind: "design", id: "dsn_0123456789abcdef" }],
    [{ view: "item", kind: "mini", id: "mini_0123456789abcdef" }],
    [{ view: "item", kind: "drawing", id: "drw_0123456789abcdef" }],
    [{ view: "item", kind: "recording", id: "rec_aaaaaaaa" }],
  ] as const)("saves and restores %j", (target) => {
    saveView("thr_1|null", { target, filter: "pages:page", scroll: { path: [0, 2], top: 120 } }, 5);
    expect(loadView("thr_1|null", TAB_KINDS)).toEqual({ target, filter: "pages:page", scroll: { path: [0, 2], top: 120 }, at: 5 });
  });

  it("restores nothing it can't show", () => {
    expect(validTarget({ view: "item", kind: "page", id: "dsn_0123456789abcdef" }, TAB_KINDS)).toBeNull();
    expect(validTarget({ view: "item", kind: "notion", id: "x" }, TAB_KINDS)).toBeNull();
    expect(validTarget({ view: "save", seq: 1 }, enabledKinds(new Set(["artifact"])))).toBeNull();
    expect(validTarget({ view: "item", kind: "page", id: "pg_1" }, enabledKinds(new Set(["page"])))).toBeNull();
    expect(validTarget("list", TAB_KINDS)).toBeNull();
    localStorage.setItem(VIEW_STORAGE_KEY, "not json");
    expect(loadView("thr_1|null", TAB_KINDS)).toBeNull();
    localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify({ "thr_1|null": { target: { view: "list" }, filter: 4, scroll: { path: [-1], top: 3 }, at: 1 } }));
    expect(loadView("thr_1|null", TAB_KINDS)).toEqual({ target: { view: "list" }, filter: null, scroll: null, at: 1 });
  });

  it("keeps the most recent instances", () => {
    for (let index = 0; index < VIEW_LIMIT + 5; index++) saveView(`thr_${index}|null`, { target: { view: "list" }, filter: null, scroll: null }, index);
    const kept = Object.keys(JSON.parse(localStorage.getItem(VIEW_STORAGE_KEY)!));
    expect(kept).toHaveLength(VIEW_LIMIT);
    expect(kept).not.toContain("thr_0|null");
    expect(kept).toContain(`thr_${VIEW_LIMIT + 4}|null`);
  });

  it("forgets every instance opened with the params, and tells the mounted ones", () => {
    const card = { kind: "page", id: "pg_1" };
    const view = { target: { view: "list" } as const, filter: null, scroll: null };
    saveView(viewKey("thr_1", card), view);
    saveView(viewKey("thr_2", card), view);
    saveView(viewKey("thr_1", null), view);
    const listener = vi.fn();
    const stop = onViewForgotten(viewKey("thr_1", card), listener);
    forgetView(card);
    expect(loadView(viewKey("thr_1", card), TAB_KINDS)).toBeNull();
    expect(loadView(viewKey("thr_2", card), TAB_KINDS)).toBeNull();
    expect(loadView(viewKey("thr_1", null), TAB_KINDS)).not.toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    forgetView(card);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("finds a scrolled element again by its path", () => {
    const root = document.createElement("div");
    root.innerHTML = "<header></header><main><p></p><section></section></main>";
    const section = root.querySelector("section")!;
    expect(elementPath(root, section)).toEqual([1, 1]);
    expect(elementAt(root, [1, 1])).toBe(section);
    expect(elementAt(root, [3])).toBeNull();
    expect(elementPath(root, document.createElement("div"))).toBeNull();
  });

  it("scrolls back only once the content is tall enough", () => {
    const root = document.createElement("div");
    const pane = document.createElement("div");
    root.append(pane);
    let height = 50;
    let top = 0;
    Object.defineProperties(pane, {
      scrollHeight: { get: () => height },
      clientHeight: { get: () => 100 },
      scrollTop: { get: () => top, set: (value: number) => { top = Math.min(value, Math.max(0, height - 100)); } },
    });
    expect(applyScroll(root, { path: [0], top: 300 })).toBe(false);
    expect(top).toBe(0);
    height = 800;
    expect(applyScroll(root, { path: [0], top: 300 })).toBe(true);
    expect(top).toBe(300);
    expect(applyScroll(root, { path: [4], top: 300 })).toBe(false);
  });
});
