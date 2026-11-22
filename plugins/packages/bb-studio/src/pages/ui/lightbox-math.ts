/**
 * The image lightbox's view: one scale (screen pixels per image pixel) and
 * the image's top-left corner on screen. Pure, so it is unit-tested apart
 * from the DOM (lightbox-math.test.ts).
 */
export type Size = { width: number; height: number };
export type View = { scale: number; x: number; y: number };

/** Room kept around a fitted image. */
export const FIT_MARGIN = 32;
/** Zoom in up to 8× the fitted size, or 4× the image's own pixels when that is more. */
export const MAX_FIT_ZOOM = 8;
export const MAX_NATIVE_ZOOM = 4;
/** One + or - key press, or one wheel notch's worth. */
export const KEY_STEP = 1.5;

/** The scale that fits the whole image in the viewport, never above its own size. */
export function fitScale(image: Size, viewport: Size): number {
  if (!image.width || !image.height) return 1;
  const room = { width: Math.max(1, viewport.width - FIT_MARGIN * 2), height: Math.max(1, viewport.height - FIT_MARGIN * 2) };
  return Math.min(1, room.width / image.width, room.height / image.height);
}

export function maxScale(image: Size, viewport: Size): number {
  return Math.max(fitScale(image, viewport) * MAX_FIT_ZOOM, MAX_NATIVE_ZOOM);
}

/** The fitted image, centred. */
export function fitView(image: Size, viewport: Size): View {
  const scale = fitScale(image, viewport);
  return { scale, x: (viewport.width - image.width * scale) / 2, y: (viewport.height - image.height * scale) / 2 };
}

export function isFit(view: View, image: Size, viewport: Size): boolean {
  return view.scale <= fitScale(image, viewport) + 1e-6;
}

/**
 * Keeps the image on screen: an axis smaller than the viewport is centred on
 * it, a larger one can't be dragged past its edges.
 */
export function clampView(view: View, image: Size, viewport: Size): View {
  const scale = Math.min(maxScale(image, viewport), Math.max(fitScale(image, viewport), view.scale));
  const axis = (position: number, length: number, room: number) =>
    length <= room ? (room - length) / 2 : Math.min(0, Math.max(room - length, position));
  return {
    scale,
    x: axis(view.x, image.width * scale, viewport.width),
    y: axis(view.y, image.height * scale, viewport.height),
  };
}

/** Zooms to `scale`, keeping the image point under `anchor` (a viewport point) where it is. */
export function zoomTo(view: View, scale: number, anchor: { x: number; y: number }, image: Size, viewport: Size): View {
  const next = Math.min(maxScale(image, viewport), Math.max(fitScale(image, viewport), scale));
  const ratio = next / view.scale;
  return clampView(
    { scale: next, x: anchor.x - (anchor.x - view.x) * ratio, y: anchor.y - (anchor.y - view.y) * ratio },
    image,
    viewport,
  );
}

export function zoomBy(view: View, factor: number, anchor: { x: number; y: number }, image: Size, viewport: Size): View {
  return zoomTo(view, view.scale * factor, anchor, image, viewport);
}

export function panBy(view: View, dx: number, dy: number, image: Size, viewport: Size): View {
  return clampView({ ...view, x: view.x + dx, y: view.y + dy }, image, viewport);
}

/**
 * A wheel event's zoom factor. A trackpad pinch arrives as a ctrl-wheel with
 * small deltas; a mouse wheel notch is about 100 pixels.
 */
export function wheelFactor(deltaY: number, deltaMode: number): number {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  const clamped = Math.max(-100, Math.min(100, pixels));
  return Math.exp(-clamped * 0.01);
}

/** Double-click: from the fit, zoom in on the point; zoomed in, back to the fit. */
export function doubleClickView(view: View, anchor: { x: number; y: number }, image: Size, viewport: Size): View {
  if (!isFit(view, image, viewport)) return fitView(image, viewport);
  const fit = fitScale(image, viewport);
  // Show the image's own pixels when it was shrunk to fit, else 2.5× the fit.
  const target = fit < 0.4 ? 1 : fit * 2.5;
  return zoomTo(view, target, anchor, image, viewport);
}

/** The next index stepping by `delta`, or null at either end. */
export function stepIndex(index: number, delta: number, count: number): number | null {
  const next = index + delta;
  return next >= 0 && next < count ? next : null;
}
