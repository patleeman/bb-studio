// Requests to open an item in the Global workbench, waiting for the Studio
// page's GlobalItemOpener (global-workbench.tsx). Its own module so the open
// rule (studio-open.tsx) can ask without importing the item views.
import type { TabKind } from "./studio-tab/model";

export interface GlobalItem { kind: TabKind; id: string; title?: string; href?: string }

export const waitingGlobalItems: GlobalItem[] = [];
const subscribers = new Set<() => void>();
let revision = 0;
export const subscribeGlobalItems = (notify: () => void) => { subscribers.add(notify); return () => { subscribers.delete(notify); }; };
export const globalItemsRevision = () => revision;

/** Asks the Studio page to open `item` in the Global section once it is on screen. */
export function requestGlobalItem(item: GlobalItem): void {
  waitingGlobalItems.push(item);
  revision += 1;
  for (const notify of subscribers) notify();
}

/** Test hook: drops waiting requests. */
export function resetGlobalItemRequests(): void {
  waitingGlobalItems.length = 0;
}
