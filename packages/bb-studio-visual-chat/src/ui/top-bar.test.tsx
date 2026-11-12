// @vitest-environment jsdom
// The header: a faint bar on the page in BB's main view, and the window's
// title bar (one draggable row, after the traffic lights) with the window's
// shortcuts in a window of its own.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const CHATS = [
  { id: "cnv_1", threadId: "thr_rome", title: "Rome in three days", itemCount: 4, updatedAt: 2 },
  { id: "cnv_2", threadId: "thr_games", title: "Retro games", itemCount: 2, updatedAt: 1 },
];
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useRpc: () => ({ call: async (method: string) => (method === "canvas.list" ? { canvases: CHATS } : { providers: [] }) }),
}));
vi.mock("./studio", () => ({
  cn: (...parts: unknown[]) => parts.filter((part) => typeof part === "string").join(" "),
  Icon: () => null, openAppPath: () => {}, errorMessage: String,
}));
vi.mock("sonner", () => ({ toast: { error() {}, message() {} } }));

interface Root { render(node: unknown): void; unmount(): void }
const reactDom = "react-dom/client";
const { createRoot } = (await import(/* @vite-ignore */ reactDom)) as { createRoot(host: Element): Root };
const { CanvasNavContext } = await import("./nav");
const { TopBar, TRAFFIC_LIGHTS_INSET } = await import("./top-bar");
type Nav = import("./nav").CanvasNav;

const canvas = { threadId: "thr_rome", title: "Rome in three days", execution: { providerId: "claude-code", model: "claude-sonnet-5-5", reasoningLevel: null }, pendingExecution: null } as never;

