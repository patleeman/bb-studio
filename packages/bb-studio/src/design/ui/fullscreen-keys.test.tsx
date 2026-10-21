// @vitest-environment jsdom
// Space and the slide keys on the design canvas and in the full-screen
// player must never take a key typed into the composer, a comment box or any
// other text field in BB.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Canvas } from "./canvas";
import { PlayView } from "./play-view";
import type { ScreenView } from "../shared";

vi.mock("../../kit/app/index", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../kit/app/index")>()),
  Icon: () => null,
}));

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

/** Text fields outside the design, like BB's composer and a comment box. */
function fields() {
  const host = document.createElement("div");
  host.innerHTML = `<input aria-label="Comment"><textarea aria-label="Reply"></textarea><div contenteditable="true" role="textbox" aria-label="Composer"><p>Hi</p></div>`;
  document.body.append(host);
  return {
    input: host.querySelector("input")!,
    textarea: host.querySelector("textarea")!,
    composer: host.querySelector<HTMLElement>("[contenteditable]")!,
  };
}

/** Dispatches a key and reports whether something called preventDefault, which would stop it typing. */
function press(target: EventTarget, key: string, code = key === " " ? "Space" : key) {
  const event = new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true, composed: true });
  act(() => { target.dispatchEvent(event); });
  return event.defaultPrevented;
}

const release = (target: EventTarget) => act(() => { target.dispatchEvent(new KeyboardEvent("keyup", { key: " ", code: "Space", bubbles: true })); });

const deck: ScreenView = {
  id: "pitch", round: 1, option: "a", title: "Pitch", caption: "", viewport: "slide", updatedAt: 1, url: "",
  steps: [{ id: "one", label: "One" }, { id: "two", label: "Two" }, { id: "three", label: "Three" }],
};

async function renderCanvas() {
  await act(async () => root.render(<Canvas fitKey="k"><div>screens</div></Canvas>));
  const viewport = container.querySelector<HTMLElement>("[aria-label^='Canvas']")!;
  // The canvas only pans with the pointer over it, as when it fills the screen.
  act(() => { viewport.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, relatedTarget: document.body })); });
  return viewport;
}

it("canvas: Space in an input, a textarea or the contenteditable composer still types", async () => {
  const viewport = await renderCanvas();
  const { input, textarea, composer } = fields();
  for (const field of [input, textarea, composer, composer.querySelector("p")!]) {
    expect(press(field, " ")).toBe(false);
    expect(viewport.className).not.toContain("cursor-grab");
    release(field);
  }
});

it("canvas: Space with focus on the canvas or on nothing still pans", async () => {
  const viewport = await renderCanvas();
  expect(press(document.body, " ")).toBe(true);
  expect(viewport.className).toContain("cursor-grab");
  release(document.body);
  expect(viewport.className).not.toContain("cursor-grab");
  expect(press(viewport.querySelector("div")!, " ")).toBe(true);
  expect(viewport.className).toContain("cursor-grab");
});

it("canvas: Space with focus elsewhere in BB does nothing", async () => {
  await renderCanvas();
  const elsewhere = document.createElement("div");
  elsewhere.tabIndex = 0;
  document.body.append(elsewhere);
  expect(press(elsewhere, " ")).toBe(false);
});

it("full-screen deck: Space and arrows in a text field type and don't change the slide", async () => {
  await act(async () => root.render(<PlayView designId="d1" screen={deck} onClose={() => {}} />));
  const status = () => container.querySelector("[role='status']")!.textContent;
  const { input, textarea, composer } = fields();
  for (const field of [input, textarea, composer, composer.querySelector("p")!]) {
    for (const key of [" ", "ArrowRight", "ArrowLeft", "Home", "End"]) expect(press(field, key)).toBe(false);
  }
  expect(status()).toBe("1 / 3");
});

it("full-screen deck: Space and arrows on the player still step through the slides", async () => {
  await act(async () => root.render(<PlayView designId="d1" screen={deck} onClose={() => {}} />));
  const status = () => container.querySelector("[role='status']")!.textContent;
  expect(press(document.body, " ")).toBe(true);
  expect(status()).toBe("2 / 3");
  expect(press(container.querySelector("[role='dialog']")!, "ArrowRight")).toBe(true);
  expect(status()).toBe("3 / 3");
  expect(press(document.body, "ArrowLeft")).toBe(true);
  expect(status()).toBe("2 / 3");
});
