// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeTransfer } from "./drag-testing";
import {
  clearDragItem, currentDragItem, docDragItem, dragEndPoint, dragItemTarget, endedOutside, hasDragFiles, hasDragItem, ITEM_DRAG_TYPE, linkDragItem,
  mentionTextFor, parseDragItem, peekDragItem, readDragItem, setHostDragHelpers, tabDragItem, threadDragItem, writeDragItem, type DragItem,
} from "./item-drag";

const PAGE = "pg_0123456789abcdef";
const BOARD = "drw_0123456789abcdef";
const PAGE_PATH = `/plugins/studio/studio/pages/${PAGE}`;

afterEach(() => { clearDragItem(); setHostDragHelpers({}); });

describe("the payload", () => {
  it("is a thread, a document or a tab, each with the address that opens it", () => {
    expect(threadDragItem({ id: "thr_1", title: "Fix login" })).toEqual({ kind: "thread", id: "thr_1", title: "Fix login", path: "/threads/thr_1" });
    expect(threadDragItem({ id: "a b", title: " " })).toEqual({ kind: "thread", id: "a b", title: "Thread", path: "/threads/a%20b" });
    expect(docDragItem({ id: PAGE, title: "Plan" })).toEqual({ kind: "doc", id: PAGE, title: "Plan", pluginId: "studio", path: PAGE_PATH });
    // The caller's own address wins; an id of no known type has none.
    expect(docDragItem({ id: PAGE, title: "Plan", href: "/plugins/pages/pages/x" }).path).toBe("/plugins/pages/pages/x");
    expect(docDragItem({ id: "mystery", title: "" })).toEqual({ kind: "doc", id: "mystery", title: "Untitled", pluginId: "studio" });
  });

  it("a workbench tab carries BB's description of it", () => {
    const tab = { pluginId: "studio", tabId: "thread", params: { threadId: "thr_1" }, threadId: "thr_host" };
    const workbench = tabDragItem({ key: "k1", title: "Fix login", tab });
    expect(workbench).toEqual({ kind: "tab", id: "k1", title: "Fix login", pluginId: "studio", path: "/threads/thr_1", tab });
  });

  it("drops anything malformed that arrives from outside", () => {
    expect(parseDragItem(null)).toBeNull();
    expect(parseDragItem({ kind: "folder", id: "x", title: "" })).toBeNull();
    expect(parseDragItem({ kind: "thread", id: "", title: "" })).toBeNull();
    expect(parseDragItem({ kind: "doc", id: "x", title: 5, path: "//evil.example", pluginId: 3, tab: { pluginId: "p" } })).toEqual({ kind: "doc", id: "x", title: "" });
    expect(parseDragItem({ kind: "tab", id: "k", title: "T", path: "/threads/t", tab: { pluginId: "p", tabId: "t", params: [1], threadId: "" }, extra: 1 }))
      .toEqual({ kind: "tab", id: "k", title: "T", path: "/threads/t", tab: { pluginId: "p", tabId: "t", params: undefined, threadId: null } });
  });
});

