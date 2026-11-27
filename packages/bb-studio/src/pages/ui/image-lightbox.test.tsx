// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../../kit/ui/index", () => ({ Icon: () => null, cn: (...values: unknown[]) => values.filter(Boolean).join(" ") }));

import { ImageLightbox, pageImages, type LightboxImage } from "./image-lightbox";

const IMAGES: LightboxImage[] = [
  { src: "https://example.test/one.png", alt: "One", caption: "First" },
  { src: "https://example.test/two.png", alt: "Two", caption: "" },
  { src: "https://example.test/three.png", alt: "Three", caption: "" },
];
const NATURAL = { width: 3840, height: 2160 };

let root: Root;
let host: HTMLDivElement;
let closed: ReturnType<typeof vi.fn<() => void>>;

function Harness({ start = 0 }: { start?: number }) {
  const [index, setIndex] = useState<number | null>(start);
  if (index === null) return null;
  return <ImageLightbox images={IMAGES} index={index} onIndex={setIndex} onClose={() => { closed(); setIndex(null); }} />;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  closed = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get() { return this.dataset?.pagesLightbox === "" ? 1000 : 0; } });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get() { return this.dataset?.pagesLightbox === "" ? 800 : 0; } });
  Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", { configurable: true, get: () => NATURAL.width });
  Object.defineProperty(HTMLImageElement.prototype, "naturalHeight", { configurable: true, get: () => NATURAL.height });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
});

const overlay = () => document.querySelector<HTMLElement>("[data-pages-lightbox]");
const image = () => overlay()!.querySelector("img")!;
const zoom = () => Number(image().dataset.zoom);
const translate = () => image().style.transform.match(/translate3d\((-?[\d.]+)px, (-?[\d.]+)px/)!.slice(1).map(Number) as [number, number];

let opened = 0;
function open(start = 0) {
  act(() => root.render(<Harness key={++opened} start={start} />));
  act(() => { image().dispatchEvent(new Event("load")); });
}
function key(name: string) {
  act(() => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); });
}
function pointer(type: string, target: Element, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(event, "pointerId", { value: 1 });
  act(() => { target.dispatchEvent(event); });
}

it("opens over the page with the image fitted to the window", () => {
  open();
  expect(overlay()?.getAttribute("role")).toBe("dialog");
  expect(image().getAttribute("src")).toBe(IMAGES[0]!.src);
  expect(image().style.width).toBe("3840px");
  expect(image().style.transformOrigin).toBe("0 0");
  expect(zoom()).toBeCloseTo(936 / 3840, 3);
  expect(image().dataset.fit).toBe("true");
  expect(overlay()!.textContent).toContain("1 / 3");
  expect(overlay()!.textContent).toContain("First");
});

it("zooms with + and -, with Ctrl- or Cmd-scroll and pinch, and 0 fits again", () => {
  open();
  const fit = zoom();
  key("+");
  expect(zoom()).toBeCloseTo(fit * 1.5, 3);
  key("-");
  expect(zoom()).toBeCloseTo(fit, 3);
  act(() => { overlay()!.dispatchEvent(new WheelEvent("wheel", { deltaY: -50, ctrlKey: true, clientX: 500, clientY: 400, cancelable: true })); });
  expect(zoom()).toBeGreaterThan(fit);
  const pinched = zoom();
  act(() => { overlay()!.dispatchEvent(new WheelEvent("wheel", { deltaY: -50, metaKey: true, clientX: 500, clientY: 400, cancelable: true })); });
  expect(zoom()).toBeGreaterThan(pinched);
  for (let press = 0; press < 30; press++) key("=");
  expect(zoom()).toBe(4);
  key("0");
  expect(zoom()).toBeCloseTo(fit, 3);
  expect(image().dataset.fit).toBe("true");
});

it("double-click zooms in on the point and double-click again returns to the fit", () => {
  open();
  const fit = zoom();
  act(() => { image().dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 500, clientY: 400 })); });
  expect(zoom()).toBe(1);
  act(() => { image().dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 100, clientY: 100 })); });
  expect(zoom()).toBeCloseTo(fit, 3);
});

it("drags to pan when zoomed, and the drag doesn't close it", () => {
  open();
  act(() => { image().dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 500, clientY: 400 })); });
  const [x, y] = translate();
  pointer("pointerdown", image(), 500, 400);
  pointer("pointermove", image(), 440, 430);
  pointer("pointerup", image(), 440, 430);
  act(() => { image().dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  const [x2, y2] = translate();
  expect(x2).toBeCloseTo(x - 60);
  expect(y2).toBeCloseTo(y + 30);
  // A plain scroll pans too.
  act(() => { overlay()!.dispatchEvent(new WheelEvent("wheel", { deltaX: 20, deltaY: 10, cancelable: true })); });
  expect(translate()).toEqual([x2 - 20, y2 - 10]);
  expect(closed).not.toHaveBeenCalled();
});

it("closes on Esc, on the backdrop and on the close button, but not on the image", () => {
  open();
  act(() => { image().dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  expect(overlay()).not.toBeNull();
  key("Escape");
  expect(overlay()).toBeNull();
  open();
  pointer("pointerdown", overlay()!, 5, 5);
  pointer("pointerup", overlay()!, 5, 5);
  act(() => { overlay()!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  expect(overlay()).toBeNull();
  open();
  act(() => { overlay()!.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click(); });
  expect(overlay()).toBeNull();
  expect(closed).toHaveBeenCalledTimes(3);
});

it("steps through the page's images with the arrow keys and buttons, stopping at the ends", () => {
  open();
  key("ArrowLeft");
  expect(image().getAttribute("src")).toBe(IMAGES[0]!.src);
  key("ArrowRight");
  expect(image().getAttribute("src")).toBe(IMAGES[1]!.src);
  expect(overlay()!.textContent).toContain("2 / 3");
  act(() => { overlay()!.querySelector<HTMLButtonElement>('[aria-label="Next image"]')!.click(); });
  expect(image().getAttribute("src")).toBe(IMAGES[2]!.src);
  expect(overlay()!.querySelector<HTMLButtonElement>('[aria-label="Next image"]')!.disabled).toBe(true);
  key("ArrowRight");
  expect(image().getAttribute("src")).toBe(IMAGES[2]!.src);
  expect(closed).not.toHaveBeenCalled();
});

it("keeps its keys from the page behind it", () => {
  const pageKey = vi.fn();
  document.addEventListener("keydown", pageKey);
  open();
  key("+");
  key("ArrowRight");
  key("x");
  expect(pageKey).toHaveBeenCalledTimes(1);
  document.removeEventListener("keydown", pageKey);
});

it("lists a page's images in order with their captions", () => {
  const field = document.createElement("div");
  field.innerHTML = `
    <div data-content-type="image"><figure class="bn-file-block-content-wrapper"><div class="bn-visual-media-wrapper"><img class="bn-visual-media" src="https://example.test/a.png" alt="A"></div><figcaption class="bn-file-caption">Cap A</figcaption></figure></div>
    <div data-content-type="paragraph"><img src="https://example.test/emoji.png"></div>
    <div data-content-type="image"><div class="bn-file-block-content-wrapper"><div class="bn-visual-media-wrapper"><img class="bn-visual-media" src="https://example.test/b.png" alt=""></div></div></div>`;
  const { images, elements } = pageImages(field);
  expect(images).toEqual([
    { src: "https://example.test/a.png", alt: "A", caption: "Cap A" },
    { src: "https://example.test/b.png", alt: "", caption: "" },
  ]);
  expect(elements).toHaveLength(2);
});
