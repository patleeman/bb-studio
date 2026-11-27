// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAST_TITLE_DELAY_MS, installFastTitles } from "./fast-title";

const tip = () => document.querySelector("[data-bb-fast-title-tip]");
const over = (el: Element) => el.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
const out = (el: Element, to: Element | null = document.body) =>
  el.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: to }));

describe("fast titles", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installFastTitles(document, { replace: true });
    document.body.innerHTML = `
      <div data-bb-plugin-root>
        <button id="a" title="Reload"><span id="a-icon"></span></button>
        <button id="b" title="Close"></button>
      </div>
      <button id="host" title="Host button"></button>
      <div data-bb-plugin-root>
        <div id="pane" title="Release notes.md">
          <div data-bb-plugin-root><p id="page-text">Page body</p><iframe id="frame" title="Embedded view"></iframe></div>
        </div>
      </div>`;
  });
  afterEach(() => {
    document.dispatchEvent(new MouseEvent("pointerdown"));
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
  });

  it("shows a plugin title as a tooltip after a short delay, and restores it", () => {
    const a = document.getElementById("a")!;
    over(document.getElementById("a-icon")!);
    expect(a.hasAttribute("title")).toBe(false);
    vi.advanceTimersByTime(FAST_TITLE_DELAY_MS - 1);
    expect(tip()).toBeNull();
    vi.advanceTimersByTime(1);
    expect(tip()?.textContent).toBe("Reload");

    out(a);
    expect(tip()).toBeNull();
    expect(a.getAttribute("title")).toBe("Reload");
  });

  it("opens the next tooltip at once when moving along a toolbar", () => {
    const a = document.getElementById("a")!;
    const b = document.getElementById("b")!;
    over(a);
    vi.advanceTimersByTime(FAST_TITLE_DELAY_MS);
    out(a, b);
    over(b);
    vi.advanceTimersByTime(0);
    expect(tip()?.textContent).toBe("Close");
  });

  it("leaves titles outside plugin surfaces to the browser", () => {
    const host = document.getElementById("host")!;
    over(host);
    vi.advanceTimersByTime(FAST_TITLE_DELAY_MS);
    expect(tip()).toBeNull();
    expect(host.getAttribute("title")).toBe("Host button");
  });

  it("ignores a title on a wrapper around another plugin surface", () => {
    over(document.getElementById("page-text")!);
    vi.advanceTimersByTime(FAST_TITLE_DELAY_MS);
    expect(tip()).toBeNull();
    expect(document.getElementById("pane")!.getAttribute("title")).toBe("Release notes.md");
  });

  it("never shows an iframe's title", () => {
    over(document.getElementById("frame")!);
    vi.advanceTimersByTime(FAST_TITLE_DELAY_MS);
    expect(tip()).toBeNull();
  });

  it("replaces mid-hover across same-owner installs, keeps first-wins across owners, and tolerates legacy `true` markers", async () => {
    const a = document.getElementById("a")!;
    const b = document.getElementById("b")!;
    const firstDispose = installFastTitles(document, { replace: true, owner: "studio" });
    over(a);
    vi.advanceTimersByTime(FAST_TITLE_DELAY_MS);
    expect(tip()?.textContent).toBe("Reload");
    expect(a.hasAttribute("title")).toBe(false);

    // Same-owner replace mid-hover restores the held title, removes the old tooltip, and hands over to the new install.
    const secondDispose = installFastTitles(document, { replace: true, owner: "studio" });
    expect(tip()).toBeNull();
    expect(a.getAttribute("title")).toBe("Reload");
    over(b);
    vi.advanceTimersByTime(FAST_TITLE_DELAY_MS);
    expect(tip()?.textContent).toBe("Close");

    // Different owner does NOT replace an active owner ("first wins").
    const otherDispose = installFastTitles(document, { replace: true, owner: "visual-chat" });
    expect(tip()?.textContent).toBe("Close");
    otherDispose();
    expect(tip()?.textContent).toBe("Close");

    secondDispose();
    firstDispose();
    expect(tip()).toBeNull();
    expect(b.getAttribute("title")).toBe("Close");

    // Legacy `true` marker from an older bundle must not throw on import or install.
    const key = Symbol.for("bb-studio.fast-title");
    (window as unknown as Record<symbol, unknown>)[key] = true;
    vi.resetModules();
    await expect(import("./fast-title")).resolves.toBeDefined();
    expect((window as unknown as Record<symbol, unknown>)[key]).toBe(true);

    // Restore fresh install for subsequent tests.
    delete (window as unknown as Record<symbol, unknown>)[key];
    installFastTitles(document, { replace: true });
  });
});