let root: Root;
let host: HTMLDivElement;
let calls: string[];
function nav(window?: { inset: boolean }): Nav {
  return {
    open: (threadId) => { calls.push(`open ${threadId ?? "new"}`); },
    ...(window ? { openThread: (threadId: string) => { calls.push(`thread ${threadId}`); }, voice: false, window: { inset: window.inset, close: () => { calls.push("close"); } } } : {}),
  };
}
async function mount(value: Nav) {
  // The header finds the message box in its page.
  await act(async () => {
    root.render(
      <CanvasNavContext.Provider value={value}>
        <div data-canvas-page><TopBar canvas={canvas} /><textarea data-canvas-input /></div>
      </CanvasNavContext.Provider>,
    );
  });
}
const header = () => host.querySelector<HTMLElement>("[data-canvas-header]")!;
const press = (key: string, mods: KeyboardEventInit = {}, target: EventTarget = document.body) => act(async () => {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods }));
});
const type = (field: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
});
const search = () => host.querySelector<HTMLInputElement>("[data-canvas-chat-search]");
const options = () => [...host.querySelectorAll("[data-canvas-chat-option]")].map((option) => option.getAttribute("data-canvas-chat-option"));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  calls = [];
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("is a plain bar on the page in BB's main window: no drag region, no inset, no shortcuts, no Prototype pill", async () => {
  await mount(nav());
  expect(header().dataset.canvasHeader).toBe("page");
  expect(header().classList.contains("canvas-titlebar")).toBe(false);
  expect(header().style.paddingLeft).toBe("");
  expect(host.querySelector("[data-canvas-help]")).toBeNull();
  expect(host.querySelector("[data-canvas-open-thread]")).toBeNull();
  // The model is in the composer there, not in the header.
  expect(header().querySelector("[data-canvas-model-picker]")).toBeNull();
  expect(host.textContent).not.toMatch(/prototype/i);
  // BB's own keys stay BB's.
  for (const [key, mods] of [["n", {}], ["k", {}], ["l", {}], ["w", {}], ["O", { shiftKey: true }]] as const) {
    const event = new KeyboardEvent("keydown", { key, metaKey: true, bubbles: true, cancelable: true, ...mods });
    await act(async () => { document.body.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(false);
  }
  expect(calls).toEqual([]);
  expect(search()).toBeNull();
});

it("is the window's title bar in a window: one draggable row after the traffic lights, with every control in order", async () => {
  await mount(nav({ inset: true }));
  expect(header().dataset.canvasHeader).toBe("window");
  expect(header().classList.contains("canvas-titlebar")).toBe(true);
  expect(header().classList.contains("h-10")).toBe(true);
  expect(header().style.paddingLeft).toBe(`${TRAFFIC_LIGHTS_INSET}px`);
  expect(host.querySelectorAll("[data-canvas-header]")).toHaveLength(1);
  const order = [...header().querySelectorAll("[data-canvas-chat-picker], [data-canvas-model-picker], [data-canvas-open-thread], [data-canvas-new-chat], [data-canvas-help]")].map((element) => Object.keys((element as HTMLElement).dataset)[0]);
  // The model is shown in one place only, the composer's row: never in the header.
  expect(order).toEqual(["canvasChatPicker", "canvasOpenThread", "canvasNewChat", "canvasHelp"]);
  expect(header().querySelector("[data-canvas-model-picker]")).toBeNull();
  expect(host.textContent).not.toMatch(/prototype/i);
  // The row drags the window; what can be clicked in it does not.
  const css = readFileSync(join(process.cwd(), "src/ui/canvas.css"), "utf8");
  expect(css).toMatch(/\.canvas-titlebar \{[^}]*-webkit-app-region: drag/);
  expect(css).toMatch(/\.canvas-titlebar :where\([^)]*button[^}]*-webkit-app-region: no-drag/);
});

it("leaves no room for traffic lights in a browser popup", async () => {
  await mount(nav({ inset: false }));
  expect(header().classList.contains("canvas-titlebar")).toBe(true);
  expect(header().style.paddingLeft).toBe("12px");
});

it("runs the window's shortcuts", async () => {
  await mount(nav({ inset: true }));
  await press("n", { metaKey: true });
  await press("O", { metaKey: true, shiftKey: true });
  await press("w", { metaKey: true });
  expect(calls).toEqual(["open new", "thread thr_rome", "close"]);
  await press("l", { metaKey: true });
  expect(document.activeElement).toBe(host.querySelector("[data-canvas-input]"));
  // Ctrl is not the modifier on a Mac.
  await press("n", { ctrlKey: true });
  expect(calls).toHaveLength(3);
});

it("opens the chat picker on Cmd+K with its search focused; Esc clears the search, then closes the picker", async () => {
  await mount(nav({ inset: true }));
  await press("k", { metaKey: true });
  await act(async () => {});
  expect(document.activeElement).toBe(search());
  expect(options()).toEqual(["thr_rome", "thr_games"]);
  await type(search()!, "retro");
  expect(options()).toEqual(["thr_games"]);
  await press("Escape", {}, search()!);
  expect(search()!.value).toBe("");
  expect(options()).toEqual(["thr_rome", "thr_games"]);
  await press("Escape", {}, search()!);
  expect(search()).toBeNull();
  expect(document.activeElement).toBe(host.querySelector("[data-canvas-chat-picker]"));
  // Enter opens the match.
  await press("k", { metaKey: true });
  await act(async () => {});
  await type(search()!, "retro");
  await press("Enter", {}, search()!);
  expect(calls).toEqual(["open thr_games"]);
  expect(search()).toBeNull();
});

it("clears the picker's search with Esc on the page too", async () => {
  await mount(nav());
  await act(async () => { host.querySelector<HTMLElement>("[data-canvas-chat-picker]")!.click(); });
  await act(async () => {});
  await type(search()!, "rome");
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  const outside = vi.fn();
  window.addEventListener("keydown", outside);
  await act(async () => { search()!.dispatchEvent(escape); });
  window.removeEventListener("keydown", outside);
  expect(search()!.value).toBe("");
  // The key is the field's: it never reaches BB's own Esc.
  expect(escape.defaultPrevented).toBe(true);
  expect(outside).not.toHaveBeenCalled();
  await press("Escape", {}, search()!);
  expect(search()).toBeNull();
});

it("lists the shortcuts under ?", async () => {
  await mount(nav({ inset: true }));
  expect(host.querySelector("[data-canvas-help-menu]")).toBeNull();
  await act(async () => { host.querySelector<HTMLElement>("[data-canvas-help]")!.click(); });
  const rows = Object.fromEntries([...host.querySelectorAll("[data-canvas-shortcut]")].map((row) => [row.getAttribute("data-canvas-shortcut"), row.querySelector("dd")!.textContent]));
  expect(rows).toMatchObject({ "new-chat": "⌘N", "switch-chat": "⌘K", "focus-input": "⌘L", "open-thread": "⇧⌘O", "close-window": "⌘W", escape: "Esc" });
  await press("Escape");
  expect(host.querySelector("[data-canvas-help-menu]")).toBeNull();
});
