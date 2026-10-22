// The app's current path. BB's router changes it without telling plugins, so
// this follows the Navigation API's events where the shell has them and polls
// as a fallback. A `useRoute()` hook from BB would replace it.
import { useSyncExternalStore } from "react";

const POLL_MS = 400;

interface NavigationTarget {
  addEventListener(type: "navigatesuccess" | "currententrychange", listener: () => void): void;
  removeEventListener(type: "navigatesuccess" | "currententrychange", listener: () => void): void;
}

const subscribers = new Set<() => void>();
let pathname = "";
let navigation: NavigationTarget | undefined;
let timer: ReturnType<typeof setInterval> | null = null;

function checkPathname() {
  const next = window.location.pathname;
  if (next === pathname) return;
  pathname = next;
  for (const notify of subscribers) notify();
}

function subscribe(notify: () => void): () => void {
  subscribers.add(notify);
  if (subscribers.size === 1) {
    pathname = window.location.pathname;
    navigation = (window as { navigation?: NavigationTarget }).navigation;
    navigation?.addEventListener("currententrychange", checkPathname);
    window.addEventListener("popstate", checkPathname);
    timer = setInterval(checkPathname, POLL_MS);
  }
  return () => {
    subscribers.delete(notify);
    if (subscribers.size) return;
    navigation?.removeEventListener("currententrychange", checkPathname);
    navigation = undefined;
    window.removeEventListener("popstate", checkPathname);
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
}

export function usePathname(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname, () => "/");
}
