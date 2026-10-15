import { describe, expect, it } from "vitest";
import { aliasParams, collectionKinds, enabledKinds, itemOpening, tabSections, tabTarget, TAB_KINDS, type ListedItem } from "./model";

const DESIGN = "dsn_0123456789abcdef";
const DASHBOARD = "dsh_0123456789abcdef";
const DRAWING = "drw_0123456789abcdef";
const ARTIFACT = "art_0123456789abcdef";

describe("Studio tab params", () => {
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

  it("still reads the old tabs' params", () => {
    expect(tabTarget({ pageId: "pg_1" })).toEqual({ view: "item", kind: "page", id: "pg_1" });
    expect(tabTarget({ designId: DESIGN })).toEqual({ view: "item", kind: "design", id: DESIGN });
    expect(tabTarget({ view: "save", seq: 4 })).toEqual({ view: "save", seq: 4 });
    expect(tabTarget({ view: "save", seq: -1 })).toEqual({ view: "save", seq: null });
  });
});

describe("old per-kind tab ids", () => {
  it("open the Studio tab on the item they had", () => {
    expect(aliasParams("page", { pageId: "pg_1" })).toEqual({ target: { view: "item", kind: "page", id: "pg_1" }, filter: null });
    expect(aliasParams("excalidraw", { drawingId: DRAWING })).toEqual({ target: { view: "item", kind: "drawing", id: DRAWING }, filter: null });
    expect(aliasParams("design", { designId: DESIGN })).toEqual({ target: { view: "item", kind: "design", id: DESIGN }, filter: null });
    expect(aliasParams("dashboards", { dashboardId: DASHBOARD })).toEqual({ target: { view: "item", kind: "dashboard", id: DASHBOARD }, filter: null });
    expect(aliasParams("save-to-studio", { artifactId: ARTIFACT })).toEqual({ target: { view: "item", kind: "artifact", id: ARTIFACT }, filter: null });
  });

  it("open the collection filtered to their kind without one", () => {
    expect(aliasParams("excalidraw", null)).toEqual({ target: { view: "list" }, filter: "excalidraw:drawing" });
    expect(aliasParams("dashboards", { dashboardId: "nope" })).toEqual({ target: { view: "list" }, filter: "dashboards:dashboard" });
  });

  it("keep the old Artifacts tab the save picker", () => {
    expect(aliasParams("save-to-studio", null)).toEqual({ target: { view: "save", seq: null }, filter: null });
    expect(aliasParams("save-to-studio", { seq: 3 })).toEqual({ target: { view: "save", seq: 3 }, filter: null });
  });

  it("cover every tab kind", () => {
    expect(TAB_KINDS.flatMap((each) => (each.legacyAction ? [each.legacyAction] : [])).sort()).toEqual(["dashboards", "design", "excalidraw", "page", "save-to-studio"]);
  });
});

const kind = (id: string, extra: Record<string, unknown> = {}) => ({ id, label: id, plural: `${id}s`, icon: "Box", create: null, ...extra });
const providers = [
  { pluginId: "pages", state: "ready", kinds: [kind("page", { create: { mode: "rpc" } })] },
  { pluginId: "talk", state: "ready", kinds: [kind("recording", { create: { mode: "event", event: "x" } }), kind("dictation", { background: true })] },
  { pluginId: "notion", state: "ready", kinds: [kind("notion-page", { create: { mode: "rpc" } })] },
  { pluginId: "gone", state: "offline", kinds: [kind("gone-thing")] },
];

describe("the collection", () => {
  const item = (pluginId: string, kind: string, id: string, updatedAt: number, extra: Partial<ListedItem> = {}): ListedItem => ({ pluginId, kind, id, title: `${kind} ${id}`, updatedAt, projectId: "prj_1", ...extra });
  const items = [
    item("pages", "page", "pg_1", 5),
    item("design", "design", DESIGN, 4),
    item("excalidraw", "drawing", DRAWING, 3),
    item("dashboards", "dashboard", DASHBOARD, 2, { projectId: "prj_other" }),
    item("artifacts", "artifact", ARTIFACT, 1, { archived: true }),
    item("someone", "page", "pg_x", 9),
    item("pages", "page", "pg_tpl", 9, { template: true }),
  ];
  const base = { kinds: collectionKinds(TAB_KINDS, []), filter: null, query: "", linked: new Set(["design:" + DESIGN]), projectId: "prj_1" };

  it("lists this thread's items, then recent ones in its project, across kinds", () => {
    const sections = tabSections(items, base);
    expect(sections.map((section) => [section.title, section.items.map((each) => each.id)])).toEqual([
      ["This thread", [DESIGN]],
      ["Recent", ["pg_1", DRAWING]],
    ]);
  });

  it("filters to one kind", () => {
    expect(tabSections(items, { ...base, filter: "excalidraw:drawing" }).flatMap((section) => section.items.map((each) => each.id))).toEqual([DRAWING]);
  });

  it("leaves out kinds that are off", () => {
    const sections = tabSections(items, { ...base, kinds: collectionKinds(enabledKinds(new Set(["design", "page"])), []) });
    expect(sections.flatMap((section) => section.items.map((each) => each.kind))).toEqual(["drawing"]);
  });

  it("searches every kind, in any project", () => {
    expect(tabSections(items, { ...base, query: "dashboard" })).toEqual([{ title: "Results", items: [items[3]] }]);
    expect(tabSections(items, { ...base, query: "dashboard", kinds: collectionKinds(enabledKinds(new Set(["dashboard"])), []) })).toEqual([{ title: "Results", items: [] }]);
  });

  describe("recordings", () => {
    const talk = [item("talk", "recording", "rec_aaaaaaaa", 8, { title: "Standup" }), item("talk", "dictation", "rec_bbbbbbbb", 7, { title: "Quick standup note" })];
    const kinds = collectionKinds(TAB_KINDS, providers);
    const ids = (sections: { items: ListedItem[] }[]) => sections.flatMap((section) => section.items.map((each) => each.id));

    it("lists recordings in All, but not dictations", () => {
      expect(ids(tabSections(talk, { ...base, kinds }))).toEqual(["rec_aaaaaaaa"]);
    });

    it("shows dictations under their own chip and in search", () => {
      expect(ids(tabSections(talk, { ...base, kinds, filter: "talk:dictation" }))).toEqual(["rec_bbbbbbbb"]);
      expect(ids(tabSections(talk, { ...base, kinds, filter: "talk:recording" }))).toEqual(["rec_aaaaaaaa"]);
      expect(ids(tabSections(talk, { ...base, kinds, query: "standup" }))).toEqual(["rec_aaaaaaaa", "rec_bbbbbbbb"]);
    });

    it("hides both when Recordings is off", () => {
      const off = collectionKinds(enabledKinds(new Set(["recording"])), providers);
      expect(off.map((each) => each.key)).not.toEqual(expect.arrayContaining(["talk:recording"]));
      expect(ids(tabSections(talk, { ...base, kinds: off, query: "standup" }))).toEqual([]);
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

    it("are listed, and open their page in the main area", () => {
      expect(tabSections([notion], { ...base, kinds }).flatMap((section) => section.items)).toEqual([notion]);
      expect(itemOpening(notion, kinds)).toEqual({ open: "page", href: "/plugins/notion/pages/np_1" });
    });

    it("don't take a built-in kind's items by reusing its id", () => {
      const clash = { ...item("notion", "page", "pg_n", 6), href: "/n" };
      expect(itemOpening(clash, kinds)).toBeNull();
      expect(tabSections([clash], { ...base, kinds })).toEqual([]);
    });
  });
});
