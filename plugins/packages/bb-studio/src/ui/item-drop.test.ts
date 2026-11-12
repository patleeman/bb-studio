// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { docDragItem, refDragItem, threadDragItem, type DragItem } from "../kit/app/item-drag";
import { TAB_KIND_REGISTRY, type TabKindId } from "../tab-kinds";
import { keepsOpened } from "./opened-tabs";
import { openStudioTab, pageWorkbenchKey, type OpenDeps } from "./tab-open";
import { canDropItem, dropItem, hostDragHelpers, registerItemDrops } from "./item-drop";

const PAGE = "pg_0123456789abcdef";
const workbenchTab = (threadId: string | null): DragItem => ({ kind: "tab", id: "k", title: "Fix login", tab: { pluginId: "studio", tabId: "thread", params: { threadId: "thr_1" }, threadId } });

it("takes threads, Studio documents and Studio's workbench tabs on BB's composer, main view and workbench; never files", () => {
  const composer = { zone: "composer" as const, threadId: "thr_9", insertText: () => true };
  expect(canDropItem(threadDragItem({ id: "thr_1" }), composer)).toBe(true);
  expect(canDropItem(docDragItem({ id: PAGE }), { zone: "main" })).toBe(true);
  expect(canDropItem({ kind: "file", id: "/tmp/a", title: "a" }, { zone: "main" })).toBe(false);
  expect(canDropItem({ kind: "doc", id: "x", title: "", pluginId: "other" }, composer)).toBe(false);
  // Not the conversation the workbench is beside, and not a tab already in that workbench.
  expect(canDropItem(threadDragItem({ id: "thr_9" }), { zone: "workbench", threadId: "thr_9" })).toBe(false);
  expect(canDropItem(docDragItem({ id: PAGE }), { zone: "workbench", threadId: "thr_9" })).toBe(true);
  expect(canDropItem(workbenchTab("thr_9"), { zone: "workbench", threadId: "thr_9" })).toBe(false);
});

it("mentions on a composer and opens in the main view", async () => {
  const insertText = vi.fn(() => true);
  await dropItem(docDragItem({ id: PAGE, title: "Plan" }), { zone: "composer", threadId: null, insertText });
  expect(insertText).toHaveBeenCalledWith(`[Plan](/plugins/studio/studio/pages/${PAGE}) `);
  const open = vi.fn();
  await dropItem(threadDragItem({ id: "thr_1" }), { zone: "main" }, open);
  expect(open).toHaveBeenCalledWith("/threads/thr_1");
});

it("drops a pill where BB has the fork's mention calls: its own for a thread, Studio's for an item", async () => {
  const insertText = vi.fn(() => true);
  const insertThreadMention = vi.fn(() => true);
  const insertMention = vi.fn(() => true);
  const composer = { zone: "composer" as const, threadId: null, insertText, insertThreadMention, insertMention };
  await dropItem(threadDragItem({ id: "thr_1", title: "Fix login" }), composer);
  expect(insertThreadMention).toHaveBeenCalledWith({ id: "thr_1", title: "Fix login" });
  await dropItem(docDragItem({ id: PAGE, title: "Plan" }), composer);
  expect(insertMention).toHaveBeenCalledWith({ provider: "page", id: PAGE, label: "Plan" });
  expect(insertText).not.toHaveBeenCalled();
  // A pill BB refuses falls back to the link.
  insertMention.mockReturnValueOnce(false);
  await dropItem(docDragItem({ id: PAGE, title: "Plan" }), composer);
  expect(insertText).toHaveBeenCalledWith(`[Plan](/plugins/studio/studio/pages/${PAGE}) `);
});

it("lends BB's own drag helpers where it has them, and registers nothing on a BB without the drop slot", () => {
  const write = () => {};
  expect(Object.keys(hostDragHelpers({ experimental_writeDragItem: write }))).toEqual(["write"]);
  expect(registerItemDrops({})).toBe(false);
  const slot = vi.fn();
  expect(registerItemDrops({ experimental_itemDrop: slot })).toBe(true);
  expect(slot.mock.calls[0]![0]).toMatchObject({ id: "studio-items" });
});

