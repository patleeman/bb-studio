import { expect, it } from "vitest";
import { registerPaletteSearch, registerSidebarSection } from "../kit/app/host-sdk";
import { paletteRows } from "./palette-search";

const hit = (over: Partial<Parameters<typeof paletteRows>[0][number]>) => ({ ref: { pluginId: "pages", id: "pg_1" }, kind: "page", title: "Launch plan", snippet: { text: "Ship  on\nFriday" }, href: "/plugins/studio/studio/pages/pg_1", ...over });

it("lists items with their kind and snippet, and leaves threads to BB", () => {
  expect(paletteRows([hit({}), hit({ kind: "thread", ref: { pluginId: "bb", id: "thr_1" }, href: "/threads/thr_1" }), hit({ ref: { pluginId: "draw", id: "d_1" }, kind: "drawing", title: "", snippet: { text: "" }, href: "/plugins/studio/studio/drawings/d_1" })])).toEqual([
    { id: "pages:pg_1", title: "Launch plan", subtitle: "Page · Ship on Friday", path: "/plugins/studio/studio/pages/pg_1", icon: "FileText", experimental_onModSelect: expect.any(Function), experimental_modSelectLabel: "Open in workbench" },
    { id: "draw:d_1", title: "Untitled", subtitle: "Drawing", path: "/plugins/studio/studio/drawings/d_1", icon: "Edit", experimental_onModSelect: expect.any(Function), experimental_modSelectLabel: "Open in workbench" },
  ]);
});

it("registers only on a BB that has the palette slot", () => {
  const registered: unknown[] = [];
  const registration = { id: "items", title: "Studio", search: async () => [] };
  expect(registerPaletteSearch({ navPanel() {} }, registration)).toBe(false);
  expect(registerPaletteSearch({ experimental_paletteSearch: (value: unknown) => { registered.push(value); } }, registration)).toBe(true);
  expect(registered).toEqual([registration]);
});

it("adds a sidebar section only on a BB that has the section slot", () => {
  const registered: unknown[] = [];
  const registration = { id: "bots", title: "Bots", component: () => null };
  expect(registerSidebarSection({ experimental_threadList() {} }, registration)).toBe(false);
  expect(registerSidebarSection({ experimental_sidebarSection: (value: unknown) => { registered.push(value); } }, registration)).toBe(true);
  expect(registered).toEqual([registration]);
});
