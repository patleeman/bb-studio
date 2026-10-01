import { afterEach, beforeEach, expect, it, vi } from "vitest";

// The registry lives on `window`; a bare object with event stubs stands in.
beforeEach(() => {
  vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } });
  vi.stubGlobal("Event", class { constructor(readonly type: string) {} });
});
afterEach(() => vi.unstubAllGlobals());

it("finds the panel with the longest matching prefix", async () => {
  const { floatPanelFor, registerFloatPanel } = await import("./float-registry");
  const unregister = registerFloatPanel({ pluginId: "pages", path: "pages" });
  registerFloatPanel({ pluginId: "pages", path: "pages/archive" });
  expect(floatPanelFor("/plugins/pages/pages")).toEqual({ pluginId: "pages", path: "pages", subPath: "" });
  expect(floatPanelFor("/plugins/pages/pages/pg_1%20x/")).toEqual({ pluginId: "pages", path: "pages", subPath: "pg_1 x" });
  expect(floatPanelFor("/plugins/pages/pages/archive/2")).toMatchObject({ path: "pages/archive", subPath: "2" });
  expect(floatPanelFor("/plugins/pages/pagesx")).toBeNull();
  expect(floatPanelFor("/plugins/draw/drawings/d_1")).toBeNull();
  unregister();
  expect(floatPanelFor("/plugins/pages/pages/pg_1")).toBeNull();
});
