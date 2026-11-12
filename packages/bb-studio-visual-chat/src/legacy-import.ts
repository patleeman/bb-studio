// BB Studio Visual Chat (plugin id "studio-visual-chat") was BB Studio Canvas
// ("studio-canvas"), and before that the plugin "canvas", until that id
// clashed with another store plugin. A plugin's database is keyed by its id
// (<BB data dir>/plugins/<id>/data.db), so the older plugins' canvases stay
// in their files. On the first start with an empty store, this copies them
// in from the newest one there (studio-canvas, else canvas), read-only, and
// records that it ran.
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
// - Settings (the Exa key) belong to a plugin's id in BB, not to its
//   database, so they don't move.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";

/** The plugins this one was, newest first: the first whose file is there is imported. */
export const LEGACY_PLUGIN_IDS = ["studio-canvas", "canvas"] as const;

/** Canvas's tables, in the order they are copied (pages, looks and model choices are columns of canvases). */
export const LEGACY_TABLES = ["canvases", "canvas_items", "canvas_changes", "canvas_turns", "canvas_thread_aliases", "canvas_image_cache", "canvas_versions"] as const;

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

export const legacyDatabasePath = (dataDir: string, pluginId: (typeof LEGACY_PLUGIN_IDS)[number]) => join(dataDir, "plugins", pluginId, "data.db");
/** Where the older plugins' databases are, newest first. */
export const legacyDatabasePaths = (dataDir: string) => LEGACY_PLUGIN_IDS.map((id) => legacyDatabasePath(dataDir, id));

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Opens the legacy file read-only with node:sqlite, which BB's Node has. */
export function openLegacyReadOnly(path: string): LegacyReader {
  const sqlite = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite") | undefined;
  if (!sqlite) throw new Error("This Node has no node:sqlite, so the old plugin's canvases can't be read.");
  const db = new sqlite.DatabaseSync(path, { readOnly: true });
  return {
    tables: () => new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((row) => row.name)),
    columns: (table) => (db.prepare(`PRAGMA table_info(${quote(table)})`).all() as { name: string }[]).map((row) => row.name),
    rows: (table, columns) =>
      (db.prepare(`SELECT ${columns.map(quote).join(", ")} FROM ${quote(table)}`).all() as Record<string, unknown>[]).map((row) => columns.map((column) => row[column] ?? null)),
    close: () => db.close(),
  };
}

/** Imports from the first of legacyPaths (newest first) that exists. */
export function importLegacyCanvases(db: Database.Database, legacyPaths: string | readonly string[], open: (path: string) => LegacyReader = openLegacyReadOnly, now: () => number = Date.now): LegacyImport {
  if (db.prepare("SELECT 1 FROM canvas_legacy_import").get()) return { status: "skipped", reason: "already-imported" };
  if (db.prepare("SELECT 1 FROM canvases LIMIT 1").get()) return { status: "skipped", reason: "store-not-empty" };
  const legacyPath = (typeof legacyPaths === "string" ? [legacyPaths] : legacyPaths).find((path) => existsSync(path));
  if (!legacyPath) return { status: "skipped", reason: "no-legacy-file" };
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
