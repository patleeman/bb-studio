import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  openForkImportDatabase,
  readCursor,
  readForkImportState,
  writeCursor,
  type ForkImportDatabase,
} from "./state.js";
import { sharedColumns } from "./sync.js";

type Sqlite = Database.Database;

const SKIPPED_PLUGINS = new Set([
  "account-pool",
  "mobile",
  "push-notifications",
  "automations",
  "storage-retention",
  "bb--storage-retention",
]);

const SKIPPED_TABLES: Readonly<Record<string, RegExp>> = {
  studio:
    /^(bots$|bot_(?!loops$)|loop_scheduler$|automation_|runner_|mini_secrets$|space_retired_automations$|next_suggestions$|account_warnings$)/u,
};

const ALWAYS_SKIPPED_TABLE = /^(sqlite_|_bb_migrations$)|_fts(_|$)/u;
const ROW_HASH_FUNCTION = "fork_row_hash";
const NOTES_PER_TABLE = 3;

export interface PluginSyncSummary {
  skipped: string | null;
  plugins: number;
  rowsWritten: number;
  rowsDeleted: number;
  rowsKeptHere: number;
  tablesReloaded: number;
  notes: string[];
}

interface TableShape {
  table: string;
  columns: string[];
  key: string[];
  hasUpdatedAt: boolean;
}

interface RowVersion {
  key: unknown[];
  updatedAt: unknown;
  version: string;
}

interface TableSync {
  fork: ForkImportDatabase;
  pluginId: string;
  shape: TableShape;
  source: Sqlite;
  target: Sqlite;
  summary: PluginSyncSummary;
}

function quote(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export function hashValues(values: readonly unknown[]): string {
  const hash = createHash("sha1");
  for (const value of values) {
    if (value === null || value === undefined) {
      hash.update("\u0000n");
    } else if (Buffer.isBuffer(value)) {
      hash.update(`\u0000b${String(value.length)}:`);
      hash.update(value);
    } else {
      const text = String(value);
      hash.update(`\u0000${typeof value}${String(text.length)}:`);
      hash.update(text);
    }
  }
  return hash.digest("base64");
}

function withRowHash(database: Sqlite): Sqlite {
  database.function(
    ROW_HASH_FUNCTION,
    { varargs: true, deterministic: true },
    (...values: unknown[]) => hashValues(values),
  );
  return database;
}

function tablesOf(database: Sqlite): string[] {
  return database
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    .all()
    .map((row) => row.name);
}

function primaryKeyOf(database: Sqlite, table: string): string[] {
  return database
    .prepare<[string], { name: string }>(
      "SELECT name FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk",
    )
    .all(table)
    .map((row) => row.name);
}

function migrationCount(database: Sqlite): number {
  try {
    return (
      database
        .prepare<[], { count: number }>(
          "SELECT COUNT(*) AS count FROM _bb_migrations",
        )
        .get()?.count ?? 0
    );
  } catch {
    return 0;
  }
}

function syncedTables(
  pluginId: string,
  source: Sqlite,
  target: Sqlite,
): TableShape[] {
  const ours = new Set(tablesOf(target));
  const skipped = SKIPPED_TABLES[pluginId];
  return tablesOf(source)
    .filter(
      (table) =>
        ours.has(table) &&
        !ALWAYS_SKIPPED_TABLE.test(table) &&
        !(skipped?.test(table) ?? false),
    )
    .map((table) => {
      const columns = sharedColumns(source, target, table);
      const key = primaryKeyOf(target, table);
      return {
        table,
        columns,
        key: key.every((column) => columns.includes(column)) ? key : [],
        hasUpdatedAt: columns.includes("updated_at"),
      };
    })
    .filter((shape) => shape.columns.length > 0);
}

function pluginDatabases(dataDir: string): string[] {
  const root = join(dataDir, "plugins");
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !SKIPPED_PLUGINS.has(entry.name) &&
        existsSync(join(root, entry.name, "data.db")),
    )
    .map((entry) => entry.name);
}

function markerKey(pluginId: string, table: string): string {
  return `plugin:${pluginId}:${table}:shape`;
}

