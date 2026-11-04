// BB Studio Canvas (plugin id "studio-canvas") was the plugin "canvas" until
// its id clashed with another store plugin. A plugin's database is keyed by
// its id (<BB data dir>/plugins/<id>/data.db), so the old plugin's canvases
// stay in plugins/canvas/data.db. On the first start with an empty store,
// this copies them in, read-only, and records that it ran.
//
// - The legacy file is opened read-only with node:sqlite and never written
//   to or deleted. Disabling or removing the old plugin is up to the user.
// - Every row keeps its ids, so each canvas keeps its hidden backing thread
//   and lookups by thread keep working.
// - Only columns both schemas have are copied, so an older legacy schema
//   imports too; columns it lacks get their defaults.
// - It runs once: the record (canvas_legacy_import) is written in the same
//   transaction as the rows, and a store that already has canvases is never
//   touched.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";

export const LEGACY_PLUGIN_ID = "canvas";

/** Canvas's tables, in the order they are copied. */
export const LEGACY_TABLES = ["canvases", "canvas_items", "canvas_changes", "canvas_turns", "canvas_thread_aliases"] as const;

export type LegacyImport =
  | { status: "imported"; source: string; counts: Record<string, number> }
  | { status: "skipped"; reason: "already-imported" | "store-not-empty" | "no-legacy-file" | "not-a-canvas-database" };

/** A read-only view of the legacy database. */
export interface LegacyReader {
  tables(): Set<string>;
  columns(table: string): string[];
  rows(table: string, columns: readonly string[]): unknown[][];
  close(): void;
}

export const legacyDatabasePath = (dataDir: string) => join(dataDir, "plugins", LEGACY_PLUGIN_ID, "data.db");

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Opens the legacy file read-only with node:sqlite, which BB's Node has. */
export function openLegacyReadOnly(path: string): LegacyReader {
  const sqlite = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite") | undefined;
  if (!sqlite) throw new Error("This Node has no node:sqlite, so the old Canvas plugin's canvases can't be read.");
  const db = new sqlite.DatabaseSync(path, { readOnly: true });
  return {
    tables: () => new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((row) => row.name)),
    columns: (table) => (db.prepare(`PRAGMA table_info(${quote(table)})`).all() as { name: string }[]).map((row) => row.name),
    rows: (table, columns) =>
      (db.prepare(`SELECT ${columns.map(quote).join(", ")} FROM ${quote(table)}`).all() as Record<string, unknown>[]).map((row) => columns.map((column) => row[column] ?? null)),
    close: () => db.close(),
  };
}

export function importLegacyCanvases(db: Database.Database, legacyPath: string, open: (path: string) => LegacyReader = openLegacyReadOnly, now: () => number = Date.now): LegacyImport {
  if (db.prepare("SELECT 1 FROM canvas_legacy_import").get()) return { status: "skipped", reason: "already-imported" };
  if (db.prepare("SELECT 1 FROM canvases LIMIT 1").get()) return { status: "skipped", reason: "store-not-empty" };
  if (!existsSync(legacyPath)) return { status: "skipped", reason: "no-legacy-file" };
  const legacy = open(legacyPath);
  try {
    const tables = legacy.tables();
    if (!tables.has("canvases")) return { status: "skipped", reason: "not-a-canvas-database" };
    const counts: Record<string, number> = {};
    db.transaction(() => {
      for (const table of LEGACY_TABLES) {
        if (!tables.has(table)) continue;
        const ours = new Set((db.prepare(`PRAGMA table_info(${quote(table)})`).all() as { name: string }[]).map((row) => row.name));
        const columns = legacy.columns(table).filter((column) => ours.has(column));
        if (columns.length === 0) continue;
        const insert = db.prepare(`INSERT OR IGNORE INTO ${quote(table)} (${columns.map(quote).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`);
        let count = 0;
        for (const row of legacy.rows(table, columns)) count += insert.run(...row).changes;
        counts[table] = count;
      }
      db.prepare("INSERT INTO canvas_legacy_import (id, source, at, counts) VALUES (1, ?, ?, ?)").run(legacyPath, now(), JSON.stringify(counts));
    })();
    return { status: "imported", source: legacyPath, counts };
  } finally {
    legacy.close();
  }
}
