// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { talk } from "./controller";
import { inlineMic, mountInlineDock, useInlineDictation } from "./inline-dictation";

vi.mock("./controller", () => ({ talk: { dictationComposer: vi.fn(), subscribe: vi.fn() } }));

let root: Root | undefined;
let changed: () => void;
const rect = { x: 10, y: 600, left: 10, top: 600, right: 610, bottom: 640, width: 600, height: 40, toJSON() {} };
function composer() {
  const box = document.createElement("form");
  box.setAttribute("data-promptbox", "");
  box.innerHTML = '<div data-promptbox-action-row><div data-promptbox-standard-actions><button aria-label="Start voice input">Mic</button><button>Send</button></div></div>';
  document.body.append(box);
  return box;
}
function Probe({ enabled }: { enabled: boolean }) {
  const slot = useInlineDictation(enabled);
  return createElement("span", { "data-test-docked": Boolean(slot) });
}
async function render(enabled: boolean) {
  if (!root) { const container = document.createElement("div"); document.body.append(container); root = createRoot(container); }
  await act(async () => root!.render(createElement(Probe, { enabled })));
}
async function sync() { await act(async () => { changed(); await vi.advanceTimersByTimeAsync(20); }); }
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 16));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => rect);
  vi.mocked(talk.subscribe).mockImplementation(listener => { changed = listener; return () => {}; });
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined; document.body.innerHTML = "";
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe("inline dictation placement", () => {
  it("uses only the visible source input, never another input on screen", () => {
    const source = composer(); composer();
    expect(inlineMic(source)).toBe(source.querySelector("button"));
    source.hidden = true; expect(inlineMic(source)).toBeNull();
    source.hidden = false; source.setAttribute("inert", ""); expect(inlineMic(source)).toBeNull();
    source.removeAttribute("inert");
    vi.spyOn(source.querySelector("button")!, "getBoundingClientRect").mockReturnValue({ ...rect, top: 2000, bottom: 2040 });
    expect(inlineMic(source)).toBeNull();
    source.remove(); expect(inlineMic(source)).toBeNull();
  });

  it("restores the mic and native toolbar without changing their contents", () => {
    const source = composer(); const before = source.innerHTML;
    const dock = mountInlineDock(source.querySelector("button")!);
    expect(dock.host.nextElementSibling).toBe(dock.mic);
    expect(dock.mic.hasAttribute("data-talk-inline-mic")).toBe(true);
    dock.remove(); expect(source.innerHTML).toBe(before);
  });

  it("uses the global controls when a compact composer clips the inline dock", () => {
    const source = composer(); source.style.overflow = "hidden";
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
      return this === source ? { ...rect, bottom: 620, height: 20 } : rect;
    });
    expect(inlineMic(source)).toBeNull();
    source.style.overflow = "visible";
    expect(inlineMic(source)).toBe(source.querySelector("button"));
  });

  it("pops out on navigation and redocks when the source input remounts", async () => {
    const source = composer(); vi.mocked(talk.dictationComposer).mockReturnValue(source);
    await render(true); expect(source.querySelector("[data-talk-inline-host]")).not.toBeNull();
    vi.mocked(talk.dictationComposer).mockReturnValue(null); await sync();
    expect(source.querySelector("[data-talk-inline-mic]")).toBeNull();
    expect(document.querySelector("[data-test-docked]")?.getAttribute("data-test-docked")).toBe("false");
    source.remove(); const remount = composer(); vi.mocked(talk.dictationComposer).mockReturnValue(remount); await sync();
    expect(remount.querySelector("[data-talk-inline-host]")).not.toBeNull();
  });

  it("releases the input while expanded and returns when collapsed", async () => {
    const source = composer(); vi.mocked(talk.dictationComposer).mockReturnValue(source);
    await render(true); await render(false);
    expect(source.querySelector("[data-talk-inline-host]")).toBeNull();
    expect(source.querySelector("[data-talk-inline-mic]")).toBeNull();
    await render(true); expect(source.querySelector("[data-talk-inline-host]")).not.toBeNull();
  });
});
