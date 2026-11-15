const WORD = /[\p{L}\p{N}\p{M}_'’]/u;

const isWord = (char: string | undefined) => char !== undefined && WORD.test(char);

export function wordStart(text: string, offset: number): number {
  let at = Math.max(0, Math.min(offset, text.length));
  while (at > 0 && isWord(text[at - 1]) && isWord(text[at])) at -= 1;
  return at;
}

export function wordEnd(text: string, offset: number): number {
  let at = Math.max(0, Math.min(offset, text.length));
  while (at < text.length && isWord(text[at]) && isWord(text[at - 1])) at += 1;
  return at;
}

export function snapToWords(text: string, start: number, end: number): [number, number] {
  let from = Math.max(0, Math.min(start, end, text.length));
  let to = Math.min(text.length, Math.max(start, end));
  while (from < to && /\s/.test(text[from]!)) from += 1;
  while (to > from && /\s/.test(text[to - 1]!)) to -= 1;
  if (from === to) return [start, end];
  return [wordStart(text, from), wordEnd(text, to)];
}

type Resolved = { parent: { isTextblock: boolean; textBetween(from: number, to: number, block?: string, leaf?: string): string; content: { size: number } }; parentOffset: number };
type DocLike = { resolve(pos: number): Resolved };

const LEAF = "￼";
const blockText = (resolved: Resolved) => resolved.parent.textBetween(0, resolved.parent.content.size, undefined, LEAF);

export function snapPositions(doc: DocLike, from: number, to: number): { from: number; to: number } {
  if (from >= to) return { from, to };
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  if ($from.parent === $to.parent && $from.parent.isTextblock) {
    const [start, end] = snapToWords(blockText($from), $from.parentOffset, $to.parentOffset);
    return { from: from - $from.parentOffset + start, to: to - $to.parentOffset + end };
  }
  const start = $from.parent.isTextblock ? wordStart(blockText($from), $from.parentOffset) : $from.parentOffset;
  const end = $to.parent.isTextblock ? wordEnd(blockText($to), $to.parentOffset) : $to.parentOffset;
  return { from: from - $from.parentOffset + start, to: to - $to.parentOffset + end };
}
