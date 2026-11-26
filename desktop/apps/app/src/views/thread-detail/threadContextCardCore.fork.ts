const HIDDEN_CORE_ENTRY_IDS: ReadonlySet<string> = new Set(["childThreads"]);

export function studioCoreCardEntries<Entry extends { id: string }>(
  entries: readonly Entry[],
): readonly Entry[] {
  return entries.filter((entry) => !HIDDEN_CORE_ENTRY_IDS.has(entry.id));
}
