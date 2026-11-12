// Whether Studio's own sidebar (the Bot sidebar, src/ui/conversations) is the sidebar in use.
// The Bots section and the Studio page's own sidebar stand down while it is.
import { useEffect, useSyncExternalStore } from "react";

let mounted = 0;
const subscribers = new Set<() => void>();
const changed = () => { for (const notify of subscribers) notify(); };
const subscribe = (notify: () => void) => { subscribers.add(notify); return () => { subscribers.delete(notify); }; };

export function useUnifiedSidebarShown(): boolean {
  return useSyncExternalStore(subscribe, () => mounted > 0, () => false);
}

const CHOSEN_KEY = "studio.sidebar.unified";

/** Whether the unified sidebar was the list last shown in this browser. */
export function unifiedSidebarChosen(): boolean {
  try { return localStorage.getItem(CHOSEN_KEY) === "1"; } catch { return false; }
}

/** Notes that BB's own list (with the Bots section under it) is the one in use. */
export function forgetUnifiedSidebar(): void {
  try { localStorage.removeItem(CHOSEN_KEY); } catch { /* private mode */ }
}

/** Called by the unified sidebar itself. */
export function useMarkUnifiedSidebarShown(): void {
  useEffect(() => {
    mounted += 1;
    try { localStorage.setItem(CHOSEN_KEY, "1"); } catch { /* private mode */ }
    changed();
    return () => { mounted -= 1; changed(); };
  }, []);
}
