import { recordingHref } from "../shared/format";

const SELECTOR = '[data-prompt-mention="true"][data-prompt-mention-resource]';
const LINK = "data-talk-recording-link";

function hrefFor(element: HTMLElement): string | null {
  // Keep draft pills under the editor's control, and leave native links alone.
  if (element.closest('[contenteditable="true"], [data-promptbox], a, button')) return null;
  try {
    const resource = JSON.parse(element.getAttribute("data-prompt-mention-resource") ?? "null");
    if (resource?.kind !== "plugin" || !["studio", "talk"].includes(resource.pluginId) || typeof resource.itemId !== "string") return null;
    const match = /^recordings:(rec_[a-z0-9]{8,32})$/.exec(resource.itemId);
    return match ? recordingHref(match[1]!) : null;
  } catch { return null; }
}

/** Stable BB has no plugin mention-link slot. Make its saved Talk pills navigable. */
export function linkRecordingMentions(open: (href: string) => void, signal: AbortSignal): void {
  const originals = new Map<HTMLElement, { role: string | null; tabIndex: string | null }>();
  const restore = (element: HTMLElement) => {
    const original = originals.get(element);
    if (!original) return;
    for (const [attribute, value] of [["role", original.role], ["tabindex", original.tabIndex]] as const) {
      if (value === null) element.removeAttribute(attribute);
      else element.setAttribute(attribute, value);
    }
    element.removeAttribute(LINK);
    originals.delete(element);
  };
  const sync = () => {
    for (const element of originals.keys()) if (!element.isConnected || !hrefFor(element)) restore(element);
    for (const element of document.querySelectorAll<HTMLElement>(SELECTOR)) {
      const href = hrefFor(element);
      if (!href) continue;
      if (!originals.has(element)) originals.set(element, { role: element.getAttribute("role"), tabIndex: element.getAttribute("tabindex") });
      element.setAttribute(LINK, href);
      element.setAttribute("role", "link");
      element.tabIndex = 0;
    }
  };
  const activate = (event: MouseEvent | KeyboardEvent) => {
    if (event instanceof KeyboardEvent && event.key !== "Enter" && event.key !== " ") return;
    if (event instanceof MouseEvent && event.button !== 0) return;
    const element = event.target instanceof Element ? event.target.closest<HTMLElement>(SELECTOR) : null;
    const href = element && hrefFor(element);
    if (!href) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    open(href);
  };
  const style = document.createElement("style");
  style.textContent = `[${LINK}] { cursor: pointer !important; } [${LINK}]:hover { background: var(--state-hover); } [${LINK}]:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }`;
  document.head.append(style);
  const observer = new MutationObserver(sync);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-prompt-mention-resource", "contenteditable"] });
  window.addEventListener("click", activate, { capture: true, signal });
  window.addEventListener("keydown", activate, { capture: true, signal });
  sync();
  signal.addEventListener("abort", () => {
    observer.disconnect();
    style.remove();
    for (const element of originals.keys()) restore(element);
  }, { once: true });
}
