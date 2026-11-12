import { describe, expect, it } from "vitest";
import { collectionKinds, enabledKinds, itemOpening, tabTarget, TAB_KINDS, type ListedItem } from "./model";

const DESIGN = "dsn_0123456789abcdef";
const DASHBOARD = "dsh_0123456789abcdef";
const DRAWING = "drw_0123456789abcdef";
const ARTIFACT = "art_0123456789abcdef";
describe("Studio tab params", () => {
  it("does not retain per-kind tab restoration metadata", () => {
    expect(TAB_KINDS.some((each) => "legacyAction" in each || "legacyParam" in each)).toBe(false);
    expect(tabTarget({ pageId: "pg_1" })).toEqual({ view: "list" });
  });

  it("routes { kind, id } to that kind's view", () => {
    expect(tabTarget({ kind: "page", id: "pg_1" })).toEqual({ view: "item", kind: "page", id: "pg_1" });
    expect(tabTarget({ kind: "design", id: DESIGN })).toEqual({ view: "item", kind: "design", id: DESIGN });
    expect(tabTarget({ kind: "dashboard", id: DASHBOARD })).toEqual({ view: "item", kind: "dashboard", id: DASHBOARD });
    expect(tabTarget({ kind: "drawing", id: DRAWING })).toEqual({ view: "item", kind: "drawing", id: DRAWING });
    expect(tabTarget({ kind: "artifact", id: ARTIFACT })).toEqual({ view: "item", kind: "artifact", id: ARTIFACT });
  });

  it("opens the collection for nothing, an unknown kind, or an id of another kind", () => {
    expect(tabTarget(null)).toEqual({ view: "list" });
    expect(tabTarget([1])).toEqual({ view: "list" });
    expect(tabTarget({ kind: "notion-page", id: "np_1" })).toEqual({ view: "list" });
    expect(tabTarget({ kind: "recording", id: "rec_1" })).toEqual({ view: "list" });
    expect(tabTarget({ kind: "design", id: DASHBOARD })).toEqual({ view: "list" });
  });

  it("routes recordings and dictations to the recording view, gated by Recordings", () => {
    expect(tabTarget({ kind: "recording", id: "rec_aaaaaaaa" })).toEqual({ view: "item", kind: "recording", id: "rec_aaaaaaaa" });
    expect(tabTarget({ kind: "dictation", id: "rec_bbbbbbbb" })).toEqual({ view: "item", kind: "dictation", id: "rec_bbbbbbbb" });
    const off = enabledKinds(new Set(["recording"]));
    expect(off.map((each) => each.kind)).not.toContain("dictation");
    expect(tabTarget({ kind: "dictation", id: "rec_bbbbbbbb" }, off)).toEqual({ view: "list" });
  });

  it("opens the collection for a kind that's off", () => {
    const enabled = enabledKinds(new Set(["design"]));
    expect(tabTarget({ kind: "design", id: DESIGN }, enabled)).toEqual({ view: "list" });
    expect(tabTarget({ view: "save" }, enabledKinds(new Set(["artifact"])))).toEqual({ view: "list" });
  });

  it("opens the save picker from Studio params", () => {
    expect(tabTarget({ view: "save", seq: 4 })).toEqual({ view: "save", seq: 4 });
    expect(tabTarget({ view: "save", seq: -1 })).toEqual({ view: "save", seq: null });
  });
});

const kind = (id: string, extra: Record<string, unknown> = {}) => ({ id, label: id, plural: `${id}s`, icon: "Box", create: null, ...extra });
const providers = [
  { pluginId: "pages", state: "ready", kinds: [kind("page", { create: { mode: "rpc" } })] },
  { pluginId: "talk", state: "ready", kinds: [kind("recording", { create: { mode: "event", event: "x" } }), kind("dictation", { background: true })] },
  { pluginId: "notion", state: "ready", kinds: [kind("notion-page", { create: { mode: "rpc" } })] },
  { pluginId: "gone", state: "offline", kinds: [kind("gone-thing")] },
];

describe("the collection's kinds", () => {
  const item = (pluginId: string, kind: string, id: string, updatedAt: number, extra: Partial<ListedItem> = {}): ListedItem => ({ pluginId, kind, id, title: `${kind} ${id}`, updatedAt, projectId: "prj_1", ...extra });
  describe("recordings", () => {
    const talk = [item("talk", "recording", "rec_aaaaaaaa", 8, { title: "Standup" }), item("talk", "dictation", "rec_bbbbbbbb", 7, { title: "Quick standup note" })];
    const kinds = collectionKinds(TAB_KINDS, providers);

    it("hides both when Recordings is off", () => {
      const off = collectionKinds(enabledKinds(new Set(["recording"])), providers);
      expect(off.map((each) => each.key)).not.toEqual(expect.arrayContaining(["talk:recording"]));
    });

    it("open in place, and aren't on the New menu", () => {
      expect(itemOpening({ ...talk[1]!, href: "/r" }, kinds)).toEqual({ open: "tab", kind: "dictation", id: "rec_bbbbbbbb" });
      expect(kinds.filter((each) => each.creatable).map((each) => each.key)).toEqual(["pages:page"]);
    });
  });

  describe("add-on kinds", () => {
    const kinds = collectionKinds(TAB_KINDS, providers);
    const notion = { ...item("notion", "notion-page", "np_1", 6), href: "/plugins/notion/pages/np_1" };

    it("get a chip each from ready providers, after Studio's kinds", () => {
      expect(kinds.map((each) => each.key).slice(-1)).toEqual(["notion:notion-page"]);
      expect(kinds.find((each) => each.key === "notion:notion-page")).toMatchObject({ plural: "notion-pages", tab: null, creatable: false });
      expect(kinds.some((each) => each.pluginId === "gone")).toBe(false);
    });

    it("open their page in the main area", () => {
      expect(itemOpening(notion, kinds)).toEqual({ open: "page", href: "/plugins/notion/pages/np_1" });
    });

    it("don't take a built-in kind's items by reusing its id", () => {
      const clash = { ...item("notion", "page", "pg_n", 6), href: "/n" };
      expect(itemOpening(clash, kinds)).toBeNull();
    });
  });
});
