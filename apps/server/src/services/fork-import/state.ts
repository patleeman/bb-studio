import Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const FORK_IMPORT_STATE_FILE_NAME = "fork-import.json";
export const FORK_IMPORT_DATABASE_FILE_NAME = "fork-import.db";

export interface ForkImportState {
  version: 1;
  sourceDataDir: string;
  sourceServerHostId: string | null;
  importedAt: number;
  sourceEventRowid: number;
}

export function readForkImportState(dataDir: string): ForkImportState | null {
  const path = join(dataDir, FORK_IMPORT_STATE_FILE_NAME);
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as ForkImportState;
    return value.version === 1 && typeof value.sourceDataDir === "string"
      ? value
      : null;
  } catch {
    return null;
  }
}

export type ForkImportDatabase = Database.Database;

const connections = new Map<string, ForkImportDatabase>();

export function openForkImportDatabase(dataDir: string): ForkImportDatabase {
  const path = join(dataDir, FORK_IMPORT_DATABASE_FILE_NAME);
  const open = connections.get(path);
  if (open?.open) return open;
  const database = new Database(path);
  database.pragma("journal_mode = WAL");
  database.pragma("busy_timeout = 5000");
  database.exec(`
    CREATE TABLE IF NOT EXISTS mirrored_threads (
      thread_id TEXT PRIMARY KEY NOT NULL,
      source_updated_at INTEGER NOT NULL,
      source_status TEXT NOT NULL,
      taken_over_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS taken_over_environments (
      environment_id TEXT PRIMARY KEY NOT NULL,
      taken_over_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cursors (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS plugin_rows (
      plugin_id TEXT NOT NULL,
      table_name TEXT NOT NULL,
      row_key TEXT NOT NULL,
      version TEXT NOT NULL,
      PRIMARY KEY (plugin_id, table_name, row_key)
    );
  `);
  connections.set(path, database);
  return database;
}

export function closeForkImportDatabases(): void {
  for (const database of connections.values()) {
    if (database.open) database.close();
  }
  connections.clear();
}

export function hasForkImport(dataDir: string): boolean {
  return existsSync(join(dataDir, FORK_IMPORT_DATABASE_FILE_NAME));
}

export function readCursor(
  database: ForkImportDatabase,
  key: string,
): string | null {
  return (
    database
      .prepare<[string], { value: string }>(
        "SELECT value FROM cursors WHERE key = ?",
      )
      .get(key)?.value ?? null
  );
}

export function writeCursor(
  database: ForkImportDatabase,
  key: string,
  value: string,
): void {
  database
    .prepare(
      "INSERT INTO cursors (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, value);
}

export interface MirroredThread {
  threadId: string;
  sourceUpdatedAt: number;
  sourceStatus: string;
  takenOverAt: number | null;
}

export function getMirroredThread(
  dataDir: string,
  threadId: string,
): MirroredThread | null {
  if (!hasForkImport(dataDir)) return null;
  const row = openForkImportDatabase(dataDir)
    .prepare<
      [string],
      {
        thread_id: string;
        source_updated_at: number;
        source_status: string;
        taken_over_at: number | null;
      }
    >("SELECT * FROM mirrored_threads WHERE thread_id = ?")
    .get(threadId);
  return row === undefined
    ? null
    : {
        threadId: row.thread_id,
        sourceUpdatedAt: row.source_updated_at,
        sourceStatus: row.source_status,
        takenOverAt: row.taken_over_at,
      };
}

export function isMirroredReadOnly(dataDir: string, threadId: string): boolean {
  const mirrored = getMirroredThread(dataDir, threadId);
  return mirrored !== null && mirrored.takenOverAt === null;
}
