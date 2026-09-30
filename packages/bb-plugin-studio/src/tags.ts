// Tags group Studio items across add-ons. Studio keeps them, keyed by
// `<plugin>:<id>`, so every add-on's items can be tagged without the add-on
// knowing about tags.
import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";

/** Tag colours, picked in turn; each reads on light and dark backgrounds. */
export const TAG_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ec4899", "#8b5cf6", "#14b8a6", "#ef4444", "#64748b"];
export const MAX_TAG_NAME = 40;

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface ItemRef {
  pluginId: string;
  id: string;
}

/** Trims and collapses spaces; a leading "#" is dropped. */
export function tagName(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim().replace(/^#+\s*/, "");
  if (!name) throw new Error("A tag needs a name.");
  if (name.length > MAX_TAG_NAME) throw new Error(`Tag names are at most ${MAX_TAG_NAME} characters.`);
  return name;
}

export class TagStore {
  constructor(private readonly db: Database.Database) {}

  list(): Tag[] {
    return this.db.prepare("SELECT id, name, color FROM tags ORDER BY name COLLATE NOCASE").all() as Tag[];
  }

  get(id: string): Tag | null {
    return (this.db.prepare("SELECT id, name, color FROM tags WHERE id = ?").get(id) as Tag | undefined) ?? null;
  }

  byName(name: string): Tag | null {
    return (this.db.prepare("SELECT id, name, color FROM tags WHERE name = ? COLLATE NOCASE").get(tagName(name)) as Tag | undefined) ?? null;
  }

  /** The tag with this name, made if it doesn't exist yet. */
  ensure(raw: string): Tag {
    const name = tagName(raw);
    const existing = this.byName(name);
    if (existing) return existing;
    const count = (this.db.prepare("SELECT COUNT(*) AS n FROM tags").get() as { n: number }).n;
    const tag = { id: `tag_${randomBytes(8).toString("hex")}`, name, color: TAG_COLORS[count % TAG_COLORS.length]! };
    this.db.prepare("INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)").run(tag.id, tag.name, tag.color, Date.now());
    return tag;
  }

  rename(id: string, raw: string): Tag {
    const name = tagName(raw);
    const clash = this.byName(name);
    if (clash && clash.id !== id) throw new Error(`There's already a tag called "${clash.name}".`);
    if (this.db.prepare("UPDATE tags SET name = ? WHERE id = ?").run(name, id).changes === 0) throw new Error("That tag no longer exists.");
    return this.get(id)!;
  }

  remove(id: string): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM item_tags WHERE tag_id = ?").run(id);
      this.db.prepare("DELETE FROM tags WHERE id = ?").run(id);
    })();
  }

  /** Tag ids per `<plugin>:<id>`. */
  assignments(): Map<string, string[]> {
    const rows = this.db
      .prepare("SELECT plugin_id, item_id, tag_id FROM item_tags JOIN tags ON tags.id = item_tags.tag_id ORDER BY tags.name COLLATE NOCASE")
      .all() as { plugin_id: string; item_id: string; tag_id: string }[];
    const map = new Map<string, string[]>();
    for (const row of rows) {
      const key = `${row.plugin_id}:${row.item_id}`;
      map.set(key, [...(map.get(key) ?? []), row.tag_id]);
    }
    return map;
  }

  /** Adds and removes tags on every item; unknown tag ids are skipped. */
  apply(items: readonly ItemRef[], add: readonly string[], remove: readonly string[]): void {
    const known = new Set(this.list().map((tag) => tag.id));
    const insert = this.db.prepare("INSERT OR IGNORE INTO item_tags (plugin_id, item_id, tag_id, created_at) VALUES (?, ?, ?, ?)");
    const drop = this.db.prepare("DELETE FROM item_tags WHERE plugin_id = ? AND item_id = ? AND tag_id = ?");
    const now = Date.now();
    this.db.transaction(() => {
      for (const item of items) {
        for (const tagId of add) if (known.has(tagId)) insert.run(item.pluginId, item.id, tagId, now);
        for (const tagId of remove) drop.run(item.pluginId, item.id, tagId);
      }
    })();
  }

  /** Forgets deleted items' tags. */
  forget(pluginId: string, ids: readonly string[]): void {
    const drop = this.db.prepare("DELETE FROM item_tags WHERE plugin_id = ? AND item_id = ?");
    this.db.transaction(() => {
      for (const id of ids) drop.run(pluginId, id);
    })();
  }

  /** Forgets tags on a provider's items that it no longer lists. */
  prune(pluginId: string, liveIds: ReadonlySet<string>): void {
    const tagged = this.db.prepare("SELECT DISTINCT item_id FROM item_tags WHERE plugin_id = ?").all(pluginId) as { item_id: string }[];
    const gone = tagged.map((row) => row.item_id).filter((id) => !liveIds.has(id));
    if (gone.length) this.forget(pluginId, gone);
  }
}