function tableVersionKey(pluginId: string, table: string): string {
  return `plugin:${pluginId}:${table}:table`;
}

function shapeMarker(shape: TableShape): string {
  return JSON.stringify({ columns: shape.columns, key: shape.key });
}

function readVersions(
  database: Sqlite,
  shape: TableShape,
): Map<string, RowVersion> {
  const select = [
    ...shape.key.map(quote),
    shape.hasUpdatedAt ? quote("updated_at") : "NULL",
    `${ROW_HASH_FUNCTION}(${shape.columns.map(quote).join(", ")})`,
  ];
  const rows = database
    .prepare(`SELECT ${select.join(", ")} FROM ${quote(shape.table)}`)
    .raw()
    .all() as unknown[][];
  const versions = new Map<string, RowVersion>();
  for (const row of rows) {
    const key = row.slice(0, shape.key.length);
    versions.set(JSON.stringify(key), {
      key,
      updatedAt: row[shape.key.length],
      version: String(row[shape.key.length + 1]),
    });
  }
  return versions;
}

function tableVersion(database: Sqlite, shape: TableShape): string {
  const rows = database
    .prepare(
      `SELECT ${ROW_HASH_FUNCTION}(${shape.columns.map(quote).join(", ")}) FROM ${quote(shape.table)}`,
    )
    .pluck()
    .all() as string[];
  return hashValues(rows.sort());
}

function readBaseline(
  fork: ForkImportDatabase,
  pluginId: string,
  table: string,
): Map<string, string> {
  return new Map(
    fork
      .prepare<[string, string], { row_key: string; version: string }>(
        "SELECT row_key, version FROM plugin_rows WHERE plugin_id = ? AND table_name = ?",
      )
      .all(pluginId, table)
      .map((row) => [row.row_key, row.version]),
  );
}

function writeBaseline(
  fork: ForkImportDatabase,
  pluginId: string,
  table: string,
  changes: { settled: Iterable<[string, string]>; dropped: Iterable<string> },
): void {
  const upsert = fork.prepare(
    `INSERT INTO plugin_rows (plugin_id, table_name, row_key, version) VALUES (?, ?, ?, ?)
     ON CONFLICT(plugin_id, table_name, row_key) DO UPDATE SET version = excluded.version`,
  );
  const remove = fork.prepare(
    "DELETE FROM plugin_rows WHERE plugin_id = ? AND table_name = ? AND row_key = ?",
  );
  fork.transaction(() => {
    for (const [key, version] of changes.settled) {
      upsert.run(pluginId, table, key, version);
    }
    for (const key of changes.dropped) remove.run(pluginId, table, key);
  })();
}

function replaceBaseline(
  fork: ForkImportDatabase,
  pluginId: string,
  shape: TableShape,
  rows: Iterable<[string, string]>,
): void {
  fork.transaction(() => {
    fork
      .prepare("DELETE FROM plugin_rows WHERE plugin_id = ? AND table_name = ?")
      .run(pluginId, shape.table);
    fork
      .prepare("DELETE FROM cursors WHERE key IN (?, ?, ?)")
      .run(
        `plugin:${pluginId}:${shape.table}:updated_at`,
        `plugin:${pluginId}:${shape.table}:fingerprint`,
        tableVersionKey(pluginId, shape.table),
      );
    writeBaseline(fork, pluginId, shape.table, { settled: rows, dropped: [] });
    writeCursor(fork, markerKey(pluginId, shape.table), shapeMarker(shape));
  })();
}

function newerHere(here: unknown, theirs: unknown): boolean {
  if (typeof here === "number" && typeof theirs === "number") {
    return here > theirs;
  }
  if (typeof here === "string" && typeof theirs === "string") {
    return here > theirs;
  }
  return false;
}

function noteFailures(
  summary: PluginSyncSummary,
  label: string,
  failures: readonly string[],
): void {
  for (const failure of failures.slice(0, NOTES_PER_TABLE)) {
    summary.notes.push(`${label} ${failure}`);
  }
  if (failures.length > NOTES_PER_TABLE) {
    summary.notes.push(
      `${label}: ${String(failures.length - NOTES_PER_TABLE)} more rows could not be applied`,
    );
  }
}

