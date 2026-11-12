// Round 7: BB's rail holds only global things (Threads, Search, Skills,
// Plugins, Settings). Studio's pages and Visual Chat stay off it with BB's
// `experimental_hideFromNavigation: true` (app.tsx). What's left is
// BB's own: once per install Studio hides BB's Automations (the Bot's
// Automations page lists what runs, BB's own automations included, so there
// is no second Automations page) and shows BB's Search, hidden by default,
// with BB's own preference (`sidebar.visiblePluginPanels`, the rail's
// Customize). The user can change either back there; Studio doesn't redo it.
import { withPanelsVisible } from "./sidebar";

export const ORDER_KEY = "sidebar.pluginPanelOrder";
export const VISIBLE_KEY = "sidebar.visiblePluginPanels";
export const ARRANGED_KV_KEY = "rail.arranged.v1";

/** What the rail stops showing: BB's Automations, built in and its plugin's page. */
export const RAIL_HIDDEN = ["__bb__/automations", "automations/automations"] as const;
/** What it shows: BB's Search, hidden by default. */
export const RAIL_SHOWN = ["__bb__/search-threads"] as const;

/** The rail's preferences after the arrangement. */
export function arrangedRail(order: readonly string[], visible: readonly string[] | null): { order: string[]; visible: string[] } {
  const hidden = withPanelsVisible(order, visible, RAIL_HIDDEN, false);
  return withPanelsVisible(hidden.order, hidden.visible, RAIL_SHOWN, true);
}

interface Preference<Value> { value: Value; revision: number }
export interface RailDeps {
  kv: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> };
  list(): Promise<{ preferences: { [ORDER_KEY]: Preference<string[]>; [VISIBLE_KEY]: Preference<string[] | null> } }>;
  set(input: { key: string; value: unknown; expectedRevision: number }): Promise<unknown>;
}

/** Arranges the rail once; false when it was done before. A stale revision is read again and retried once. */
export async function arrangeRailOnce(deps: RailDeps): Promise<boolean> {
  if (await deps.kv.get(ARRANGED_KV_KEY)) return false;
  for (let attempt = 0; ; attempt++) {
    const { preferences } = await deps.list();
    const order = preferences[ORDER_KEY];
    const visible = preferences[VISIBLE_KEY];
    const next = arrangedRail(order.value, visible.value);
    try {
      if (next.order.length !== order.value.length) await deps.set({ key: ORDER_KEY, value: next.order, expectedRevision: order.revision });
      await deps.set({ key: VISIBLE_KEY, value: next.visible, expectedRevision: visible.revision });
      break;
    } catch (error) {
      if (attempt > 0) throw error;
    }
  }
  await deps.kv.set(ARRANGED_KV_KEY, true);
  return true;
}
