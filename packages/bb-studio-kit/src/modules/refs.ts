import type Database from "better-sqlite3";
import { rewriteLegacyText, rewriteLegacyValue } from "../legacy-refs";

/** Runs only on Studio-owned/module databases, never BB's core database. */
export function migrateModuleRefs(db: Database.Database, ids: readonly string[]): number {
  db.exec(`CREATE TABLE IF NOT EXISTS module_ref_rewrites (legacy_id TEXT PRIMARY KEY, cells INTEGER NOT NULL, rewritten_at INTEGER NOT NULL)`);
  return db.transaction(() => {
    let total = 0;
    for (const id of ids) {
      if (db.prepare("SELECT 1 FROM module_ref_rewrites WHERE legacy_id = ?").get(id)) continue;
      let count = 0;
      const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table'").all() as { name: string; sql: string }[];
      for (const table of tables) {
        // Imports are provenance. FTS is a rebuildable index, not owned content.
        if (table.name.startsWith("_") || table.name.startsWith("sqlite_") || table.name.startsWith("studio_search_") || ["module_imports", "module_ref_rewrites"].includes(table.name)) continue;
        const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
        const columns = db.pragma(`table_info(${quote(table.name)})`) as { name: string; type: string }[];
        const textColumns = columns.filter(column => column.type.toUpperCase() === "TEXT");
        for (const row of db.prepare(`SELECT rowid AS __row, * FROM ${quote(table.name)}`).all() as Record<string, unknown>[]) {
          const changed: [string, string][] = [];
          for (const { name } of textColumns) {
            const before = row[name]; if (typeof before !== "string") continue;
            let after: string;
            if (["plugin_id", "from_plugin", "to_plugin"].includes(name) && before === id) after = id === "explore" ? "pages" : "studio";
            else {
              try {
                const value = JSON.parse(before);
                const rewritten = rewriteLegacyValue(value, [id]);
                after = JSON.stringify(value) === JSON.stringify(rewritten) ? before : JSON.stringify(rewritten);
              } catch { after = rewriteLegacyText(before, [id]); }
            }
            if (after !== before) changed.push([name, after]);
          }
          if (!changed.length) continue;
          // Conflicting canonical rows abort the transaction; never silently
          // discard a version, comment, link or assignment via OR REPLACE.
          db.prepare(`UPDATE ${quote(table.name)} SET ${changed.map(([name]) => `${quote(name)} = ?`).join(", ")} WHERE rowid = ?`).run(...changed.map(([, value]) => value), row.__row);
          count += changed.length;
        }
      }
      db.prepare("INSERT INTO module_ref_rewrites VALUES (?, ?, ?)").run(id, count, Date.now());
      total += count;
    }
    return total;
  })();
}
