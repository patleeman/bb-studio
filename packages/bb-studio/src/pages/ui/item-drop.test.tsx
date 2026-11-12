// @vitest-environment jsdom
// An item dropped on a page's body: what it becomes, where it lands, and the
// bar that shows where.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchDrag, fakeTransfer } from "../../kit/app/drag-testing";
import { clearDragItem, docDragItem, tabDragItem, threadDragItem, writeDragItem, type DragItem } from "../../kit/app/item-drag";
import { blockAtY, insertDroppedItem, pageDropContent, usePageItemDrop, type PageDropEditor } from "./item-drop";

const PAGE = "pg_0123456789abcdef";
const BOARD = "drw_0123456789abcdef";

describe("what a dropped item becomes", () => {
  it("a thread and a page become mentions; a whiteboard becomes its embed card", () => {
    expect(pageDropContent(threadDragItem({ id: "thr_1", title: "Fix login" }))).toEqual({ type: "inline", content: [{ type: "mention", props: { kind: "thread", target: "thr_1", label: "Fix login" } }, " "] });
    expect(pageDropContent(docDragItem({ id: PAGE, title: "Plan" }))).toEqual({ type: "inline", content: [{ type: "mention", props: { kind: "page", target: PAGE, label: "Plan" } }, " "] });
    expect(pageDropContent(docDragItem({ id: BOARD, title: "Sketch" }))).toEqual({ type: "embed", props: { kind: "drawing", target: BOARD } });
    // A tab is what it shows.
    expect(pageDropContent(tabDragItem({ key: "t", title: "Fix login", tab: { pluginId: "studio", tabId: "thread", params: { threadId: "thr_1" }, threadId: null } }))?.type).toBe("inline");
    expect(pageDropContent(tabDragItem({ key: "k", title: "Sketch", tab: { pluginId: "studio", tabId: "studio", params: { kind: "drawing", id: BOARD }, threadId: null } }))).toEqual({ type: "embed", props: { kind: "drawing", target: BOARD } });
  });
  it("a file, and a tab that shows neither a thread nor an item, become nothing", () => {
    expect(pageDropContent({ kind: "file", id: "/tmp/a", title: "a" })).toBeNull();
    expect(pageDropContent({ kind: "tab", id: "k", title: "Terminal", tab: { pluginId: "bb", tabId: "terminal", params: undefined, threadId: "t" } })).toBeNull();
  });
  it("finds the block a drop between blocks belongs to", () => {
    const boxes = [{ top: 0, id: "a" }, { top: 40, id: "b" }, { top: 90, id: "c" }];
    expect(blockAtY(boxes, 50)?.id).toBe("b");
    expect(blockAtY(boxes, 500)?.id).toBe("c");
    expect(blockAtY(boxes, -20)?.id).toBe("a");
    expect(blockAtY([], 10)).toBeNull();
  });
});

function fakeEditor(blocks: { id: string; type: string; content?: unknown }[]) {
  const log: unknown[][] = [];
  const editor: PageDropEditor = {
    document: blocks,
    getBlock: (id) => blocks.find((block) => block.id === id),
    setTextCursorPosition: (block, placement) => { log.push(["cursor", (block as { id: string }).id, placement]); },
    insertInlineContent: (content) => { log.push(["inline", content]); },
    insertBlocks: (inserted, reference, placement) => { log.push(["blocks", inserted, (reference as { id: string }).id, placement]); return []; },
  };
  return { editor, log };
}
const BLOCKS = [{ id: "b1", type: "paragraph", content: [] }, { id: "b2", type: "image" }, { id: "b3", type: "paragraph", content: [] }];

describe("putting it in the page", () => {
  it("adds a mention at the end of the text block it was dropped on", () => {
    const { editor, log } = fakeEditor(BLOCKS);
    const embed = vi.fn();
    expect(insertDroppedItem(editor, threadDragItem({ id: "thr_1", title: "Fix login" }), "b1", embed)).toBe(true);
    expect(log).toEqual([["cursor", "b1", "end"], ["inline", [{ type: "mention", props: { kind: "thread", target: "thr_1", label: "Fix login" } }, " "]]]);
    expect(embed).not.toHaveBeenCalled();
  });
  it("after a block that holds no text, it goes in a paragraph of its own; with no block named, at the end", () => {
    const { editor, log } = fakeEditor(BLOCKS);
    insertDroppedItem(editor, docDragItem({ id: PAGE, title: "Plan" }), "b2", vi.fn());
    expect(log[0]).toEqual(["blocks", [{ type: "paragraph", content: [{ type: "mention", props: { kind: "page", target: PAGE, label: "Plan" } }, " "] }], "b2", "after"]);
    insertDroppedItem(editor, docDragItem({ id: PAGE, title: "Plan" }), null, vi.fn());
    expect(log[1]).toEqual(["cursor", "b3", "end"]);
    insertDroppedItem(editor, docDragItem({ id: PAGE, title: "Plan" }), "gone", vi.fn());
    expect(log[3]).toEqual(["cursor", "b3", "end"]);
  });
  it("places an embed card through the embed picker's own insert, and inserts nothing for a file", () => {
    const { editor, log } = fakeEditor(BLOCKS);
    const embed = vi.fn();
    expect(insertDroppedItem(editor, docDragItem({ id: BOARD, title: "Sketch" }), "b1", embed)).toBe(true);
    expect(embed).toHaveBeenCalledWith("b1", { kind: "drawing", target: BOARD });
    expect(insertDroppedItem(editor, { kind: "file", id: "/tmp/a", title: "a" }, "b1", embed)).toBe(false);
    expect(log).toEqual([]);
  });
});