const recordingDeps = (opened: unknown[], workbench = true): OpenDeps => ({
  workbench: (threadId) => (workbench ? { open: async (spec, options) => { opened.push([threadId, spec, options]); return "k1"; } } : null),
  requestThreadTab: async (threadId, open) => { opened.push(["request", threadId, open]); return true; },
  requestPageTab: async (open) => { opened.push(["page", open]); return true; },
  requestPluginTab: async (open, place) => { opened.push(["plugin", open.tabId, place]); return "kb"; },
  noteOpened: (ref) => { if (keepsOpened(ref.kind)) opened.push(["noted", ref.kind]); },
});

describe("drops on the workbench's panes", () => {
  it("opens at the place in the pane's tab strip BB says the drop landed", async () => {
    const opened: unknown[] = [];
    await dropItem(threadDragItem({ id: "thr_1", title: "Fix login" }), { zone: "workbench", threadId: "thr_9", pane: 2, index: 1 }, undefined, recordingDeps(opened));
    expect(opened).toEqual([["thr_9", { kind: "tab", tab: { id: "thread" }, params: { threadId: "thr_1" }, title: "Fix login" }, { focus: true, pane: 2, index: 1 }]]);
  });

  it("makes the second pane for a drop on the workbench's right edge", async () => {
    const opened: unknown[] = [];
    await dropItem(refDragItem({ kind: "memory", id: "bot_main" }, "Memory")!, { zone: "workbench", threadId: "thr_9", pane: "new" }, undefined, recordingDeps(opened));
    expect(opened).toEqual([["thr_9", { kind: "tab", tab: { id: "memory" }, params: { botId: "bot_main" }, title: "Memory" }, { focus: true, pane: "new" }], ["noted", "memory"]]);
  });

  it("opens a board as Visual Chat's tab, asking Visual Chat where BB declines another plugin's tab, and the thread's own panel where BB has no workbench API", async () => {
    const opened: unknown[] = [];
    const board = refDragItem({ kind: "board", id: "thr_b" }, "Election night")!;
    await dropItem(board, { zone: "workbench", threadId: "thr_9", pane: 2 }, undefined, recordingDeps(opened));
    expect(opened).toEqual([["thr_9", { kind: "tab", tab: { id: "board", pluginId: "studio-visual-chat" }, params: { threadId: "thr_b" }, title: "Election night" }, { focus: true, pane: 2 }]]);
    opened.length = 0;
    const declining: OpenDeps = { ...recordingDeps(opened), workbench: () => ({ open: async (_spec, options) => { opened.push(["declined", options]); return null; } }) };
    await dropItem(board, { zone: "workbench", threadId: "thr_9", pane: 2 }, undefined, declining);
    expect(opened).toEqual([["declined", { focus: true, pane: 2 }], ["declined", { focus: true }], ["plugin", "board", { threadId: "thr_9", pane: 2 }]]);
    opened.length = 0;
    await dropItem(docDragItem({ id: PAGE, title: "Plan" }), { zone: "workbench", threadId: "thr_9", pane: 1, index: 0 }, undefined, recordingDeps(opened, false));
    expect(opened).toEqual([["request", "thr_9", { actionId: "studio", title: "Plan", params: { kind: "page", id: PAGE } }]]);
  });

  it("places a tab in a pane beside a Studio page through the page's workbench, and opens it the page's way without one or when it declines", async () => {
    const open = { pluginId: "studio", tabId: "todo", params: { id: "loop_1" }, title: "Call the bank" };
    const spec = { kind: "tab", tab: { id: "todo" }, params: { id: "loop_1" }, title: "Call the bank" };
    const opened: unknown[] = [];
    const page = (key: string | null): OpenDeps => ({ ...recordingDeps(opened, false), pageWorkbench: () => ({ open: async (asked, options) => { opened.push(["pageWorkbench", asked, options]); return key; } }) });
    expect(await openStudioTab(open, { threadId: null, pane: "new" }, page("k2"))).toBe(true);
    expect(opened).toEqual([["pageWorkbench", spec, { focus: true, pane: "new" }]]);
    opened.length = 0;
    expect(await openStudioTab(open, { threadId: null, pane: 2 }, page(null))).toBe(true);
    expect(opened).toEqual([["pageWorkbench", spec, { focus: true, pane: 2 }], ["page", { tabId: "todo", params: { id: "loop_1" }, title: "Call the bank" }]]);
    opened.length = 0;
    expect(await openStudioTab(open, { threadId: null }, page("k2"))).toBe(true);
    expect(opened).toEqual([["page", { tabId: "todo", params: { id: "loop_1" }, title: "Call the bank" }]]);
    expect(pageWorkbenchKey("/plugins/studio/studio/bot/bot_main/loops")).toBe("page:studio/studio");
    expect(pageWorkbenchKey("/plugins/studio/automations")).toBe("page:studio/automations");
    expect(pageWorkbenchKey("/threads/thr_1")).toBeNull();
  });

  it("takes every kind a sidebar or Library row drags, and never a tab of that very workbench", () => {
    const samples: Partial<Record<TabKindId, string | null>> = { conversation: "thr_1", worker: "thr_2", bot: "bot_main", page: PAGE, whiteboard: "drw_0123456789abcdef", design: "dsn_0123456789abcdef", app: "mini_0123456789abcdef", dashboard: "dsh_0123456789abcdef", artifact: "art_0123456789abcdef", memory: "bot_main", library: null, automations: null, todos: "bot_main", archive: "bot_main", automation: "bot_main:aut_1", todo: "loop_1", record: "mem_1" };
    for (const entry of TAB_KIND_REGISTRY.filter((each) => each.surfaces.sidebarDrag === "had" || each.surfaces.sidebarDrag === "added")) {
      const item = refDragItem({ kind: entry.id, id: samples[entry.id] ?? null }, entry.name);
      expect(item && canDropItem(item, { zone: "workbench", threadId: "thr_9", pane: 1, index: 0 }), entry.id).toBe(true);
    }
    expect(canDropItem(workbenchTab("thr_9"), { zone: "workbench", threadId: "thr_9", pane: "new" })).toBe(false);
  });

  it("mentions a Bot page by its address in the composer, and opens it in the main view without closing any tab", async () => {
    const insertText = vi.fn(() => true);
    await dropItem(refDragItem({ kind: "archive", id: "bot_main" }, "Archive")!, { zone: "composer", threadId: null, insertText });
    expect(insertText).toHaveBeenCalledWith("[Archive](/plugins/studio/studio/conversations/bot_main) ");
    const open = vi.fn();
    await dropItem(refDragItem({ kind: "automations", id: null }, "Automations")!, { zone: "main" }, open);
    expect(open).toHaveBeenCalledWith("/plugins/studio/automations");
  });
});

