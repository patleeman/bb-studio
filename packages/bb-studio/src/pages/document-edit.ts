// Whole-page edits from clients without the Yjs editor (the iOS app). The client
// sends the page as plain Markdown; this maps it back onto the page's top-level
// blocks so unchanged blocks keep their ids, comments, and anything Markdown
// can't express, and only edited blocks are rewritten.
import type * as Y from "yjs";
import { applyEdits, PageEditError, readBlocks, replaceContent, type EditOp, type EditResult } from "./doc";
import { blocksToMarkdown, markdownToBlocks, type PageBlock } from "./markdown";

/** One block's Markdown after a parse round trip, so both sides compare alike. */
function key(block: PageBlock): string {
  return blocksToMarkdown(markdownToBlocks(blocksToMarkdown([block]))).trim();
}

/**
 * The ops that turn `current` into `next`: blocks matched by the longest common
 * run stay, mismatched blocks in between are replaced in place, and the rest
 * are inserted or deleted.
 */
export function planDocumentEdit(current: { id: string; markdown: string }[], next: string[]): EditOp[] {
  const lcs = Array.from({ length: current.length + 1 }, () => new Array<number>(next.length + 1).fill(0));
  for (let i = current.length - 1; i >= 0; i--)
    for (let j = next.length - 1; j >= 0; j--)
      lcs[i]![j] = current[i]!.markdown === next[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);

  const ops: EditOp[] = [];
  let anchor: string | null = null;
  let i = 0;
  let j = 0;
  const flush = (oldEnd: number, newEnd: number) => {
    const paired = Math.min(oldEnd - i, newEnd - j);
    for (let k = 0; k < paired; k++) {
      ops.push({ op: "replace", block: current[i + k]!.id, markdown: next[j + k]! });
      anchor = current[i + k]!.id;
    }
    for (let k = i + paired; k < oldEnd; k++) ops.push({ op: "delete", block: current[k]!.id });
    if (j + paired < newEnd) {
      const markdown = next.slice(j + paired, newEnd).join("\n\n");
      ops.push(anchor ? { op: "insert_after", block: anchor, markdown } : { op: "prepend", markdown });
    }
    i = oldEnd;
    j = newEnd;
  };
  let a = 0;
  let b = 0;
  while (a < current.length && b < next.length) {
    if (current[a]!.markdown === next[b]) {
      flush(a, b);
      anchor = current[a]!.id;
      i = ++a;
      j = ++b;
    } else if (lcs[a + 1]![b]! >= lcs[a]![b + 1]!) a++;
    else b++;
  }
  flush(current.length, next.length);
  return ops;
}

/**
 * Applies a whole-page Markdown edit. Empty paragraphs are left alone (Markdown
 * drops them), and blocks in `locked` (those holding comment anchors) can't be
 * rewritten or deleted.
 */
export function editDocument(doc: Y.Doc, markdown: string, locked: ReadonlySet<string>, origin: unknown): EditResult {
  const next = markdownToBlocks(markdown).map(key);
  if (!next.length) {
    if (locked.size) throw new PageEditError("This page has comments. Clear it in BB web to keep them.");
    return replaceContent(doc, "", origin);
  }
  const blocks = readBlocks(doc);
  const current = blocks.flatMap((block) => {
    const markdown = key(block);
    return block.id && markdown ? [{ id: block.id, markdown }] : [];
  });
  // Rewriting a top-level block rewrites its nested blocks too, so a comment
  // on any of them locks it.
  const holdsComment = (block: PageBlock): boolean => (block.id !== undefined && locked.has(block.id)) || (block.children ?? []).some(holdsComment);
  const lockedTop = new Set(blocks.filter(holdsComment).map((block) => block.id!));
  const ops = planDocumentEdit(current, next);
  for (const op of ops) {
    if ((op.op === "replace" || op.op === "delete") && lockedTop.has(op.block)) {
      throw new PageEditError("A paragraph you changed has comments. Edit it in BB web to keep them.");
    }
  }
  // The client's Markdown is the whole block, nested blocks included.
  const whole = ops.map((op): EditOp => (op.op === "replace" ? { ...op, keepNested: false } : op));
  return whole.length ? applyEdits(doc, whole, origin) : { touched: [], changed: false };
}
