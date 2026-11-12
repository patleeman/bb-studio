import type { HubItem, StudioHub } from "./hub";
import type { StudioServices } from "./services";

/** Bounded change history for clients returning from the background. */
export interface ItemChange { pluginId: string; id: string; kind: string; removed: boolean; at: number }

export class ChangeLog {
  private cursor = 0;
  private oldest = 0;
  private entries: { cursor: number; change: ItemChange | null }[] = [];

  append(change: ItemChange | null): number {
    const cursor = ++this.cursor;
    this.entries.push({ cursor, change });
    if (this.entries.length > 1000) this.oldest = this.entries.shift()!.cursor;
    return cursor;
  }

  since(since: number): { cursor: number; changes: ItemChange[]; reset: boolean } {
    return {
      cursor: this.cursor,
      changes: this.entries.filter((entry) => entry.cursor > since && entry.change).map((entry) => entry.change!),
      reset: since > this.cursor || since < this.oldest || this.entries.some((entry) => entry.cursor > since && entry.change === null),
    };
  }
}

/** Record provider notifications and discard versions only for confirmed deletions. */
export async function recordProviderChanges(
  hub: Pick<StudioHub, "providers" | "itemsResult">,
  services: Pick<StudioServices, "forgetVersions">,
  changes: ChangeLog,
  pluginId: string,
  ids?: string[],
  removed?: string[],
): Promise<void> {
  if (!ids && !removed) changes.append(null);
  let fresh: HubItem[] | null = [];
  let complete = false;
  let fallbackKind: string | null = null;
  if (ids?.length) {
    try {
      const provider = (await hub.providers()).find((entry) => entry.pluginId === pluginId && entry.state === "ready");
      if (!provider) throw new Error("Provider unavailable");
      fallbackKind = provider.kinds.length === 1 ? provider.kinds[0]!.id : null;
      const result = await hub.itemsResult(pluginId, ids);
      if (result.status !== "ready") throw new Error("Provider unavailable");
      fresh = result.items;
      complete = result.complete;
      if (!complete) changes.append(null);
    } catch { fresh = null; changes.append(null); }
  }
  const byId = new Map(fresh?.map((item) => [item.id, item]));
  for (const id of fresh === null ? [] : (ids ?? []).filter((id) => complete || byId.has(id))) changes.append({ pluginId, id, kind: byId.get(id)?.kind ?? fallbackKind ?? "", removed: !byId.has(id), at: Date.now() });
  for (const id of removed ?? []) changes.append({ pluginId, id, kind: "", removed: true, at: Date.now() });
  services.forgetVersions(pluginId, [...(removed ?? []), ...(!complete ? [] : (ids ?? []).filter((id) => !byId.has(id)))]);
}
