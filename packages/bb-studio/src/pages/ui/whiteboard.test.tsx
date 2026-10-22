// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ ui: { whiteboard: vi.fn(), saveWhiteboard: vi.fn() } }));
vi.mock("./context", () => ({ usePagesUi: () => state.ui }));
vi.mock("../../kit/ui/index", () => ({ Icon: () => null, cn: (...values: unknown[]) => values.filter(Boolean).join(" ") }));

import { Whiteboard } from "./whiteboard";

const view = { id: "drawing_1", name: "Sketch", updatedAt: 1, viewBox: null, markup: "" };
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  state.ui.whiteboard.mockReset().mockResolvedValue(view);
  state.ui.saveWhiteboard.mockReset()
    .mockRejectedValueOnce(new Error("Disk full"))
    .mockResolvedValue(view);
  Object.defineProperty(SVGElement.prototype, "setPointerCapture", { configurable: true, value: vi.fn() });
  Object.defineProperty(SVGElement.prototype, "getScreenCTM", { configurable: true, value: () => ({ inverse: () => ({}) }) });
  vi.stubGlobal("DOMPoint", class {
    constructor(public x: number, public y: number) {}
    matrixTransform() { return this; }
  });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find((each) => each.textContent?.includes(label));
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

function pointer(type: string, values: Record<string, number>) {
  const event = new Event(type, { bubbles: true });
  for (const [key, value] of Object.entries(values)) Object.defineProperty(event, key, { value, configurable: true });
  return event;
}

it("keeps a failed stroke visible and retries the same stroke id", async () => {
  act(() => root.render(<Whiteboard id="drawing_1" onOpen={() => {}} />));
  await act(async () => { await Promise.resolve(); });
  act(() => button("Sketch").click());
  const svg = host.querySelector<SVGSVGElement>("svg[data-whiteboard]")!;
  act(() => svg.dispatchEvent(pointer("pointerdown", { button: 0, pointerId: 1, clientX: 10, clientY: 10, buttons: 1 })));
  act(() => svg.dispatchEvent(pointer("pointermove", { pointerId: 1, clientX: 20, clientY: 20, buttons: 1 })));
  act(() => svg.dispatchEvent(new Event("pointerup", { bubbles: true })));
  await act(async () => { await vi.advanceTimersByTimeAsync(400); await Promise.resolve(); });

  expect(state.ui.saveWhiteboard).toHaveBeenCalledOnce();
  expect(host.textContent).toContain("Changes weren’t saved.");
  expect(host.querySelectorAll("svg polyline")).toHaveLength(1);
  const failed = state.ui.saveWhiteboard.mock.calls[0]![0] as { add: { id: string }[] };
  expect(failed.add[0]!.id).toMatch(/^pg_/);

  await act(async () => { button("Retry save").click(); await Promise.resolve(); await Promise.resolve(); });
  expect(state.ui.saveWhiteboard).toHaveBeenCalledTimes(2);
  expect(state.ui.saveWhiteboard.mock.calls[1]![0]).toEqual(state.ui.saveWhiteboard.mock.calls[0]![0]);
  expect(host.querySelector("svg polyline")).toBeNull();
  expect(host.textContent).not.toContain("Retry save");
});
