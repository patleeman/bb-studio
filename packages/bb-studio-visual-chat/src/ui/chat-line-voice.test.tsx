// @vitest-environment jsdom
// The chat line's dictation mic and hands-free button are Studio's, answered
// from BB's main window. In the plugin's own window they can't work, so they
// are not drawn there; everywhere else they stay.
import { act, type ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@get-bb/plugin-sdk/app", () => ({ useRpc: () => ({ call: async () => ({}) }), useRealtime: () => {}, useSdk: () => ({}), useSettings: () => ({ values: {} }) }));
vi.mock("./studio", () => ({
  cn: (...parts: unknown[]) => parts.filter((part) => typeof part === "string").join(" "),
  Icon: () => null, Markdown: () => null, WidgetBody: () => null, ScrollBody: () => null,
  openAppPath: () => {}, errorMessage: String, useWidgetTheme: () => ({}),
  INSERT_EVENT: "bb-talk:insert", STATE_EVENT: "bb-talk:state", TOGGLE_EVENT: "bb-talk:toggle", HANDSFREE_START_EVENT: "bb-studio:handsfree-start",
}));

interface Root { render(node: unknown): void; unmount(): void }
const reactDom = "react-dom/client";
const { createRoot } = (await import(/* @vite-ignore */ reactDom)) as { createRoot(host: Element): Root };
const { CanvasNavContext, ChatLine } = await import("./route");

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const timeline = { position: 0, total: 0 } as ComponentProps<typeof ChatLine>["timeline"];
const line = <ChatLine threadId={null} canvas={null} pending={null} working={false} timeline={timeline} steps={null} onSubmit={async () => {}} onVoice={async () => {}} onHeight={() => {}} />;
const buttons = () => [...host.querySelectorAll("[data-canvas-voice]")].map((button) => button.getAttribute("aria-label"));

it("draws the mic and hands-free on the page", async () => {
  await act(async () => { root.render(line); });
  expect(buttons()).toEqual(["Dictate", "Hands-free voice"]);
  expect(host.querySelector("[data-canvas-input]")).not.toBeNull();
});

it("draws neither in the plugin's own window, and keeps the field", async () => {
  await act(async () => { root.render(<CanvasNavContext.Provider value={{ open: () => {}, openThread: () => {}, voice: false }}>{line}</CanvasNavContext.Provider>); });
  expect(buttons()).toEqual([]);
  expect(host.querySelector("[data-canvas-input]")).not.toBeNull();
});

it("is a composer like BB's: a rounded box, a multi-line field and a send button; Enter sends, Shift+Enter does not", async () => {
  const sent: string[] = [];
  await act(async () => { root.render(<ChatLine threadId={null} canvas={null} pending={null} working={false} timeline={timeline} steps={null} onSubmit={async (text) => { sent.push(text); }} onVoice={async () => {}} onHeight={() => {}} model={<span data-model />} />); });
  const box = host.querySelector<HTMLElement>("[data-canvas-composer]")!;
  expect(box.className).toContain("rounded-xl");
  expect(box.className).toContain("border");
  const field = host.querySelector<HTMLTextAreaElement>("textarea[data-canvas-input]")!;
  const send = host.querySelector<HTMLButtonElement>("[data-canvas-send]")!;
  expect(send.className).toContain("size-7");
  expect(send.disabled).toBe(true);
  // The model control sits in the row under the field.
  expect(host.querySelector("[data-canvas-composer-row] [data-model]")).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "Plan Rome");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(send.disabled).toBe(false);
  await act(async () => { field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true })); });
  expect(sent).toEqual([]);
  await act(async () => { field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
  expect(sent).toEqual(["Plan Rome"]);
  expect(field.value).toBe("");
});
