// The item index (the `items` table): one row per page and app, with its
// family and type, under the id and namespace it always had. It is how Studio
// finds an item by id alone and lists across types.
//
// The rows are copies. Each type's own table holds its content, and the
// triggers in the `items` migration (src/migrations.ts) write its row on
// every insert, update and delete, whoever does it (a store, a restore). The
// SELECTs here are the same ones the migration ran: `heal` runs them again at
// startup and after a restore, so a row a trigger missed is put right.
import type Database from "better-sqlite3";
import { ITEM_TYPES, itemType, type ItemFamily, type ItemType } from "./item-model";

export interface IndexedItem {
  pluginId: string;
  id: string;
  family: ItemFamily;
  type: ItemType;
  title: string;
  projectId: string | null;
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  template: boolean;
}

/** Each type's own table, and the columns its row is copied from. */
const SOURCES: readonly { type: ItemType; table: string; title: string; parent: string; template: string }[] = [
  { type: "doc", table: "pages", title: "title", parent: "parent_id", template: "template" },
  { type: "whiteboard", table: "drawings", title: "name", parent: "NULL", template: "template" },
  { type: "design", table: "designs", title: "name", parent: "NULL", template: "template" },
  { type: "mini", table: "minis", title: "name", parent: "NULL", template: "template" },
  { type: "dashboard", table: "dashboards", title: "name", parent: "NULL", template: "template" },
  { type: "artifact", table: "artifacts", title: "title", parent: "NULL", template: "0" },
];

const COLUMNS = "plugin_id, id, family, type, title, project_id, parent_id, created_at, updated_at, archived_at, template";

/** The index row of every item in a type's table. */
function sourceSelect(source: (typeof SOURCES)[number]): string {
  const info = itemType(source.type)!;
  return `SELECT '${info.pluginId}' AS plugin_id, id, '${info.family}' AS family, '${info.type}' AS type, COALESCE(${source.title}, '') AS title, project_id, ${source.parent} AS parent_id,
    COALESCE(created_at, 0) AS created_at, COALESCE(updated_at, created_at, 0) AS updated_at, archived_at, COALESCE(${source.template}, 0) AS template FROM ${source.table} WHERE id IS NOT NULL`;
}

type Row = { plugin_id: string; id: string; family: ItemFamily; type: ItemType; title: string; project_id: string | null; parent_id: string | null; created_at: number; updated_at: number; archived_at: number | null; template: number };
const read = (row: Row): IndexedItem => ({
  pluginId: row.plugin_id, id: row.id, family: row.family, type: row.type, title: row.title, projectId: row.project_id, parentId: row.parent_id,
  createdAt: row.created_at, updatedAt: row.updated_at, archived: row.archived_at !== null, template: row.template === 1,
});

export interface IndexListOptions {
  family?: ItemFamily;
  type?: ItemType;
  /** Items of this project and global ones; leave out for every project. */
  projectId?: string | null;
  includeArchived?: boolean;
  includeTemplates?: boolean;
  limit?: number;
}

export class ItemIndex {
  constructor(private readonly db: Database.Database) {}

  /** The item with this id, whatever its type. `pluginId` narrows it to one namespace. */
  get(id: string, pluginId?: string): IndexedItem | null {
    const row = (pluginId
      ? this.db.prepare(`SELECT ${COLUMNS} FROM items WHERE plugin_id = ? AND id = ?`).get(pluginId, id)
      : this.db.prepare(`SELECT ${COLUMNS} FROM items WHERE id = ? ORDER BY plugin_id LIMIT 1`).get(id)) as Row | undefined;
    return row ? read(row) : null;
  }

  /** Items newest-updated first. */
  list(options: IndexListOptions = {}): IndexedItem[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (options.family) { where.push("family = ?"); args.push(options.family); }
    if (options.type) { where.push("type = ?"); args.push(options.type); }
    if (options.projectId !== undefined) {
      if (options.projectId === null) where.push("project_id IS NULL");
      else { where.push("(project_id = ? OR project_id IS NULL)"); args.push(options.projectId); }
    }
    if (!options.includeArchived) where.push("archived_at IS NULL");
    if (!options.includeTemplates) where.push("template = 0");
    const rows = this.db.prepare(`SELECT ${COLUMNS} FROM items ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC, id LIMIT ?`).all(...args, options.limit ?? 500) as Row[];
    return rows.map(read);
  }

  /** The family and type of every item in one namespace, by id. */
  types(pluginId: string): Map<string, { family: ItemFamily; type: ItemType }> {
    const rows = this.db.prepare("SELECT id, family, type FROM items WHERE plugin_id = ?").all(pluginId) as Pick<Row, "id" | "family" | "type">[];
    return new Map(rows.map((row) => [row.id, { family: row.family, type: row.type }]));
  }

  count(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM items").get() as { n: number }).n;
  }

  /**
   * Makes the index match the types' own tables: writes rows that are missing
   * or differ, and drops rows whose item is gone. Returns how many of each;
   * both are 0 when the triggers kept it right. Content tables are only read.
   */
  heal(): { written: number; removed: number } {
    let written = 0;
    let removed = 0;
    this.db.transaction(() => {
      for (const source of SOURCES) {
        const info = itemType(source.type)!;
        const select = sourceSelect(source);
        written += this.db.prepare(`INSERT OR REPLACE INTO items (${COLUMNS})
          SELECT ${COLUMNS} FROM (${select}) AS s WHERE NOT EXISTS (SELECT 1 FROM items i WHERE i.plugin_id = s.plugin_id AND i.id = s.id
            AND i.family = s.family AND i.type = s.type AND i.title = s.title AND i.project_id IS s.project_id AND i.parent_id IS s.parent_id
            AND i.created_at = s.created_at AND i.updated_at = s.updated_at AND i.archived_at IS s.archived_at AND i.template = s.template)`).run().changes;
        removed += this.db.prepare(`DELETE FROM items WHERE plugin_id = ? AND NOT EXISTS (SELECT 1 FROM ${source.table} t WHERE t.id = items.id)`).run(info.pluginId).changes;
      }
      const known = ITEM_TYPES.map((each) => each.pluginId);
      removed += this.db.prepare(`DELETE FROM items WHERE plugin_id NOT IN (${known.map(() => "?").join(", ")})`).run(...known).changes;
    })();
    return { written, removed };
  }
}
