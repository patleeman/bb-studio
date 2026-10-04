import type { ReaderPosition } from "../reader-state";

export function readerScroller(root: HTMLElement): HTMLElement {
  let parent = root.parentElement;
  while (parent) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent;
    parent = parent.parentElement;
  }
  return document.scrollingElement as HTMLElement ?? document.documentElement;
}

const topOf = (scroller: HTMLElement) => scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;

export function readPosition(root: HTMLElement): ReaderPosition {
  const scroller = readerScroller(root);
  const top = topOf(scroller);
  const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-feed-post]"));
  const anchor = rows.find(row => row.getBoundingClientRect().bottom > top);
  return { postId: anchor?.dataset.feedPost ?? null, offset: anchor ? anchor.getBoundingClientRect().top - top : 0, scrollTop: scroller.scrollTop };
}

export function restorePosition(root: HTMLElement, position: ReaderPosition): void {
  const scroller = readerScroller(root);
  if (position.scrollTop === 0) { scroller.scrollTop = 0; return; }
  const anchor = Array.from(root.querySelectorAll<HTMLElement>("[data-feed-post]")).find(row => row.dataset.feedPost === position.postId);
  scroller.scrollTop = anchor ? scroller.scrollTop + anchor.getBoundingClientRect().top - topOf(scroller) - position.offset : position.scrollTop;
}
