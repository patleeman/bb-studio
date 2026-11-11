// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  handleLinkClick,
  installLinkClickCapture,
  openUrlWithPlugin,
} from "./fork-link-handlers";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "./plugin-slots";

afterEach(() => {
  resetPluginSlotStoreForTest();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("plugin link handlers", () => {
  it("lets the first plugin that takes the link open it, in plugin-id order", () => {
    const seen: string[] = [];
    setPluginSlotRegistrations(
      "zeta",
      makePluginRegistrationSet({
        linkHandlers: [
          {
            id: "all",
            handle: (url) => {
              seen.push(`zeta:${url}`);
              return true;
            },
          },
        ],
      }),
    );
    setPluginSlotRegistrations(
      "alpha",
      makePluginRegistrationSet({
        linkHandlers: [
          {
            id: "pages",
            handle: (url) => {
              seen.push(`alpha:${url}`);
              return url.includes("/pages/");
            },
          },
        ],
      }),
    );

    expect(openUrlWithPlugin("https://x.test/pages/1")).toBe(true);
    expect(openUrlWithPlugin("https://x.test/other")).toBe(true);
    expect(seen).toEqual([
      "alpha:https://x.test/pages/1",
      "alpha:https://x.test/other",
      "zeta:https://x.test/other",
    ]);
  });

  it("leaves the link to bb when no plugin takes it or a handler throws", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(openUrlWithPlugin("https://x.test/")).toBe(false);
    setPluginSlotRegistrations(
      "alpha",
      makePluginRegistrationSet({
        linkHandlers: [
          {
            id: "broken",
            handle: () => {
              throw new Error("boom");
            },
          },
        ],
      }),
    );
    expect(openUrlWithPlugin("https://x.test/")).toBe(false);
  });

  it("passes the click through to handlers, and asks without one for a URL bb opens itself", () => {
    const handle = vi.fn(() => true);
    setPluginSlotRegistrations(
      "alpha",
      makePluginRegistrationSet({ linkHandlers: [{ id: "all", handle }] }),
    );
    expect(openUrlWithPlugin("bb://page/pg_1")).toBe(true);
    expect(handle).toHaveBeenCalledWith("bb://page/pg_1", undefined);
    const click = {
      modifiers: { meta: true, ctrl: false, shift: false, alt: false },
    };
    openUrlWithPlugin("bb://page/pg_1", click);
    expect(handle).toHaveBeenLastCalledWith("bb://page/pg_1", click);
  });
});

function anchorClick(
  anchor: HTMLAnchorElement,
  init: MouseEventInit = {},
): MouseEvent {
  const event = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...init,
  });
  Object.defineProperty(event, "target", { value: anchor });
  return event;
}

function mount(html: string): HTMLAnchorElement {
  document.body.innerHTML = html;
  return document.body.querySelector("a")!;
}

describe("modified link clicks", () => {
  it("asks handlers with the modifiers for a modified click on any link, and stops bb's own handling when one takes it", () => {
    const handle = vi.fn((url: string) => url.includes("/threads/"));
    setPluginSlotRegistrations(
      "alpha",
      makePluginRegistrationSet({ linkHandlers: [{ id: "all", handle }] }),
    );
    const anchor = mount('<nav><a href="/threads/thr_1">Thread</a></nav>');
    const event = anchorClick(anchor, { metaKey: true });
    expect(handleLinkClick(event)).toBe(true);
    expect(handle).toHaveBeenCalledWith(
      `${window.location.origin}/threads/thr_1`,
      {
        modifiers: { meta: true, ctrl: false, shift: false, alt: false },
      },
    );
    expect(event.defaultPrevented).toBe(true);

    const other = mount('<nav><a href="https://example.com/">Web</a></nav>');
    const shift = anchorClick(other, { shiftKey: true });
    expect(handleLinkClick(shift)).toBe(false);
    expect(shift.defaultPrevented).toBe(false);
  });

  it("asks for a plain click only on a route link inside bb's rendered content, and leaves alt-clicks and other buttons alone", () => {
    const handle = vi.fn(() => true);
    setPluginSlotRegistrations(
      "alpha",
      makePluginRegistrationSet({ linkHandlers: [{ id: "all", handle }] }),
    );
    const inContent = mount(
      '<div data-markdown-preview><a href="/plugins/studio/studio/pages/pg_1">Page</a></div>',
    );
    expect(handleLinkClick(anchorClick(inContent))).toBe(true);
    expect(handle).toHaveBeenCalledTimes(1);

    const webInContent = mount(
      '<div data-markdown-preview><a href="https://example.com/">Web</a></div>',
    );
    expect(handleLinkClick(anchorClick(webInContent))).toBe(false);

    const inChrome = mount('<nav><a href="/threads/thr_1">Thread</a></nav>');
    expect(handleLinkClick(anchorClick(inChrome))).toBe(false);
    expect(handleLinkClick(anchorClick(inChrome, { altKey: true }))).toBe(
      false,
    );
    expect(
      handleLinkClick(anchorClick(inChrome, { metaKey: true, button: 1 })),
    ).toBe(false);
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it("does nothing while no plugin has a link handler", () => {
    const anchor = mount(
      '<div data-markdown-preview><a href="/threads/thr_1">Thread</a></div>',
    );
    const event = anchorClick(anchor, { metaKey: true });
    expect(handleLinkClick(event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it("leaves synthetic clicks alone", () => {
    const handle = vi.fn(() => true);
    setPluginSlotRegistrations(
      "alpha",
      makePluginRegistrationSet({ linkHandlers: [{ id: "all", handle }] }),
    );
    const other = document.implementation.createHTMLDocument("other");
    other.body.innerHTML = `<nav><a href="${window.location.origin}/threads/thr_1">Thread</a></nav>`;
    const anchor = other.body.querySelector("a")!;
    const uninstall = installLinkClickCapture(other);
    anchor.dispatchEvent(anchorClick(anchor, { metaKey: true }));
    expect(handle).not.toHaveBeenCalled();
    uninstall();
  });

  it("captures clicks on the document before they reach bb, and uninstalls", () => {
    const handle = vi.fn(() => true);
    setPluginSlotRegistrations(
      "alpha",
      makePluginRegistrationSet({ linkHandlers: [{ id: "all", handle }] }),
    );
    const other = document.implementation.createHTMLDocument("other");
    other.body.innerHTML = `<nav><a href="${window.location.origin}/threads/thr_1">Thread</a></nav>`;
    const anchor = other.body.querySelector("a")!;
    const bubbled = vi.fn();
    other.body.addEventListener("click", bubbled);
    const uninstall = installLinkClickCapture(other, () => true);
    anchor.dispatchEvent(anchorClick(anchor, { metaKey: true }));
    expect(handle).toHaveBeenCalledTimes(1);
    expect(bubbled).not.toHaveBeenCalled();
    uninstall();
    anchor.dispatchEvent(anchorClick(anchor, { metaKey: true }));
    expect(handle).toHaveBeenCalledTimes(1);
    expect(bubbled).toHaveBeenCalledTimes(1);
  });
});
