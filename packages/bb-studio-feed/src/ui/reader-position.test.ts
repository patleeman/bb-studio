import { afterEach, expect, it, vi } from "vitest";
import { readPosition, readerScroller, restorePosition } from "./reader-position";

afterEach(() => vi.unstubAllGlobals());

it("restores a visible post's offset inside the actual scrolling ancestor", () => {
  const scroller = { parentElement: null, overflow: "auto", scrollTop: 200, getBoundingClientRect: () => ({ top: 20 }) };
  const wrapper = { parentElement: scroller, overflow: "visible" };
  let anchorTop = 30;
  const rows = [
    { dataset: { feedPost: "above" }, getBoundingClientRect: () => ({ top: -80, bottom: 0 }) },
    { dataset: { feedPost: "anchor" }, getBoundingClientRect: () => ({ top: anchorTop, bottom: anchorTop + 100 }) },
  ];
  const root = { parentElement: wrapper, querySelectorAll: () => rows } as unknown as HTMLElement;
  vi.stubGlobal("getComputedStyle", (node: { overflow: string }) => ({ overflowY: node.overflow }));
  vi.stubGlobal("document", { scrollingElement: {}, documentElement: {} });
  expect(readerScroller(root)).toBe(scroller);
  const position = readPosition(root);
  expect(position).toEqual({ postId: "anchor", offset: 10, scrollTop: 200 });
  anchorTop += 140; // New posts or image loading shifted the anchor downward.
  restorePosition(root, position);
  expect(scroller.scrollTop).toBe(340);
  rows.splice(1, 1); // A deleted/filtered post falls back to the saved scroll position.
  restorePosition(root, position);
  expect(scroller.scrollTop).toBe(200);
  restorePosition(root, { ...position, scrollTop: 0 });
  expect(scroller.scrollTop).toBe(0); // At the top, resized filter controls must remain visible.
});
