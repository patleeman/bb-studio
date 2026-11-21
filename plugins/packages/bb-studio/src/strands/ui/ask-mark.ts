// The asking sentence of a reply that needs the user, marked in place
// (design "Replies that need you", round 3, option a): a faint amber
// highlight on the sentence itself, through the CSS Custom Highlight API, so
// BB's rendered message is never touched. Jump to reply flashes it.
import { useSyncExternalStore } from "react";

export const ASK_HIGHLIGHT = "studio-reply-ask";
export const FLASH_HIGHLIGHT = "studio-reply-ask-flash";
const STYLE_ID = "studio-reply-ask-style";
/** A flash asked for this long ago still plays when the reply mounts (a jump from another page). */
const FLASH_PENDING_MS = 8_000;
export const FLASH_MS = 1_200;

type HighlightLike = { add(range: Range): unknown; delete(range: Range): unknown };
type Registry = { get(name: string): HighlightLike | undefined; set(name: string, value: HighlightLike): unknown };

/** The page's highlight registry, when this browser has one. */
function registry(doc: Document): { highlights: Registry; make(): HighlightLike } | null {
  const view = doc.defaultView as (Window & { CSS?: { highlights?: Registry }; Highlight?: new () => HighlightLike }) | null;
  const highlights = view?.CSS?.highlights;
  const Make = view?.Highlight;
  return highlights && Make ? { highlights, make: () => new Make() } : null;
}

function ensureStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `::highlight(${ASK_HIGHLIGHT}){background-color:color-mix(in oklab,var(--warning,#e8a33d) 22%,transparent)}`
    + `::highlight(${FLASH_HIGHLIGHT}){background-color:color-mix(in oklab,var(--warning,#e8a33d) 50%,transparent)}`;
  doc.head.appendChild(style);
}

/** Marks `range` (or, with `flash`, flashes it); answers how to unmark it. */
export function markRange(range: Range, flash = false): () => void {
  const doc = range.startContainer.ownerDocument;
  const found = doc ? registry(doc) : null;
  if (!doc || !found) return () => {};
  ensureStyle(doc);
  const name = flash ? FLASH_HIGHLIGHT : ASK_HIGHLIGHT;
  let highlight = found.highlights.get(name);
  if (!highlight) { highlight = found.make(); found.highlights.set(name, highlight); }
  highlight.add(range);
  return () => { highlight!.delete(range); };
}

const METADATA = '[aria-label="Message metadata"],[data-message-action-metadata],button';

/**
 * The range of `text` inside `root`'s shown text (whitespace folded; the
 * message metadata above it and buttons left out). A sentence cut with "…"
 * matches by its start. Null when it isn't there.
 */
export function findText(root: Element, text: string): Range | null {
  const want = text.replace(/…$/u, "").replace(/\s+/gu, " ").trim();
  const doc = root.ownerDocument;
  if (!want || !doc) return null;
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  let flat = "";
  const map: { node: Text; offset: number }[] = [];
  let space = true;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (node.parentElement?.closest(METADATA)) continue;
    for (let index = 0; index < node.data.length; index++) {
      const char = node.data[index]!;
      if (/\s/u.test(char)) { if (space) continue; flat += " "; space = true; } else { flat += char; space = false; }
      map.push({ node, offset: index });
    }
  }
  // The reply's own sentence, not an earlier quote of it: from the end.
  const at = flat.lastIndexOf(want);
  if (at < 0) return null;
  const start = map[at]!;
  const end = map[at + want.length - 1]!;
  const range = doc.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset + 1);
  return range;
}

/** The reply's last paragraph: what is marked when Jev named no sentence. */
export function lastParagraph(root: Element): Range | null {
  const paragraphs = [...root.querySelectorAll("p,li")].filter((element) => !element.closest(METADATA) && element.textContent?.trim());
  const last = paragraphs.at(-1);
  if (!last || !root.ownerDocument) return null;
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(last);
  return range;
}

// ---- Jump to reply flashes the sentence ----

let pending: { key: string; at: number } | null = null;
const listeners = new Set<() => void>();
let version = 0;

/** Jump to reply: the reply `seq` of `threadId` flashes when it shows (now, or within a few seconds when it mounts). */
export function flashReply(threadId: string, seq: number, now = Date.now()): void {
  pending = { key: `${threadId}:${seq}`, at: now };
  version++;
  for (const listener of listeners) listener();
}

/** Takes the flash waiting for this reply, if any. */
export function takeFlash(threadId: string, seq: number, now = Date.now()): boolean {
  if (!pending || pending.key !== `${threadId}:${seq}` || now - pending.at > FLASH_PENDING_MS) return false;
  pending = null;
  return true;
}

/** Re-renders when a flash is asked for. */
export function useFlashVersion(): number {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => version, () => version);
}

export function resetAskMarksForTests(): void { pending = null; version = 0; }
