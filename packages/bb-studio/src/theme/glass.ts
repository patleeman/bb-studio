import { useSyncExternalStore } from "react";

export const GLASS_ATTRIBUTE = "data-studio-glass";

const watched = [GLASS_ATTRIBUTE];

function subscribe(listener: () => void): () => void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return () => {};
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: watched });
  return () => observer.disconnect();
}

const has = (name: string) => () => typeof document !== "undefined" && document.documentElement.hasAttribute(name);
const readGlass = has(GLASS_ATTRIBUTE);

export function useGlass(): boolean {
  return useSyncExternalStore(subscribe, readGlass, () => false);
}
