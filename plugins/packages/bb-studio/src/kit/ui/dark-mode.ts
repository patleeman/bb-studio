import { useSyncExternalStore } from "react";

function readDarkMode(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark") || document.body.classList.contains("dark");
}

const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;
let current = false;

function notify() {
  const next = readDarkMode();
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0 && typeof document !== "undefined") {
    current = readDarkMode();
    if (typeof MutationObserver !== "undefined") {
      observer = new MutationObserver(notify);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
      if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    }
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && observer) {
      observer.disconnect();
      observer = null;
    }
  };
}

function getSnapshot(): boolean {
  return listeners.size > 0 ? current : readDarkMode();
}

/**
 * Tracks whether BB is in dark mode using one shared MutationObserver across
 * all mounted subscribers.
 */
export function useDarkMode(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
