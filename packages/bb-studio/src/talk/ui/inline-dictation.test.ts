// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { talk } from "./controller";
import { dockLayout, fieldDock, inlineMic, mountInlineDock, readDockLayout, useInlineDictation } from "./inline-dictation";

vi.mock("./controller", () => ({ talk: { dictationComposer: vi.fn(), subscribe: vi.fn(), getState: vi.fn(() => ({ field: null })) } }));

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
  it("picks the layout from the composer's width", () => {
    expect(dockLayout(800)).toBe("wide");
    expect(dockLayout(640)).toBe("wide");
    expect(dockLayout(600)).toBe("compact");
    expect(dockLayout(439)).toBe("tight");
  });

  it("tucks the composer's other actions away in a narrow composer, keeping the mic and send", () => {
    const source = document.createElement("form");
    source.setAttribute("data-promptbox", "");
    source.innerHTML = '<div data-promptbox-action-row><div data-promptbox-standard-actions><button aria-label="Expand composer">E</button><span data-plugin-action><button title="Hands-free voice">H</button></span><span><button aria-label="Start voice input">Mic</button></span><div data-promptbox-submit-group><button type="submit" aria-label="Submit">Send</button></div></div></div>';
    document.body.append(source);
    const before = source.innerHTML;
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(() => ({ ...rect, width: 568, right: 578 }));
    const dock = mountInlineDock(source.querySelector<HTMLButtonElement>('[aria-label="Start voice input"]')!);
    const { layout, tucked } = readDockLayout(dock.host);
    expect(layout).toBe("compact");
    expect(tucked.map((action) => action.label)).toEqual(["Expand composer", "Hands-free voice"]);
    expect(source.querySelector("[data-promptbox-action-row]")!.hasAttribute("data-talk-inline-narrow")).toBe(true);
    expect(source.querySelectorAll("[data-talk-inline-tucked]")).toHaveLength(2);
    expect(source.querySelector("[data-promptbox-submit-group]")!.hasAttribute("data-talk-inline-tucked")).toBe(false);
    expect(dock.host.getAttribute("data-talk-inline-layout")).toBe("compact");
    dock.remove();
    expect(source.innerHTML).toBe(before);
  });

  it("docks into another plugin's dictation field that offers a dock", async () => {
    const field = document.createElement("form");
    field.setAttribute("data-talk-field", "canvas:new");
    field.innerHTML = '<input><span data-talk-field-dock></span><button aria-label="Dictate">Mic</button>';
    document.body.append(field);
    expect(fieldDock("canvas:other")).toBeNull();
    expect(fieldDock("canvas:new")).toBe(field.querySelector("[data-talk-field-dock]"));
    vi.mocked(talk.getState).mockReturnValue({ field: { key: "canvas:new", label: "the new canvas" } } as never);
    await render(true);
    const host = field.querySelector("[data-talk-field-dock] > [data-talk-inline-host]") as HTMLElement | null;
    expect(host).not.toBeNull();
    expect(readDockLayout(host).layout).toBe("compact");
    expect(document.querySelector("[data-test-docked]")?.getAttribute("data-test-docked")).toBe("true");
    field.hidden = true; await sync();
    expect(field.querySelector("[data-talk-inline-host]")).toBeNull();
    vi.mocked(talk.getState).mockReturnValue({ field: null } as never);
  });

  it("keeps every action in a wide composer", () => {
    const source = composer();
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(() => ({ ...rect, width: 900, right: 910 }));
    const dock = mountInlineDock(source.querySelector("button")!);
    expect(readDockLayout(dock.host)).toEqual({ layout: "wide", tucked: [] });
    expect(source.querySelector("[data-talk-inline-narrow]")).toBeNull();
    dock.remove();
  });

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
