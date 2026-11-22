import { expect, it } from "vitest";
import { clampView, doubleClickView, fitScale, fitView, isFit, maxScale, panBy, stepIndex, wheelFactor, zoomBy, zoomTo } from "./lightbox-math";

const viewport = { width: 1000, height: 800 };
const big = { width: 3840, height: 2160 };
const small = { width: 200, height: 100 };

it("fits a large image inside the margins, centred, and never upscales a small one", () => {
  expect(fitScale(big, viewport)).toBeCloseTo(936 / 3840);
  const view = fitView(big, viewport);
  expect(view.x).toBeCloseTo(32);
  expect(view.y + big.height * view.scale / 2).toBeCloseTo(400);
  expect(fitScale(small, viewport)).toBe(1);
  expect(fitView(small, viewport)).toEqual({ scale: 1, x: 400, y: 350 });
});

it("caps zoom at 8× the fit or 4× the image's own pixels, whichever is more", () => {
  expect(maxScale(big, viewport)).toBe(4);
  expect(maxScale(small, viewport)).toBe(8);
  const fit = fitView(big, viewport);
  expect(zoomTo(fit, 100, { x: 500, y: 400 }, big, viewport).scale).toBe(4);
  expect(zoomTo(fit, 0.01, { x: 500, y: 400 }, big, viewport).scale).toBeCloseTo(fit.scale);
});

it("zooms about the anchor: the image point under the pointer stays put", () => {
  const fit = fitView(big, viewport);
  const anchor = { x: 300, y: 350 };
  const imagePoint = { x: (anchor.x - fit.x) / fit.scale, y: (anchor.y - fit.y) / fit.scale };
  const zoomed = zoomBy(fit, 3, anchor, big, viewport);
  expect(zoomed.x + imagePoint.x * zoomed.scale).toBeCloseTo(anchor.x);
  expect(zoomed.y + imagePoint.y * zoomed.scale).toBeCloseTo(anchor.y);
});

it("pans a zoomed image but not past its edges, and keeps a fitted one centred", () => {
  const zoomed = zoomTo(fitView(big, viewport), 1, { x: 500, y: 400 }, big, viewport);
  const moved = panBy(zoomed, -100, 50, big, viewport);
  expect(moved.x).toBeCloseTo(zoomed.x - 100);
  expect(moved.y).toBeCloseTo(zoomed.y + 50);
  expect(panBy(zoomed, 1e6, 1e6, big, viewport)).toMatchObject({ x: 0, y: 0 });
  expect(panBy(zoomed, -1e6, -1e6, big, viewport)).toMatchObject({ x: 1000 - 3840, y: 800 - 2160 });
  expect(panBy(fitView(small, viewport), 300, 300, small, viewport)).toEqual(fitView(small, viewport));
  expect(clampView({ scale: 1, x: 5, y: 5 }, small, viewport)).toEqual({ scale: 1, x: 400, y: 350 });
});

it("double-click zooms in from the fit and returns to the fit when zoomed", () => {
  const fit = fitView(big, viewport);
  const zoomed = doubleClickView(fit, { x: 500, y: 400 }, big, viewport);
  expect(zoomed.scale).toBe(1);
  expect(isFit(zoomed, big, viewport)).toBe(false);
  expect(doubleClickView(zoomed, { x: 10, y: 10 }, big, viewport)).toEqual(fit);
  expect(doubleClickView(fitView(small, viewport), { x: 500, y: 400 }, small, viewport).scale).toBe(2.5);
});

it("turns wheel deltas into a zoom factor: up zooms in, down out, a big notch is bounded", () => {
  expect(wheelFactor(-10, 0)).toBeGreaterThan(1);
  expect(wheelFactor(10, 0)).toBeLessThan(1);
  expect(wheelFactor(-3, 1)).toBeCloseTo(wheelFactor(-48, 0));
  expect(wheelFactor(-5000, 0)).toBeCloseTo(Math.E);
});

it("steps through images and stops at either end", () => {
  expect(stepIndex(0, 1, 3)).toBe(1);
  expect(stepIndex(2, 1, 3)).toBeNull();
  expect(stepIndex(0, -1, 3)).toBeNull();
});
