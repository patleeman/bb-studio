/** Apply a provider's changed rows while retaining other rows and their tags. */
export function applyItemChanges<T extends { pluginId: string; id: string }>(
  current: readonly T[],
  updated: readonly T[],
  removed: readonly { pluginId: string; id: string }[],
): T[] {
  const key = (item: { pluginId: string; id: string }) => `${item.pluginId}:${item.id}`;
  const replaced = new Set([...updated, ...removed].map(key));
  return [...current.filter((item) => !replaced.has(key(item))), ...updated];
}
