// An item dropped on a page's body (src/kit/app/item-drag.ts): a thread, a
// document or a tab dragged from the Bot sidebar, Search, the workbench or a
// transcript.
// - A whiteboard, an artifact, a recording or a mini app becomes its embed
//   card, as the slash menu's embeds do (placeEmbed), after the block it was
//   dropped on.
// - A thread, a page and every other document becomes a mention: a link to
//   it, at the end of the block it was dropped on.
// A bar under that block shows where it will land. Files from the system are
// left to the editor, which uploads them (an image shows as an image).
import { useCallback, useRef, useState, type DragEvent, type ReactNode } from "react";
import { dragItemTarget, hasDragItem, peekDragItem, readDragItem, type DragItem } from "../../kit/app/item-drag";
import { untitled } from "../../kit/format";
import { pathForTarget } from "../../ui/item-target";
import { isPageId } from "../constants";
import type { StudioEmbedKind } from "../schema-config";
import { referenceContent, studioLink } from "./links";

export type PageDrop =
  | { type: "embed"; props: { kind: StudioEmbedKind; target: string } }
  | { type: "inline"; content: unknown[] };

/** What an item becomes in a page; null for one a page can't link to (a file, another plugin's tab). */
export function pageDropContent(item: DragItem): PageDrop | null {
  const target = dragItemTarget(item);
  if (!target) return null;
  if (target.kind === "thread") return { type: "inline", content: [{ type: "mention", props: { kind: "thread", target: target.id, label: untitled(item.title) } }, " "] };
  // A page is mentioned as a page, as the @ menu does.
  if (isPageId(target.id)) return { type: "inline", content: [{ type: "mention", props: { kind: "page", target: target.id, label: untitled(item.title) } }, " "] };
  const href = pathForTarget(target);
  if (!href) return null;
  const embed = studioLink(href);
  return embed ? { type: "embed", props: embed } : { type: "inline", content: referenceContent({ href, title: item.title }) };
}

/** The block a drop at `y` belongs to: the last one that starts at or above it, else the first. Null with no blocks. */
export function blockAtY<Box extends { top: number }>(boxes: readonly Box[], y: number): Box | null {
  let found: Box | null = boxes[0] ?? null;
  for (const box of boxes) if (box.top <= y) found = box;
  return found;
}

interface DropBlock { id: string; type: string; content?: unknown }

/** The parts of the editor a drop uses. */
export interface PageDropEditor {
  document: readonly DropBlock[];
  getBlock(id: string): DropBlock | undefined;
  setTextCursorPosition(block: never, placement: "end"): void;
  insertInlineContent(content: never): void;
  insertBlocks(blocks: never, reference: never, placement: "after"): unknown;
}

/**
 * Puts `item` into the page at block `blockId` (the last block when it is
 * null or gone). `embed` places an embed card (block-menu.tsx's placeEmbed).
 * False when the item has nothing to insert.
 */
export function insertDroppedItem(editor: PageDropEditor, item: DragItem, blockId: string | null, embed: (blockId: string, props: { kind: StudioEmbedKind; target: string }) => void): boolean {
  const content = pageDropContent(item);
  if (!content) return false;
  const block = (blockId ? editor.getBlock(blockId) : undefined) ?? editor.document[editor.document.length - 1];
  if (content.type === "embed") { embed(block?.id ?? "", content.props); return true; }
  if (!block) return false;
  // Text goes at the end of a block that holds text; after any other block (an embed, an image), in a paragraph of its own.
  if (Array.isArray(block.content)) {
    editor.setTextCursorPosition(block as never, "end");
    editor.insertInlineContent(content.content as never);
  } else {
    editor.insertBlocks([{ type: "paragraph", content: content.content }] as never, block as never, "after");
  }
  return true;
}

const BLOCK = ".bn-block-outer[data-id], [data-node-type=blockOuter][data-id]";

/** The block under a drop: the one the pointer is in, else the nearest one above it. */
function blockUnder(root: HTMLElement, event: { target: EventTarget | null; clientY: number }): HTMLElement | null {
  const inside = (event.target as Element | null)?.closest?.<HTMLElement>("[data-id]");
  if (inside && root.contains(inside)) return inside;
  const boxes = [...root.querySelectorAll<HTMLElement>(BLOCK)].map((element) => ({ element, top: element.getBoundingClientRect().top }));
  return blockAtY(boxes, event.clientY)?.element ?? null;
}

/**
 * The page body as a drop target for items. Spread `handlers` on the element
 * around the editor (it must be positioned) and draw `indicator` in it.
 * `insert` gets the item and the id of the block it was dropped on.
 */
export function usePageItemDrop(insert: (item: DragItem, blockId: string | null) => boolean): {
  handlers: { onDragOverCapture(event: DragEvent<HTMLElement>): void; onDropCapture(event: DragEvent<HTMLElement>): void; onDragLeave(event: DragEvent<HTMLElement>): void };
  indicator: ReactNode;
} {
  const [bar, setBar] = useState<number | null>(null);
  const shown = useRef<number | null>(null);
  const show = (next: number | null) => { if (shown.current !== next) { shown.current = next; setBar(next); } };
  const latest = useRef(insert);
  latest.current = insert;
  // Capturing, so the editor's own drop handling never sees an item: it would paste the item's address as text.
  const onDragOverCapture = useCallback((event: DragEvent<HTMLElement>) => {
    if (!hasDragItem(event.dataTransfer)) return;
    const item = peekDragItem(event.dataTransfer);
    // Another window's item can't be read until it drops.
    if (item && !pageDropContent(item)) { show(null); return; }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "link";
    const root = event.currentTarget;
    const block = blockUnder(root, event);
    show(block ? Math.round(block.getBoundingClientRect().bottom - root.getBoundingClientRect().top) : 0);
  }, []);
  const onDropCapture = useCallback((event: DragEvent<HTMLElement>) => {
    if (!hasDragItem(event.dataTransfer)) return;
    show(null);
    const item = readDragItem(event.dataTransfer);
    if (!item || !pageDropContent(item)) return;
    event.preventDefault();
    event.stopPropagation();
    latest.current(item, blockUnder(event.currentTarget, event)?.dataset.id ?? null);
  }, []);
  const onDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) show(null);
  }, []);
  return {
    handlers: { onDragOverCapture, onDropCapture, onDragLeave },
    indicator: bar === null ? null : <div aria-hidden data-testid="page-drop-bar" className="pointer-events-none absolute inset-x-6 z-10 h-0.5 rounded-full bg-primary" style={{ top: bar }} />,
  };
}