describe("writing and reading a drag", () => {
  it("writes the payload, and the item's address as a link and as text for other apps", () => {
    const data = fakeTransfer();
    const item = threadDragItem({ id: "thr_1", title: "Fix login" });
    writeDragItem(data, item);
    expect(JSON.parse(data.getData(ITEM_DRAG_TYPE))).toEqual(item);
    expect(data.getData("text/uri-list")).toBe(`${window.location.origin}/threads/thr_1`);
    expect(data.getData("text/plain")).toBe(`${window.location.origin}/threads/thr_1`);
    expect(hasDragItem(data)).toBe(true);
    expect(readDragItem(data)).toEqual(item);
  });

  it("an item with no address travels with its title as the text", () => {
    const data = fakeTransfer();
    writeDragItem(data, { kind: "doc", id: "mystery", title: "Odd one" });
    expect(data.getData("text/plain")).toBe("Odd one");
    expect(data.getData("text/uri-list")).toBe("");
  });

  it("knows a drag with no item, and one with files", () => {
    const text = fakeTransfer();
    text.setData("text/plain", "hello");
    expect(hasDragItem(text)).toBe(false);
    expect(readDragItem(text)).toBeNull();
    expect(peekDragItem(text)).toBeNull();
    expect(hasDragFiles(fakeTransfer([new File(["x"], "a.txt")]))).toBe(true);
    expect(hasDragFiles(text)).toBe(false);
    expect(hasDragItem(null)).toBe(false);
    const broken = fakeTransfer();
    broken.setData(ITEM_DRAG_TYPE, "{not json");
    expect(readDragItem(broken)).toBeNull();
  });

  it("remembers this window's drag for dragover, where a browser hides the data, until the drag ends", () => {
    const item = docDragItem({ id: PAGE, title: "Plan" });
    writeDragItem(fakeTransfer(), item);
    expect(currentDragItem()).toEqual(item);
    // During dragover only the types can be read.
    const protectedData = { types: [ITEM_DRAG_TYPE], getData: () => "" } as unknown as DataTransfer;
    expect(peekDragItem(protectedData)).toEqual(item);
    window.dispatchEvent(new Event("dragend"));
    expect(currentDragItem()).toBeNull();
    // Another window's drag: nothing to peek at until it drops.
    expect(peekDragItem(protectedData)).toBeNull();
  });

  it("uses BB's helpers where it has them, and still adds the link", () => {
    const item = threadDragItem({ id: "thr_1", title: "Fix login" });
    const write = vi.fn((data: DataTransfer, value: DragItem) => data.setData(ITEM_DRAG_TYPE, JSON.stringify({ ...value, title: "from BB" })));
    const read = vi.fn((data: DataTransfer) => JSON.parse(data.getData(ITEM_DRAG_TYPE)) as unknown);
    setHostDragHelpers({ write, read });
    const data = fakeTransfer();
    writeDragItem(data, item);
    expect(write).toHaveBeenCalledWith(data, item);
    expect(data.getData("text/uri-list")).toContain("/threads/thr_1");
    expect(readDragItem(data)?.title).toBe("from BB");
    expect(read).toHaveBeenCalled();
  });

  it("writes the payload itself when BB's helper fails or writes nothing, and reads it when BB's reader does", () => {
    setHostDragHelpers({ write: () => { throw new Error("no"); }, read: () => { throw new Error("no"); } });
    const data = fakeTransfer();
    const item = threadDragItem({ id: "thr_1", title: "Fix login" });
    writeDragItem(data, item);
    expect(readDragItem(data)).toEqual(item);
  });
});