describe("drops into a popped-out window's panel", () => {
  it("opens through the target's own open where BB gives one, so Studio needs no navigator in that window", async () => {
    const opened: unknown[] = [];
    const open = vi.fn(async (spec: unknown, options: object) => { opened.push([spec, options]); return "k1"; });
    await dropItem(threadDragItem({ id: "thr_1", title: "Fix login" }), { zone: "workbench", threadId: "thr_9", pane: 1, index: 2, open }, undefined, recordingDeps([], false));
    expect(opened).toEqual([[{ kind: "tab", tab: { id: "thread" }, params: { threadId: "thr_1" }, title: "Fix login" }, { focus: true, pane: 1, index: 2 }]]);
    const other: unknown[] = [];
    await dropItem(refDragItem({ kind: "memory", id: "bot_main" }, "Memory")!, { zone: "workbench", threadId: "thr_9", open: async (spec, options) => { other.push([spec, options]); return "k2"; } });
    expect(other).toEqual([[{ kind: "tab", tab: { id: "memory" }, params: { botId: "bot_main" }, title: "Memory" }, { focus: true }]]);
  });

  it("leaves BB's own tabs to BB: a tab item with an open spec and no Studio tab is refused everywhere", () => {
    const file: DragItem = { kind: "tab", id: "file-k", title: "app.ts", open: { kind: "file", target: { kind: "workspace", environmentId: "env_1", path: "src/app.ts" } } };
    expect(canDropItem(file, { zone: "workbench", threadId: "thr_9", pane: 1, index: 0 })).toBe(false);
    expect(canDropItem(file, { zone: "composer", threadId: null, insertText: () => true })).toBe(false);
    expect(canDropItem(file, { zone: "main" })).toBe(false);
  });
});
