// The app's current path. BB's router changes it without telling plugins, so
// this follows the Navigation API's events where the shell has them and polls
// as a fallback. On a BB with `experimental_useAppRoute`, host-bridge.tsx feeds
// that hook's value in instead and none of this runs.
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

let hostPathname: string | null = null;

function current(): string {
  return hostPathname ?? window.location.pathname;
}

function checkPathname() {
  const next = current();
  if (next === pathname) return;
  pathname = next;
  for (const notify of subscribers) notify();
}

function startPolling() {
  navigation = (window as { navigation?: NavigationTarget }).navigation;
  navigation?.addEventListener("currententrychange", checkPathname);
  window.addEventListener("popstate", checkPathname);
  timer = setInterval(checkPathname, POLL_MS);
}

function stopPolling() {
  navigation?.removeEventListener("currententrychange", checkPathname);
  navigation = undefined;
  window.removeEventListener("popstate", checkPathname);
  if (timer !== null) clearInterval(timer);
  timer = null;
}

/**
 * The path as BB's own route hook reports it (see host-bridge.tsx), or null
 * on a BB without that hook. While it is set nothing listens or polls.
 */
export function setHostPathname(next: string | null): void {
  if (next === hostPathname) return;
  const hadHost = hostPathname !== null;
  hostPathname = next;
  if (subscribers.size) {
    if (next !== null && !hadHost) stopPolling();
    if (next === null && hadHost) startPolling();
  }
  checkPathname();
}

function subscribe(notify: () => void): () => void {
  subscribers.add(notify);
  if (subscribers.size === 1) {
    pathname = current();
    if (hostPathname === null) startPolling();
  }
  return () => {
    subscribers.delete(notify);
    if (subscribers.size) return;
    stopPolling();
  };
}

export function usePathname(): string {
  return useSyncExternalStore(subscribe, current, () => "/");
}