describe("what an item opens as", () => {
  const tab = (tabId: string, params: Record<string, unknown> | undefined, pluginId = "studio"): DragItem => ({ kind: "tab", id: "k", title: "T", tab: { pluginId, tabId, params, threadId: null } });
  it("a thread is its thread, a Studio document its item, a tab what it shows; a file and the unknown are nothing", () => {
    expect(dragItemTarget(threadDragItem({ id: "thr_1" }))).toEqual({ kind: "thread", id: "thr_1" });
    expect(dragItemTarget(docDragItem({ id: PAGE }))).toEqual({ kind: "item", id: PAGE });
    expect(dragItemTarget({ kind: "doc", id: PAGE, title: "", pluginId: "other" })).toBeNull();
    expect(dragItemTarget({ kind: "doc", id: "mystery", title: "", pluginId: "studio" })).toBeNull();
    expect(dragItemTarget({ kind: "tab", id: "main:item:x", title: "" })).toBeNull();
    // A workbench tab: the thread or item it shows.
    expect(dragItemTarget(tab("studio", { kind: "drawing", id: BOARD }))).toEqual({ kind: "item", id: BOARD });
    expect(dragItemTarget(tab("thread", { threadId: "thr_1" }))).toEqual({ kind: "thread", id: "thr_1" });
    expect(dragItemTarget(tab("studio", { kind: "page", id: PAGE }))).toEqual({ kind: "item", id: PAGE });
    expect(dragItemTarget(tab("bot", { botId: "b" }))).toBeNull();
    expect(dragItemTarget(tab("thread", { threadId: "thr_1" }, "git"))).toBeNull();
    expect(dragItemTarget(tab("studio", undefined))).toBeNull();
    expect(dragItemTarget({ kind: "file", id: "/tmp/a.txt", title: "a.txt" })).toBeNull();
  });

  it("is mentioned in a composer as the link Studio puts in a new thread's prompt", () => {
    expect(mentionTextFor(threadDragItem({ id: "thr_1", title: "Fix [login]" }))).toBe("[Fix login](/threads/thr_1) ");
    expect(mentionTextFor(docDragItem({ id: PAGE, title: "Plan" }))).toBe(`[Plan](${PAGE_PATH}) `);
    expect(mentionTextFor({ ...tab("studio", { kind: "page", id: PAGE }), title: "" })).toBe(`[Untitled](${PAGE_PATH}) `);
    expect(mentionTextFor(tab("thread", { threadId: "thr_1" }))).toBe("[T](/threads/thr_1) ");
    expect(mentionTextFor({ kind: "file", id: "/tmp/a.txt", title: "a.txt" })).toBeNull();
    expect(mentionTextFor(tab("bot", {}))).toBeNull();
  });

  it("a link or a card is the thread or the document at its address", () => {
    expect(linkDragItem({ href: "/threads/thr_1", title: "Fix login" })).toEqual(threadDragItem({ id: "thr_1", title: "Fix login" }));
    expect(linkDragItem({ href: "/projects/p1/threads/thr_1" })?.id).toBe("thr_1");
    expect(linkDragItem({ href: PAGE_PATH, title: "Plan" })).toEqual({ kind: "doc", id: PAGE, title: "Plan", pluginId: "studio", path: PAGE_PATH });
    expect(linkDragItem({ href: "/settings" })).toBeNull();
    expect(linkDragItem({ href: "https://example.com/threads/thr_1" })).toBeNull();
  });
});

describe("a drag that ends outside the window", () => {
  const viewport = { width: 1000, height: 700 };
  it("pops out only when it ended at least 40px outside", () => {
    expect(endedOutside({ x: 500, y: 300 }, viewport)).toBe(false);
    expect(endedOutside({ x: -10, y: 300 }, viewport)).toBe(false);
    expect(endedOutside({ x: 1039, y: 300 }, viewport)).toBe(false);
    expect(endedOutside({ x: -40, y: 300 }, viewport)).toBe(true);
    expect(endedOutside({ x: 1040, y: 300 }, viewport)).toBe(true);
    expect(endedOutside({ x: 500, y: -41 }, viewport)).toBe(true);
    expect(endedOutside({ x: 500, y: 741 }, viewport)).toBe(true);
    expect(endedOutside({ x: -10, y: 300 }, viewport, 5)).toBe(true);
  });
  it("reads where it ended from the screen position when the shell gives no client position", () => {
    expect(dragEndPoint({ clientX: 30, clientY: 40, screenX: 900, screenY: 900 }, { screenX: 100, screenY: 50 })).toEqual({ x: 30, y: 40 });
    expect(dragEndPoint({ clientX: 0, clientY: 0, screenX: 1500, screenY: 400 }, { screenX: 100, screenY: 50 })).toEqual({ x: 1400, y: 350 });
    expect(dragEndPoint({ clientX: 0, clientY: 0, screenX: 0, screenY: 0 }, { screenX: 100, screenY: 50 })).toEqual({ x: 0, y: 0 });
  });
});

it("carries BB's open spec on a side panel tab through a parse, and drops it from anything but a tab", () => {
  const open = { kind: "tab", tab: { id: "page", pluginId: "studio" }, params: { page: "p1" }, title: "Plan" };
  const tab = parseDragItem({ kind: "tab", id: "k", title: "Plan", pluginId: "studio", tab: { pluginId: "studio", tabId: "page", params: { page: "p1" }, threadId: "thr_1" }, open });
  expect(tab?.open).toEqual(open);
  expect(parseDragItem({ kind: "thread", id: "thr_1", title: "T", open })?.open).toBeUndefined();
  expect(parseDragItem({ kind: "tab", id: "k", title: "Terminal" })).toEqual({ kind: "tab", id: "k", title: "Terminal" });
});
