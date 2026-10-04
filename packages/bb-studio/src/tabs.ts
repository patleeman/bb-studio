// Studio items open as tabs in the sidebar. Opening an item's view adds its
// tab at the end; the user closes tabs. Pinned tabs come first and are never
// closed to make room. Studio keeps them, so every window shows the same tabs.
import type Database from "better-sqlite3";
import type { ItemRef } from "./tags";

/** Older unpinned tabs are closed past this many. */
export const MAX_TABS = 30;

export interface Tab extends ItemRef {
  pinned: boolean;
}

interface TabRow {
  plugin_id: string;
  item_id: string;
  pinned: number;
}

export class TabStore {
  constructor(private readonly db: Database.Database) {}

  /** Pinned tabs first, each group in the order opened. */
  list(): Tab[] {
    return (this.db.prepare("SELECT plugin_id, item_id, pinned FROM tabs ORDER BY pinned DESC, position").all() as TabRow[]).map((row) => ({
      pluginId: row.plugin_id,
      id: row.item_id,
      pinned: row.pinned === 1,
    }));
  }

  /** Adds a tab at the end; false when it was already open. */
  open(item: ItemRef): boolean {
    return this.db.transaction(() => {
      const next = (this.db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS n FROM tabs").get() as { n: number }).n;
      const added =
        this.db
          .prepare("INSERT OR IGNORE INTO tabs (plugin_id, item_id, position, opened_at) VALUES (?, ?, ?, ?)")
          .run(item.pluginId, item.id, next, Date.now()).changes > 0;
      if (added) {
        // Pinned tabs count toward the limit but stay; the tab just opened always does.
        const pinned = (this.db.prepare("SELECT COUNT(*) AS n FROM tabs WHERE pinned = 1").get() as { n: number }).n;
        this.db
          .prepare("DELETE FROM tabs WHERE rowid IN (SELECT rowid FROM tabs WHERE pinned = 0 ORDER BY position DESC LIMIT -1 OFFSET ?)")
          .run(Math.max(MAX_TABS - pinned, 1));
      }
      return added;
    })();
  }

  /** Pins or unpins a tab, opening it to pin it; false when nothing changed. */
  pin(item: ItemRef, pinned: boolean): boolean {
    return this.db.transaction(() => {
      if (pinned) this.open(item);
      return this.db.prepare("UPDATE tabs SET pinned = ? WHERE plugin_id = ? AND item_id = ? AND pinned != ?")
        .run(pinned ? 1 : 0, item.pluginId, item.id, pinned ? 1 : 0).changes > 0;
    })();
  }

  /** false when it wasn't open. */
  close(item: ItemRef): boolean {
    return this.db.prepare("DELETE FROM tabs WHERE plugin_id = ? AND item_id = ?").run(item.pluginId, item.id).changes > 0;
  }

  /** Closes every tab but these. */
  keepOnly(items: readonly ItemRef[]): boolean {
    const keep = new Set(items.map((item) => `${item.pluginId}:${item.id}`));
    const gone = this.list().filter((tab) => !keep.has(`${tab.pluginId}:${tab.id}`));
    this.db.transaction(() => {
      for (const tab of gone) this.close(tab);
    })();
    return gone.length > 0;
  }

  /** Closes tabs of deleted items; false when none were open. */
  forget(pluginId: string, ids: readonly string[]): boolean {
    const drop = this.db.prepare("DELETE FROM tabs WHERE plugin_id = ? AND item_id = ?");
    let changes = 0;
    this.db.transaction(() => {
      for (const id of ids) changes += drop.run(pluginId, id).changes;
    })();
    return changes > 0;
  }

  /** Closes tabs of a provider's items that it no longer lists. */
  prune(pluginId: string, liveIds: ReadonlySet<string>): boolean {
    const open = this.list().filter((tab) => tab.pluginId === pluginId && !liveIds.has(tab.id));
    return open.length > 0 && this.forget(pluginId, open.map((tab) => tab.id));
  }
}

/** Kept here for the tab code; the kit owns it so Studio Chat matches paths the same way. */
export { itemAtPath } from "@bb-studio/kit/contract";
