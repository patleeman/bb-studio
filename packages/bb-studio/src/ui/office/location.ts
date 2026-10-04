// The current pathname as React state. BB's router changes history without a
// popstate event, so this listens to the Navigation API where the runtime has
// it (Chromium, Electron) and falls back to popstate.
import { useSyncExternalStore } from "react";

interface NavigationLike {
  addEventListener(type: "currententrychange", listener: () => void): void;
  removeEventListener(type: "currententrychange", listener: () => void): void;
}

function subscribe(listener: () => void) {
  const navigation = (globalThis as { navigation?: NavigationLike }).navigation;
  navigation?.addEventListener("currententrychange", listener);
  globalThis.addEventListener?.("popstate", listener);
  return () => {
    navigation?.removeEventListener("currententrychange", listener);
    globalThis.removeEventListener?.("popstate", listener);
  };
}

export function usePathname(): string {
  return useSyncExternalStore(subscribe, () => globalThis.location?.pathname ?? "", () => "");
}
