// Hiding the add-ons' own sidebar entries once Studio lists their items.
// Mirrors how bb reads `sidebar.pluginPanelOrder` and
// `sidebar.visiblePluginPanels`: null visibility means everything shows but
// bb's default-hidden items, and an id missing from the order is new, so it
// shows until the user decides otherwise.

export const DEFAULT_HIDDEN = ["__bb__/search-threads"];

export function isPanelVisible(order: readonly string[], visible: readonly string[] | null, id: string): boolean {
  if (visible === null) return !DEFAULT_HIDDEN.includes(id);
  if (!order.includes(id)) return true;
  return visible.includes(id);
}

/** The preference values that show or hide `ids`, leaving every other item as it was. */
export function withPanelsVisible(
  order: readonly string[],
  visible: readonly string[] | null,
  ids: readonly string[],
  show: boolean,
): { order: string[]; visible: string[] } {
  // Pin down everything's current state before changing ours: once an id is
  // in the order, its visibility comes from the list.
  const nextOrder = [...order, ...ids.filter((id) => !order.includes(id))];
  const nextVisible = nextOrder.filter((id) => (ids.includes(id) ? show : isPanelVisible(order, visible, id)));
  return { order: nextOrder, visible: nextVisible };
}