function syncKeyedTable(args: TableSync): void {
  const { fork, pluginId, shape, source, target, summary } = args;
  const { table, columns, key } = shape;
  const ours = readVersions(target, shape);
  let baseline = readBaseline(fork, pluginId, table);
  const where = key.map((column) => `${quote(column)} = ?`).join(" AND ");
  const fetch = source
    .prepare(
      `SELECT ${columns.map(quote).join(", ")} FROM ${quote(table)} WHERE ${where}`,
    )
    .raw();
  const { theirs, rows } = source.transaction(() => {
    const versions = readVersions(source, shape);
    if (readCursor(fork, markerKey(pluginId, table)) !== shapeMarker(shape)) {
      const seeded = new Map<string, string>();
      for (const [rowKey, row] of ours) {
        if (versions.has(rowKey) || baseline.has(rowKey)) {
          seeded.set(rowKey, row.version);
        }
      }
      replaceBaseline(fork, pluginId, shape, seeded);
      baseline = seeded;
    }
    const changed = new Map<string, unknown[]>();
    for (const [rowKey, row] of versions) {
      if (baseline.get(rowKey) === row.version) continue;
      const values = fetch.get(...row.key) as unknown[] | undefined;
      if (values !== undefined) changed.set(rowKey, values);
    }
    return { theirs: versions, rows: changed };
  })();

  const settled = new Map<string, string>();
  const dropped: string[] = [];
  const failures: string[] = [];
  const nonKey = columns.filter((column) => !key.includes(column));
  const keyIndexes = key.map((column) => columns.indexOf(column));
  const nonKeyIndexes = nonKey.map((column) => columns.indexOf(column));
  const update =
    nonKey.length === 0
      ? null
      : target.prepare(
          `UPDATE ${quote(table)} SET ${nonKey.map((column) => `${quote(column)} = ?`).join(", ")} WHERE ${where}`,
        );
  const insert = target.prepare(
    `INSERT INTO ${quote(table)} (${columns.map(quote).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
  );
  const remove = target.prepare(`DELETE FROM ${quote(table)} WHERE ${where}`);

  target.transaction(() => {
    for (const [rowKey, values] of rows) {
      const row = theirs.get(rowKey);
      if (row === undefined) continue;
      const here = ours.get(rowKey);
      if (here?.version === row.version) {
        settled.set(rowKey, row.version);
        continue;
      }
      if (
        here !== undefined &&
        shape.hasUpdatedAt &&
        newerHere(here.updatedAt, row.updatedAt)
      ) {
        summary.rowsKeptHere += 1;
        settled.set(rowKey, row.version);
        continue;
      }
      try {
        const keyValues = keyIndexes.map((index) => values[index]);
        const updated =
          here !== undefined && update !== null
            ? update.run(
                ...nonKeyIndexes.map((index) => values[index]),
                ...keyValues,
              ).changes
            : 0;
        if (updated === 0) insert.run(...values);
        summary.rowsWritten += 1;
        settled.set(rowKey, row.version);
      } catch (error) {
        failures.push(`${rowKey}: ${String(error)}`);
      }
    }
    for (const [rowKey, version] of baseline) {
      if (theirs.has(rowKey)) continue;
      const here = ours.get(rowKey);
      try {
        if (here !== undefined && here.version === version) {
          remove.run(...here.key);
          summary.rowsDeleted += 1;
        } else if (here !== undefined) {
          summary.rowsKeptHere += 1;
        }
        dropped.push(rowKey);
      } catch (error) {
        failures.push(`${rowKey}: ${String(error)}`);
      }
    }
  })();
  writeBaseline(fork, pluginId, table, { settled, dropped });
  noteFailures(summary, `${pluginId}.${table}`, failures);
}

function syncWholeTable(args: TableSync): void {
  const { fork, pluginId, shape, source, target, summary } = args;
  const versionKey = tableVersionKey(pluginId, shape.table);
  if (
    readCursor(fork, markerKey(pluginId, shape.table)) !== shapeMarker(shape)
  ) {
    replaceBaseline(fork, pluginId, shape, []);
    writeCursor(fork, versionKey, tableVersion(target, shape));
  }
  const baseline = readCursor(fork, versionKey);
  const list = shape.columns.map(quote).join(", ");
  const { theirs, rows } = source.transaction(() => ({
    theirs: tableVersion(source, shape),
    rows: source
      .prepare(`SELECT ${list} FROM ${quote(shape.table)}`)
      .raw()
      .all() as unknown[][],
  }))();
  if (theirs === baseline) return;
  const ours = tableVersion(target, shape);
  if (ours !== theirs && ours !== baseline) {
    summary.notes.push(
      `${pluginId}.${shape.table}: changed on both sides and has no key; kept as it is here`,
    );
  } else if (ours !== theirs) {
    target.transaction(() => {
      target.prepare(`DELETE FROM ${quote(shape.table)}`).run();
      const insert = target.prepare(
        `INSERT INTO ${quote(shape.table)} (${list}) VALUES (${shape.columns.map(() => "?").join(", ")})`,
      );
      for (const row of rows) insert.run(...row);
    })();
    summary.tablesReloaded += 1;
  }
  writeCursor(fork, versionKey, theirs);
}

export function recordPluginBaselines(dataDir: string): void {
  const fork = openForkImportDatabase(dataDir);
  for (const pluginId of pluginDatabases(dataDir)) {
    const database = withRowHash(
      new Database(join(dataDir, "plugins", pluginId, "data.db"), {
        fileMustExist: true,
        readonly: true,
      }),
    );
    try {
      for (const shape of syncedTables(pluginId, database, database)) {
        if (shape.key.length === 0) {
          replaceBaseline(fork, pluginId, shape, []);
          writeCursor(
            fork,
            tableVersionKey(pluginId, shape.table),
            tableVersion(database, shape),
          );
        } else {
          replaceBaseline(
            fork,
            pluginId,
            shape,
            [...readVersions(database, shape)].map(([key, row]) => [
              key,
              row.version,
            ]),
          );
        }
      }
    } finally {
      database.close();
    }
  }
}

export function runForkPluginSync(args: {
  dataDir: string;
}): PluginSyncSummary | null {
  const state = readForkImportState(args.dataDir);
  if (state === null) return null;
  const summary: PluginSyncSummary = {
    skipped: null,
    plugins: 0,
    rowsWritten: 0,
    rowsDeleted: 0,
    rowsKeptHere: 0,
    tablesReloaded: 0,
    notes: [],
  };
  const fork = openForkImportDatabase(args.dataDir);
  if (readCursor(fork, "paused") === "true") {
    return { ...summary, skipped: "Sync is paused" };
  }
  for (const pluginId of pluginDatabases(args.dataDir)) {
    const sourcePath = join(
      state.sourceDataDir,
      "plugins",
      pluginId,
      "data.db",
    );
    if (!existsSync(sourcePath)) continue;
    const source = withRowHash(
      new Database(sourcePath, { fileMustExist: true, readonly: true }),
    );
    const target = withRowHash(
      new Database(join(args.dataDir, "plugins", pluginId, "data.db"), {
        fileMustExist: true,
      }),
    );
    try {
      source.pragma("busy_timeout = 2000");
      target.pragma("busy_timeout = 5000");
      if (migrationCount(source) > migrationCount(target)) {
        summary.notes.push(
          `${pluginId}: the source has a newer database layout; skipped until this side catches up`,
        );
        continue;
      }
      summary.plugins += 1;
      for (const shape of syncedTables(pluginId, source, target)) {
        const tableArgs = { fork, pluginId, shape, source, target, summary };
        try {
          if (shape.key.length > 0) {
            syncKeyedTable(tableArgs);
          } else {
            syncWholeTable(tableArgs);
          }
        } catch (error) {
          summary.notes.push(`${pluginId}.${shape.table}: ${String(error)}`);
        }
      }
    } finally {
      source.close();
      target.close();
    }
  }
  writeCursor(fork, "lastPluginSyncAt", String(Date.now()));
  writeCursor(fork, "lastPluginSummary", JSON.stringify(summary));
  return summary;
}
