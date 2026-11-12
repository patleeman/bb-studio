// Stars keep items one tap away, across add-ons. Studio keeps them by
// `<plugin>:<id>` with when each was starred, so a rename keeps the star and
// the list reads newest-starred first. A dedicated table, not a reserved tag:
// a star has no name, colour or rename, and must stay out of tag lists,
// tag: filters and the tag tool.
import type Database from "better-sqlite3";
import type { ItemRef } from "./tags";

export interface Star extends ItemRef {
  starredAt: number;
}

export class StarStore {
  constructor(private readonly db: Database.Database) {}

  /** Every star, newest first. */
  list(): Star[] {
    return this.db.prepare("SELECT plugin_id AS pluginId, item_id AS id, starred_at AS starredAt FROM stars ORDER BY starred_at DESC, rowid DESC").all() as Star[];
  }

  /** When each `<plugin>:<id>` was starred. */
  map(): Map<string, number> {
    return new Map(this.list().map((star) => [`${star.pluginId}:${star.id}`, star.starredAt]));
  }

  /** Stars or unstars items; starring a starred item keeps when it was starred. */
  set(items: readonly ItemRef[], starred: boolean, now = Date.now()): void {
    const add = this.db.prepare("INSERT OR IGNORE INTO stars (plugin_id, item_id, starred_at) VALUES (?, ?, ?)");
    const drop = this.db.prepare("DELETE FROM stars WHERE plugin_id = ? AND item_id = ?");
    this.db.transaction(() => {
      // Later items in one call count as starred later, so the list keeps their order.
      items.forEach((item, index) => (starred ? add.run(item.pluginId, item.id, now + index) : drop.run(item.pluginId, item.id)));
    })();
  }

  /** Forgets deleted items' stars. */
  forget(pluginId: string, ids: readonly string[]): void {
    const drop = this.db.prepare("DELETE FROM stars WHERE plugin_id = ? AND item_id = ?");
    this.db.transaction(() => {
      for (const id of ids) drop.run(pluginId, id);
    })();
  }

  /** Forgets stars on a provider's items that it no longer lists. */
  prune(pluginId: string, liveIds: ReadonlySet<string>): boolean {
    const starred = this.db.prepare("SELECT item_id FROM stars WHERE plugin_id = ?").all(pluginId) as { item_id: string }[];
    const gone = starred.map((row) => row.item_id).filter((id) => !liveIds.has(id));
    if (gone.length) this.forget(pluginId, gone);
    return gone.length > 0;
  }
}
