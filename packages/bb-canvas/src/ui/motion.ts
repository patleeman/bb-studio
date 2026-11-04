// The board's motion, with the Web Animations API (no animation library):
// enter fades and scales up, a move glides (FLIP from the old cell), an
// update flashes a highlight while its content cross-fades, and an exit
// fades and shrinks. With prefers-reduced-motion, nothing moves: changes
// only fade, quickly.

export interface Rect { left: number; top: number; width: number; height: number }

export const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
export const MOVE_MS = 560;
export const ENTER_MS = 460;
export const EXIT_MS = 340;
export const UPDATE_MS = 1400;
export const FADE_MS = 360;
/** Items that arrive together come in one after another. */
export const STAGGER_MS = 70;

export function reducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const can = (element: Element | null): element is HTMLElement => !!element && typeof (element as HTMLElement).animate === "function";

/** A new item: fade in and scale up from a little below. */
export function enter(element: Element | null, index = 0): void {
  if (!can(element)) return;
  if (reducedMotion()) { element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, fill: "backwards" }); return; }
  element.animate(
    [{ opacity: 0, transform: "translateY(10px) scale(0.92)" }, { opacity: 1, transform: "none" }],
    { duration: ENTER_MS, delay: index * STAGGER_MS, easing: EASE, fill: "backwards" },
  );
}

/** A moved or resized item: glide from where it was (FLIP). */
export function move(element: Element | null, from: Rect, to: Rect): void {
  if (!can(element) || reducedMotion()) return;
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  if (!dx && !dy && from.width === to.width && from.height === to.height) return;
  element.animate(
    [
      { transform: `translate(${dx}px, ${dy}px)`, width: `${from.width}px`, height: `${from.height}px` },
      { transform: "translate(0, 0)", width: `${to.width}px`, height: `${to.height}px` },
    ],
    { duration: MOVE_MS, easing: EASE },
  );
}

/** A changed item: a brief ring of the accent color. */
export function highlight(element: Element | null): void {
  if (!can(element)) return;
  const ring = "0 0 0 2px color-mix(in oklab, var(--primary, #6366f1) 70%, transparent), 0 8px 30px -8px color-mix(in oklab, var(--primary, #6366f1) 45%, transparent)";
  if (reducedMotion()) { element.animate([{ boxShadow: ring }, { boxShadow: ring }], { duration: 700 }); return; }
  element.animate([{ boxShadow: ring, offset: 0 }, { boxShadow: ring, offset: 0.35 }, { boxShadow: "0 0 0 0 transparent" }], { duration: UPDATE_MS, easing: "ease-out" });
}

/** Content changing in place: the old copy fades out over the new. */
export function fadeOut(element: Element | null, done: () => void): void {
  if (!can(element)) { done(); return; }
  const animation = element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reducedMotion() ? 120 : FADE_MS, easing: "ease-out", fill: "forwards" });
  animation.onfinish = done;
  animation.oncancel = done;
}

export function fadeIn(element: Element | null): void {
  if (!can(element)) return;
  element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reducedMotion() ? 120 : FADE_MS, easing: "ease-in", fill: "backwards" });
}

/** A removed item, drawn where it was: fade and shrink, then gone. */
export function exit(element: Element | null, done: () => void, index = 0): void {
  if (!can(element)) { done(); return; }
  const animation = reducedMotion()
    ? element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: "forwards" })
    : element.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(0.9)" }], { duration: EXIT_MS, delay: index * 30, easing: "ease-in", fill: "forwards" });
  animation.onfinish = done;
  animation.oncancel = done;
}

/** A style switch: the card dips and comes back in its new style, one after another. */
export function restyle(element: Element | null, index = 0): void {
  if (!can(element)) return;
  if (reducedMotion()) { element.animate([{ opacity: 0.6 }, { opacity: 1 }], { duration: 200 }); return; }
  element.animate(
    [{ opacity: 0.35, filter: "saturate(0.4)" }, { opacity: 1, filter: "none" }],
    { duration: 700, delay: 120 + index * 40, easing: EASE, fill: "backwards" },
  );
}
