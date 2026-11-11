import { useEffect } from "react";

const RADIX_TOOLTIP_OPEN_EVENT = "tooltip.open";
const OVERLAY_SELECTOR = '[role="menu"], [role="dialog"], [role="listbox"]';
const SETTLE_MS = 500;

function holdsOverlay(node: Node): boolean {
  return (
    node instanceof Element &&
    (node.matches(OVERLAY_SELECTOR) ||
      node.querySelector(OVERLAY_SELECTOR) !== null)
  );
}

export function dismissTooltips(doc: Document): void {
  doc.dispatchEvent(new CustomEvent(RADIX_TOOLTIP_OPEN_EVENT));
}

export function installTooltipDismiss(doc: Document): () => void {
  const win = doc.defaultView;
  if (win === null || typeof win.MutationObserver !== "function") {
    return () => {};
  }
  let settleUntil = 0;
  const timers = new Set<number>();
  const later = (delay: number) => {
    const timer = win.setTimeout(() => {
      timers.delete(timer);
      dismissTooltips(doc);
    }, delay);
    timers.add(timer);
  };
  const observer = new win.MutationObserver((records) => {
    let changed = false;
    let closed = false;
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (holdsOverlay(node)) changed = true;
      }
      for (const node of record.removedNodes) {
        if (holdsOverlay(node)) {
          changed = true;
          closed = true;
        }
      }
    }
    if (!changed) return;
    dismissTooltips(doc);
    later(0);
    if (closed) {
      settleUntil = Date.now() + SETTLE_MS;
      later(50);
    }
  });
  observer.observe(doc.body, { childList: true });
  const onFocusIn = () => {
    if (Date.now() < settleUntil) later(0);
  };
  doc.addEventListener("focusin", onFocusIn);
  return () => {
    observer.disconnect();
    doc.removeEventListener("focusin", onFocusIn);
    for (const timer of timers) win.clearTimeout(timer);
    timers.clear();
  };
}

export function useForkTooltipDismiss(): void {
  useEffect(() => installTooltipDismiss(document), []);
}
