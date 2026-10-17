// Read-along: the piece of a reply being spoken lights up in BB's own
// transcript. It uses the CSS Custom Highlight API, so BB's markup is never
// changed; the piece is found by its text in the newest message that has it.
// What's spoken is the reply with markdown taken out (speakable), so the
// match ignores case, spacing and punctuation marks.

const HIGHLIGHT = "studio-voice-now";
const STYLE_ID = "studio-voice-read-along";
const ANCHOR = 24;

interface Highlights { set(name: string, value: unknown): void; delete(name: string): void }
const highlights = (): Highlights | null => (globalThis.CSS as unknown as { highlights?: Highlights } | undefined)?.highlights ?? null;
const HighlightClass = () => (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;

/** Letters and digits only, lowercased, with where each came from. */
function flatten(root: Node): { text: string; at: { node: Text; offset: number }[] } {
  const at: { node: Text; offset: number }[] = [];
  let text = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const value = node.data;
    for (let index = 0; index < value.length; index++) {
      const char = value[index]!.toLowerCase();
      if (!/[\p{L}\p{N}]/u.test(char)) continue;
      text += char;
      at.push({ node, offset: index });
    }
  }
  return { text, at };
}

const letters = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** The range of `piece` inside `root`, or null when it isn't there. */
export function findPiece(root: Node, piece: string): Range | null {
  const needle = letters(piece);
  if (!needle) return null;
  const { text, at } = flatten(root);
  const start = text.lastIndexOf(needle.slice(0, ANCHOR));
  if (start < 0) return null;
  const tail = needle.slice(-ANCHOR);
  const tailAt = text.indexOf(tail, start);
  const end = tailAt >= 0 && tailAt - start < needle.length + 200 ? tailAt + tail.length - 1 : Math.min(text.length - 1, start + needle.length - 1);
  const range = document.createRange();
  range.setStart(at[start]!.node, at[start]!.offset);
  range.setEnd(at[end]!.node, at[end]!.offset + 1);
  return range;
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `::highlight(${HIGHLIGHT}) { background-color: color-mix(in srgb, var(--primary, #ff8a65) 22%, transparent); color: inherit; }`;
  document.head.appendChild(style);
}

/** Light up the piece being spoken in the newest message that has it. Returns whether it was found. */
export function highlightPiece(piece: string): boolean {
  const registry = highlights();
  const Highlight = HighlightClass();
  if (!registry || !Highlight) return false;
  const messages = [...document.querySelectorAll<HTMLElement>("[data-timeline-row-id]")].reverse();
  for (const message of messages) {
    const range = findPiece(message, piece);
    if (!range) continue;
    ensureStyle();
    registry.set(HIGHLIGHT, new Highlight(range));
    return true;
  }
  registry.delete(HIGHLIGHT);
  return false;
}

export function clearHighlight(): void {
  highlights()?.delete(HIGHLIGHT);
}
