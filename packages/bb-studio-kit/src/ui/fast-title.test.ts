// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAST_TITLE_DELAY_MS } from "./fast-title";

const tip = () => document.querySelector("[data-bb-fast-title-tip]");
const over = (el: Element) => el.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
const out = (el: Element, to: Element | null = document.body) =>
  el.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: to }));

describe("fast titles", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <div data-bb-plugin-root>
        <button id="a" title="Reload"><span id="a-icon"></span></button>
        <button id="b" title="Close"></button>
      </div>
      <button id="host" title="Host button"></button>`;
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
});