describe("the page body as a drop target", () => {
  let root: Root;
  let container: HTMLElement;
  const insert = vi.fn((_item: DragItem, _blockId: string | null) => true);
  const inner = vi.fn();
  function Body() {
    const drop = usePageItemDrop(insert);
    return (
      <div data-testid="body" {...drop.handlers}>
        <div data-testid="editor" onDragOver={inner} onDrop={inner}>
          <div className="bn-block-outer" data-id="b1"><p>First</p></div>
          <div className="bn-block-outer" data-id="b2"><p>Second</p></div>
        </div>
        {drop.indicator}
      </div>
    );
  }
  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    insert.mockClear();
    inner.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<Body />));
    container.querySelector<HTMLElement>("[data-testid=body]")!.getBoundingClientRect = () => ({ top: 100, bottom: 400, left: 0, right: 600, width: 600, height: 300, x: 0, y: 100, toJSON() {} });
    [...container.querySelectorAll<HTMLElement>("[data-id]")].forEach((block, index) => { block.getBoundingClientRect = () => ({ top: 100 + index * 40, bottom: 140 + index * 40, left: 0, right: 600, width: 600, height: 40, x: 0, y: 100 + index * 40, toJSON() {} }); });
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); clearDragItem(); });
  const drag = (type: string, element: Element, transfer: DataTransfer, init: MouseEventInit = {}) => { let event!: MouseEvent; act(() => { event = dispatchDrag(type, element, transfer, init); }); return event; };
  const bar = () => container.querySelector<HTMLElement>("[data-testid=page-drop-bar]");
  const paragraph = (id: string) => container.querySelector(`[data-id=${id}] p`)!;

  it("shows a bar under the block the pointer is on and inserts the item there, keeping the editor's own drop handling away from it", () => {
    const item = threadDragItem({ id: "thr_1", title: "Fix login" });
    const transfer = fakeTransfer();
    writeDragItem(transfer, item);
    const over = drag("dragover", paragraph("b2"), transfer, { clientY: 150 });
    expect(over.defaultPrevented).toBe(true);
    expect(transfer.dropEffect).toBe("link");
    // Under the second block: its bottom (180) from the body's top (100).
    expect(bar()?.style.top).toBe("80px");
    const drop = drag("drop", paragraph("b2"), transfer, { clientY: 150 });
    expect(drop.defaultPrevented).toBe(true);
    expect(insert.mock.calls).toEqual([[item, "b2"]]);
    expect(bar()).toBeNull();
    expect(inner).not.toHaveBeenCalled();
  });

  it("a drop in the space between or below blocks goes to the nearest block above", () => {
    const transfer = fakeTransfer();
    writeDragItem(transfer, docDragItem({ id: PAGE, title: "Plan" }));
    drag("drop", container.querySelector("[data-testid=editor]")!, transfer, { clientY: 139 });
    drag("drop", container.querySelector("[data-testid=editor]")!, transfer, { clientY: 390 });
    expect(insert.mock.calls.map((call) => call[1])).toEqual(["b1", "b2"]);
  });

  it("leaves files and plain text to the editor, shows no bar for an item it can't link, and clears the bar when the drag leaves", () => {
    const files = fakeTransfer([new File(["x"], "photo.png", { type: "image/png" })]);
    expect(drag("dragover", paragraph("b1"), files).defaultPrevented).toBe(false);
    drag("drop", paragraph("b1"), files);
    expect(inner).toHaveBeenCalledTimes(2);
    expect(insert).not.toHaveBeenCalled();
    const terminal = fakeTransfer();
    writeDragItem(terminal, { kind: "tab", id: "k", title: "Terminal", tab: { pluginId: "bb", tabId: "terminal", params: undefined, threadId: "t" } });
    expect(drag("dragover", paragraph("b1"), terminal).defaultPrevented).toBe(false);
    expect(bar()).toBeNull();
    const thread = fakeTransfer();
    writeDragItem(thread, threadDragItem({ id: "thr_1" }));
    drag("dragover", paragraph("b1"), thread, { clientY: 110 });
    expect(bar()).not.toBeNull();
    drag("dragleave", container.querySelector("[data-testid=body]")!, thread);
    expect(bar()).toBeNull();
  });
});
