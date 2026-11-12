// Fast tooltips for plain `title` attributes. The browser waits about a
// second before it shows a native title, and draws it in the system style.
// Inside plugin surfaces this shows the title as a styled tooltip after a
// short delay instead, so a `title` on a button works like a real tooltip.
//
// One document listener serves every Studio plugin: the first bundle to load
// installs it. While the pointer is over an element, its `title` moves to
// `data-bb-fast-title` so the native tooltip stays hidden, and it comes back
// when the pointer leaves. React never sees the change.

const INSTALLED = Symbol.for("bb-studio.fast-title");
const SCOPE = "[data-bb-plugin-root]";
const HELD = "data-bb-fast-title";
export const FAST_TITLE_DELAY_MS = 300;
// After a tooltip closes, the next one within this window opens at once, so
// moving along a toolbar reads each button without waiting again.
const SKIP_DELAY_MS = 400;
const GAP = 4;
const EDGE = 8;

type FastTitleWindow = Window & { [INSTALLED]?: true };

export function installFastTitles(doc: Document = document): void {
  const win = doc.defaultView as FastTitleWindow | null;
  if (!win || win[INSTALLED]) return;
  win[INSTALLED] = true;

  let target: HTMLElement | null = null;
  let tip: HTMLDivElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastHiddenAt = -Infinity;

  const release = () => {
    clearTimeout(timer);
    timer = undefined;
    if (target) {
      const title = target.getAttribute(HELD);
      target.removeAttribute(HELD);
      // React may have set a fresh title while the pointer was over it.
      if (title !== null && !target.hasAttribute("title")) target.setAttribute("title", title);
      target = null;
    }
    if (tip?.isConnected) {
      tip.remove();
      lastHiddenAt = Date.now();
    }
  };

  const show = () => {
    timer = undefined;
    if (!target?.isConnected) return release();
    const text = target.getAttribute(HELD);
    if (!text) return;
    tip ??= createTip(doc);
    tip.textContent = text;
    doc.body.appendChild(tip);
    place(tip, target, win);
  };

  doc.addEventListener(
    "pointerover",
    (event) => {
      if ((event as PointerEvent).pointerType === "touch") return;
      const el = titled(event.target);
      if (el === target) return;
      release();
      if (!el) return;
      target = el;
      target.setAttribute(HELD, el.getAttribute("title") ?? "");
      target.removeAttribute("title");
      const delay = Date.now() - lastHiddenAt < SKIP_DELAY_MS ? 0 : FAST_TITLE_DELAY_MS;
      timer = setTimeout(show, delay);
    },
    true,
  );
  doc.addEventListener(
    "pointerout",
    (event) => {
      if (!target) return;
      const next = (event as PointerEvent).relatedTarget;
      if (next instanceof Node && target.contains(next)) return;
      release();
    },
    true,
  );
  // Clicking, typing, scrolling, or leaving the window ends the tooltip, as
  // it does for a native one.
  doc.addEventListener("pointerdown", release, true);
  doc.addEventListener("keydown", release, true);
  doc.addEventListener("scroll", release, true);
  win.addEventListener("blur", release);
}

function titled(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null;
  const el = node.closest("[title]");
  if (!(el instanceof HTMLElement) || !el.getAttribute("title")) return null;
  // Only titles inside the hovered surface: a host wrapper around a whole
  // view would otherwise pop its name up over everything in it. An iframe's
  // title names the frame for screen readers; browsers never show it.
  const root = node.closest(SCOPE);
  return root?.contains(el) && !(el instanceof HTMLIFrameElement) ? el : null;
}

function createTip(doc: Document): HTMLDivElement {
  const tip = doc.createElement("div");
  tip.setAttribute("role", "tooltip");
  tip.setAttribute("data-bb-fast-title-tip", "");
  // Inline styles, because each plugin's CSS is scoped to its own surfaces
  // and this tooltip belongs to whichever plugin installed the listener.
  Object.assign(tip.style, {
    position: "fixed",
    top: "0",
    left: "0",
    zIndex: "2147483647",
    maxWidth: "20rem",
    padding: "6px 12px",
    borderRadius: "6px",
    background: "var(--primary)",
    color: "var(--primary-foreground)",
    fontSize: "12px",
    lineHeight: "16px",
    overflowWrap: "break-word",
    whiteSpace: "pre-line",
    pointerEvents: "none",
  } satisfies Partial<CSSStyleDeclaration>);
  return tip;
}

// Below the element and centred on it; above it when there is no room below.
function place(tip: HTMLElement, anchor: HTMLElement, win: Window): void {
  const a = anchor.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  const below = a.bottom + GAP;
  const top = below + t.height > win.innerHeight - EDGE ? a.top - GAP - t.height : below;
  const centred = a.left + a.width / 2 - t.width / 2;
  const left = Math.max(EDGE, Math.min(centred, win.innerWidth - EDGE - t.width));
  tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(Math.max(EDGE, top))}px)`;
}

if (typeof document !== "undefined") installFastTitles();
