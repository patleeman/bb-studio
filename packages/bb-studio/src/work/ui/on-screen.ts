import { useEffect, useState, useSyncExternalStore } from "react";

const shown = new Map<Element, string>();
const listeners = new Set<() => void>();
let snapshot: ReadonlySet<string> = new Set();

function mark(element: Element, id: string, visible: boolean): void {
  if (visible ? shown.get(element) === id : !shown.has(element)) return;
  if (visible) shown.set(element, id);
  else shown.delete(element);
  snapshot = new Set(shown.values());
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useCardOnScreen(id: string): (element: HTMLElement | null) => void {
  const [element, setElement] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries.at(-1);
      if (entry) mark(element, id, entry.isIntersecting && entry.intersectionRatio >= 0.5);
    }, { threshold: [0, 0.5] });
    observer.observe(element);
    return () => { observer.disconnect(); mark(element, id, false); };
  }, [element, id]);
  return setElement;
}

export function useCardsOnScreen(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}
