// @vitest-environment jsdom
// The canvas opens a design at 100% on its first section and reopens it
// where the user left it (zoom, position, or Fit).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Canvas } from "./canvas";
import { VIEWS_KEY } from "./canvas-view";

vi.mock("../../kit/app/index", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../kit/app/index")>()),
  Icon: () => null,
}));

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  // A 1200×800 viewport over a 6000×9000 board.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800, toJSON: () => ({}) });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(6000);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(9000);
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const board = () => container.querySelector<HTMLElement>("[aria-label^='Canvas'] > div")!;
const zoomLabel = () => container.querySelector<HTMLButtonElement>("button[title^='Zoom to']")!;

async function open(viewKey = "design-1", fitKey = "1:2") {
  await act(async () => root.render(<Canvas fitKey={fitKey} viewKey={viewKey}><div>screens</div></Canvas>));
}
async function close() {
  await act(async () => root.unmount());
  root = createRoot(container);
}

it("opens at 100% on the first section, and stores nothing until the user moves", async () => {
  await open();
  expect(board().style.transform).toBe("translate(64px, 72px) scale(1)");
  expect(zoomLabel().textContent).toBe("100%");
  await close();
  expect(localStorage.getItem(VIEWS_KEY)).toBeNull();
});

it("reopens a design at the zoom the user left it at; another design still opens at 100%", async () => {
  await open();
  await act(async () => container.querySelector<HTMLButtonElement>("button[aria-label='Zoom in']")!.click());
  expect(zoomLabel().textContent).toBe("125%");
  await close();
  await open();
  expect(zoomLabel().textContent).toBe("125%");
  await close();
  await open("design-2");
  expect(zoomLabel().textContent).toBe("100%");
});

it("keeps Fit as a choice: it fits, is remembered, and the same control goes back to 100%", async () => {
  await open();
  await act(async () => zoomLabel().click());
  expect(zoomLabel().textContent).toBe("7%");
  expect(zoomLabel().title).toBe("Zoom to 100%");
  await close();
  await open();
  expect(zoomLabel().textContent).toBe("7%");
  await act(async () => zoomLabel().click());
  expect(board().style.transform).toBe("translate(64px, 72px) scale(1)");
  expect(zoomLabel().title).toBe("Zoom to fit");
});
