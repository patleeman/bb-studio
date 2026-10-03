// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useItemDrag } from "./useItemDrag";

vi.mock("@bb-studio/kit/app", async () => await import("../../bb-studio-kit/src/app/studio-item"));

let root: Root;
let container: HTMLDivElement;
let source: HTMLAnchorElement;
const data = () => ({ types: ["application/x-bb-studio-target"], setData: vi.fn(), effectAllowed: "" });
const dragging = () => container.querySelector("output")?.textContent === "true";
const drag = async (type: string, target: EventTarget = source) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: data() });
  await act(() => target.dispatchEvent(event));
};

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); source = document.createElement("a");
  source.href = "/plugins/pages/pages/pg_test";
  document.body.append(container, source); root = createRoot(container);
  function State() { return <output>{String(useItemDrag())}</output>; }
  await act(() => root.render(<State />));
});
afterEach(async () => { await act(() => root.unmount()); container.remove(); source.remove(); vi.unstubAllGlobals(); });

it.each(["drop", "dragend"])("clears the drop zone when a child stops %s propagation", async type => {
  await drag("dragstart"); expect(dragging()).toBe(true);
  source.addEventListener(type, event => event.stopPropagation());
  await drag(type); expect(dragging()).toBe(false);
});

it("recovers after a removed source loses dragend and ordinary pointer movement resumes", async () => {
  await drag("dragstart"); source.remove();
  await act(() => document.dispatchEvent(new MouseEvent("pointermove", { buttons: 1, bubbles: true })));
  expect(dragging()).toBe(true);
  await act(() => document.dispatchEvent(new MouseEvent("pointermove", { buttons: 0, bubbles: true })));
  expect(dragging()).toBe(false);
});

it("clears a cancelled drag on Escape", async () => {
  await drag("dragstart");
  await act(() => source.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(dragging()).toBe(false);
});

it("clears a drag when the window loses focus and can accept a returning drag", async () => {
  await drag("dragstart"); await act(() => window.dispatchEvent(new Event("blur")));
  expect(dragging()).toBe(false);
  await drag("dragover"); expect(dragging()).toBe(true);
  await drag("drop"); expect(dragging()).toBe(false);
});

it("clears a drag that leaves the document without hiding it when a child changes", async () => {
  await drag("dragstart");
  await act(() => source.dispatchEvent(new MouseEvent("dragleave", { bubbles: true, relatedTarget: container })));
  expect(dragging()).toBe(true);
  await act(() => document.documentElement.dispatchEvent(new MouseEvent("dragleave", { bubbles: true, relatedTarget: null })));
  expect(dragging()).toBe(false);
});

it("clears a stale overlay before the next ordinary pointer press", async () => {
  await drag("dragstart"); source.remove();
  await act(() => container.dispatchEvent(new MouseEvent("pointerdown", { buttons: 1, bubbles: true })));
  expect(dragging()).toBe(false);
});

it("lets the React drop handler run before the drop zone disappears", async () => {
  const accept = vi.fn();
  function Zone() { return useItemDrag() ? <div onDrop={accept}>Drop here</div> : null; }
  await act(() => root.render(<Zone />));
  await drag("dragstart");
  const zone = container.querySelector("div")!;
  await act(() => zone.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })));
  expect(container.querySelector("div")).toBe(zone);
  await drag("drop", zone);
  expect(accept).toHaveBeenCalledOnce();
  expect(container.querySelector("div")).toBeNull();
});
