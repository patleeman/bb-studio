// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forkCascade } from "@/test/fork-css-cascade";
import {
  FORK_OVERLAY_SCROLL_ATTRIBUTE,
  FORK_SCROLL_THUMB_ATTRIBUTE,
  forkScrollThumbBox,
  mountForkOverlayScrollbar,
} from "./ForkOverlayScrollbar";

const root = document.documentElement;

function scroller(
  attribute: string,
  box: { top: number; right: number; height: number },
  scroll: { scrollTop: number; scrollHeight: number },
): HTMLElement {
  const element = document.createElement("div");
  element.setAttribute(attribute, "");
  Object.defineProperties(element, {
    clientHeight: { value: box.height },
    scrollHeight: { value: scroll.scrollHeight },
    scrollTop: { value: scroll.scrollTop, writable: true },
  });
  element.getBoundingClientRect = () =>
    ({
      top: box.top,
      right: box.right,
      height: box.height,
      bottom: box.top + box.height,
      left: 0,
      width: box.right,
    }) as DOMRect;
  document.body.appendChild(element);
  return element;
}

const thumb = () =>
  document.querySelector(`[${FORK_SCROLL_THUMB_ATTRIBUTE}]`) as HTMLElement;

let unmount: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  unmount = mountForkOverlayScrollbar(document);
});

afterEach(() => {
  unmount();
  vi.useRealTimers();
  document.body.replaceChildren();
  root.removeAttribute("data-fork-cards");
});

describe("the overlay thumb's box", () => {
  it("is null when nothing scrolls, and otherwise sits 2px inside the scroller's right edge, sized and placed by the scroll position", () => {
    const fits = scroller(
      "data-page-scroll-viewport",
      { top: 50, right: 900, height: 600 },
      { scrollTop: 0, scrollHeight: 600 },
    );
    expect(forkScrollThumbBox(fits, 6)).toBeNull();
    const long = scroller(
      "data-page-scroll-viewport",
      { top: 50, right: 900, height: 604 },
      { scrollTop: 604, scrollHeight: 1812 },
    );
    expect(forkScrollThumbBox(long, 6)).toEqual({
      top: 50 + 2 + 200,
      left: 900 - 2 - 6,
      height: 200,
      travel: 400,
      range: 1208,
    });
    const huge = scroller(
      "data-page-scroll-viewport",
      { top: 0, right: 900, height: 604 },
      { scrollTop: 0, scrollHeight: 600000 },
    );
    expect(forkScrollThumbBox(huge, 6)?.height).toBe(28);
  });
});

describe("the overlay scrollbar", () => {
  it("shows the thumb for a page scroller that scrolls under a card layout, then hides it when idle", () => {
    const page = scroller(
      "data-page-scroll-viewport",
      { top: 50, right: 900, height: 604 },
      { scrollTop: 604, scrollHeight: 1812 },
    );
    page.dispatchEvent(new Event("scroll"));
    expect(thumb().hasAttribute("data-visible")).toBe(false);
    root.setAttribute("data-fork-cards", "");
    page.dispatchEvent(new Event("scroll"));
    expect(thumb().hasAttribute("data-visible")).toBe(true);
    expect(thumb().style.top).toBe("252px");
    expect(thumb().style.left).toBe("892px");
    expect(thumb().style.height).toBe("200px");
    expect(thumb().getAttribute("aria-hidden")).toBe("true");
    vi.advanceTimersByTime(1000);
    expect(thumb().hasAttribute("data-visible")).toBe(false);
  });

  it("serves a plugin's scroller marked data-fork-overlay-scroll and ignores any other scroller", () => {
    root.setAttribute("data-fork-cards", "");
    const other = scroller(
      "data-other",
      { top: 0, right: 500, height: 604 },
      { scrollTop: 10, scrollHeight: 1812 },
    );
    other.dispatchEvent(new Event("scroll"));
    expect(thumb().hasAttribute("data-visible")).toBe(false);
    const plugin = scroller(
      FORK_OVERLAY_SCROLL_ATTRIBUTE,
      { top: 0, right: 500, height: 604 },
      { scrollTop: 0, scrollHeight: 1812 },
    );
    plugin.dispatchEvent(new Event("scroll"));
    expect(thumb().hasAttribute("data-visible")).toBe(true);
    expect(thumb().style.left).toBe("492px");
  });

  it("stays while the pointer is over the scroller, and dragging the thumb scrolls it", () => {
    root.setAttribute("data-fork-cards", "");
    const page = scroller(
      "data-page-scroll-viewport",
      { top: 0, right: 900, height: 604 },
      { scrollTop: 0, scrollHeight: 1812 },
    );
    thumb().setPointerCapture = () => {};
    page.dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
    expect(thumb().hasAttribute("data-visible")).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(thumb().hasAttribute("data-visible")).toBe(true);
    thumb().dispatchEvent(
      new MouseEvent("pointerdown", { button: 0, clientY: 100 }),
    );
    document.dispatchEvent(
      new MouseEvent("pointermove", { bubbles: true, clientY: 200 }),
    );
    expect(page.scrollTop).toBe(302);
    thumb().dispatchEvent(new MouseEvent("pointerup"));
    document.body.dispatchEvent(
      new MouseEvent("pointermove", { bubbles: true }),
    );
    vi.advanceTimersByTime(1000);
    expect(thumb().hasAttribute("data-visible")).toBe(false);
  });

  it("removes its thumb on unmount", () => {
    unmount();
    expect(thumb()).toBeNull();
    unmount = mountForkOverlayScrollbar(document);
  });
});

describe("scrollers under a card layout", () => {
  it("reserve no gutter: bb's page, transcript and list scrollers and a plugin's marked one hide the native scrollbar only while cards are on", () => {
    const inset = document.createElement("div");
    inset.setAttribute("data-sidebar", "inset");
    inset.innerHTML = `
      <div data-page-scroll-viewport="" class="thread-scrollbar"></div>
      <div data-resource-collection-viewport=""></div>
      <div data-fork-overlay-scroll=""></div>
      <div class="relative h-full overflow-hidden"><div class="h-full overflow-y-auto"></div></div>
      <pre class="overflow-x-auto"></pre>`;
    document.body.appendChild(inset);
    const scrollers = [
      ...inset.querySelectorAll(
        "[data-page-scroll-viewport], [data-resource-collection-viewport], [data-fork-overlay-scroll], .h-full.overflow-y-auto",
      ),
    ];
    expect(scrollers).toHaveLength(4);
    for (const element of scrollers) {
      expect(forkCascade(element, "scrollbar-width")).toBeNull();
    }
    root.setAttribute("data-fork-cards", "");
    for (const element of scrollers) {
      expect(forkCascade(element, "scrollbar-width")).toBe("none");
    }
    expect(
      forkCascade(inset.querySelector("pre") as Element, "scrollbar-width"),
    ).toBeNull();
    expect(forkCascade(root, "--fork-cards-scroll-gutter")).toBe("0px");
  });
});
