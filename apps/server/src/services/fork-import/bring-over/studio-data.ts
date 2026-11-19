import Database from "better-sqlite3";
import { chmod, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BringOverError,
  copyFileIfMissing,
  copyMissingTree,
  errorDetail,
  exists,
} from "./files.js";
import { snapshotDatabases } from "./snapshot.js";
import {
  BRING_OVER_DIR_NAME,
  openSnapshot,
  type SourceSnapshot,
} from "./source.js";
import {
  importThread,
  referencedFirst,
  type ThreadImportContext,
} from "./threads.js";

type Sqlite = Database.Database;

export const STUDIO_PLUGIN_ID = "studio";

const CONTENT_TABLES = [
  "memory_records",
  "tasks",
  "bot_loops",
  "artifacts",
  "minis",
  "designs",
  "drawings",
  "recordings",
  "dashboards",
];
const KEPT_HERE = new Set(["secrets", "logs", "host-data", "bridge-data"]);
const NOT_COPIED = new Set([
  ...KEPT_HERE,
  "backup-sessions",
  "data.db",
  "data.db-wal",
  "data.db-shm",
  "data.db-journal",
]);
const STUDIO_SCRUB = [
  "UPDATE bots SET state = 'stopped', heartbeat_was_on = 0",
  "UPDATE bot_runners SET state = 'paused'",
  "UPDATE bot_automations SET state = 'paused'",
  "UPDATE bot_cache_settings SET enabled = 0",
];
const DATABASE_RELEASE_WAIT_MS = 10_000;

export interface StudioDataState {
  inBb: boolean;
  offered: boolean;
  reason: string | null;
  bots: number;
  pages: number;
  tasks: number;
}

export interface StudioController {
  setEnabled(id: string, enabled: boolean): Promise<unknown>;
  databaseOpen(id: string): boolean;
}

function countRows(db: Sqlite, table: string): number {
  try {
    return (
      db
        .prepare<[], { count: number }>(
          `SELECT COUNT(*) AS count FROM "${table}"`,
        )
        .get()?.count ?? 0
    );
  } catch {
    return 0;
  }
}

function withDatabase<T>(
  path: string,
  read: (db: Sqlite) => T,
  fallback: T,
): T {
  let db: Sqlite | null = null;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
    db.pragma("busy_timeout = 1000");
    return read(db);
  } catch {
    return fallback;
  } finally {
    db?.close();
  }
}

function studioDatabase(root: string): string {
  return join(root, "plugins", STUDIO_PLUGIN_ID, "data.db");
}

function ownPages(db: Sqlite): number {
  try {
    return (
      db
        .prepare<[], { count: number }>(
          "SELECT COUNT(*) AS count FROM pages WHERE id NOT IN (SELECT memory_page_id FROM bots WHERE memory_page_id IS NOT NULL)",
        )
        .get()?.count ?? 0
    );
  } catch {
    return countRows(db, "pages");
  }
}

export function studioHasOwnData(dataDir: string): boolean {
  return withDatabase(
    studioDatabase(dataDir),
    (db) =>
      countRows(db, "bots") > 1 ||
      ownPages(db) > 0 ||
      CONTENT_TABLES.some((table) => countRows(db, table) > 0),
    false,
  );
}

export async function studioDataState(
  dataDir: string,
  sourceDataDir: string,
): Promise<StudioDataState> {
  const source = studioDatabase(sourceDataDir);
  const inBb = await exists(source);
  const counts = withDatabase(
    source,
    (db) => ({
      bots: countRows(db, "bots"),
      pages: countRows(db, "pages"),
      tasks: countRows(db, "tasks") + countRows(db, "bot_loops"),
    }),
    { bots: 0, pages: 0, tasks: 0 },
  );
  const own = studioHasOwnData(dataDir);
  return {
    inBb,
    offered: inBb && !own,
    reason: !inBb
      ? "bb has no BB Studio data"
      : own
        ? "BB Studio already has Bots, pages or tasks of its own"
        : null,
    ...counts,
  };
}

export function referencedThreadIds(db: Sqlite): string[] {
  const ids = new Set<string>();
  const tables = db
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .all();
  for (const { name: table } of tables) {
    const columns = db
      .prepare<[], { name: string }>(
        `SELECT name FROM pragma_table_info('${table.replace(/'/gu, "''")}')`,
      )
      .all()
      .map((column) => column.name)
      .filter((column) => /thread_id$/u.test(column));
    for (const column of columns) {
      for (const row of db
        .prepare<[], { value: unknown }>(
          `SELECT DISTINCT "${column}" AS value FROM "${table}" WHERE "${column}" LIKE 'thr\\_%' ESCAPE '\\'`,
        )
        .all()) {
        if (typeof row.value === "string") ids.add(row.value);
      }
    }
  }
  return [...ids].sort();
}

function scrub(path: string): void {
  const db = new Database(path, { fileMustExist: true });
  try {
    db.pragma("foreign_keys = OFF");
    for (const statement of STUDIO_SCRUB) {
      try {
        db.exec(statement);
      } catch (error) {
        if (!/no such (table|column)/u.test(String(error))) throw error;
      }
    }
    db.pragma("journal_mode = DELETE");
  } finally {
    db.close();
  }
}

async function waitForRelease(controller: StudioController): Promise<void> {
  const deadline = Date.now() + DATABASE_RELEASE_WAIT_MS;
  while (controller.databaseOpen(STUDIO_PLUGIN_ID)) {
    if (Date.now() > deadline) {
      throw new BringOverError("BB Studio's own data did not close in time");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

type KvRow = { table: string; key: string; value: string; updated_at: number };

function studioRows(db: Sqlite): KvRow[] {
  const rows: KvRow[] = [];
  for (const table of ["plugin_kv", "plugin_settings"]) {
    try {
      for (const row of db
        .prepare<[string], Omit<KvRow, "table">>(
          `SELECT key, value, updated_at FROM ${table} WHERE plugin_id = ?`,
        )
        .all(STUDIO_PLUGIN_ID)) {
        rows.push({ table, ...row });
      }
    } catch {}
  }
  return rows;
}

function replaceStudioRows(target: Sqlite, rows: readonly KvRow[]): void {
  target.transaction(() => {
    for (const table of ["plugin_kv", "plugin_settings"]) {
      target
        .prepare(`DELETE FROM ${table} WHERE plugin_id = ?`)
        .run(STUDIO_PLUGIN_ID);
    }
    for (const row of rows) {
      target
        .prepare(
          `INSERT INTO ${row.table} (plugin_id, key, value, updated_at) VALUES (?, ?, ?, ?)`,
        )
        .run(STUDIO_PLUGIN_ID, row.key, row.value, row.updated_at);
    }
  })();
}

export interface StudioDataResult {
  threads: number;
  threadsHere: number;
  bots: number;
}

export async function bringOverStudioData(args: {
  dataDir: string;
  snapshot: SourceSnapshot;
  target: Sqlite;
  ourHostId: string | null;
  controller: StudioController;
  now: number;
}): Promise<StudioDataResult> {
  const { dataDir, snapshot, target } = args;
  const state = await studioDataState(dataDir, snapshot.sourceDataDir);
  if (!state.offered) throw new BringOverError(state.reason ?? "not offered");
  const sourceDir = join(snapshot.sourceDataDir, "plugins", STUDIO_PLUGIN_ID);
  const targetDir = join(dataDir, "plugins", STUDIO_PLUGIN_ID);
  const work = join(dataDir, BRING_OVER_DIR_NAME, `studio-${String(args.now)}`);
  const staged = join(work, "staged");
  const aside = join(work, "before");
  await rm(work, { force: true, recursive: true });
  await mkdir(staged, { recursive: true, mode: 0o700 });
  await chmod(work, 0o700);
  let swapped = false;
  try {
    await snapshotDatabases([
      { from: join(sourceDir, "data.db"), to: join(staged, "data.db") },
    ]);
    scrub(join(staged, "data.db"));
    for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
      if (NOT_COPIED.has(entry.name)) continue;
      if (entry.isDirectory()) {
        await copyMissingTree(
          join(sourceDir, entry.name),
          join(staged, entry.name),
        );
      } else if (entry.isFile()) {
        await copyFileIfMissing(
          join(sourceDir, entry.name),
          join(staged, entry.name),
        );
      }
    }
    if (!(await exists(join(staged, "onboarding.json")))) {
      await writeFile(
        join(staged, "onboarding.json"),
        `${JSON.stringify({ version: 1, state: "done", reason: "import", at: args.now, botId: null, welcomeThreadId: null, opened: true })}\n`,
      );
    }

    const source = openSnapshot(snapshot);
    let threads = 0;
    let threadsHere = 0;
    try {
      const wanted = withDatabase(
        join(staged, "data.db"),
        referencedThreadIds,
        [],
      );
      const inBb = wanted.filter(
        (id) =>
          source
            .prepare(
              "SELECT 1 FROM threads WHERE id = ? AND deleted_at IS NULL",
            )
            .get(id) !== undefined,
      );
      const context: ThreadImportContext = {
        source,
        target,
        dataDir,
        sourceDataDir: snapshot.sourceDataDir,
        sourceHostId: snapshot.sourceHostId,
        ourHostId: args.ourHostId,
        attachments: true,
      };
      const failed: string[] = [];
      for (const id of referencedFirst(source, inBb)) {
        try {
          const result = await importThread(context, id);
          if (result.imported) threads += 1;
          else threadsHere += 1;
        } catch (error) {
          failed.push(`${id}: ${errorDetail(error)}`);
        }
      }
      if (failed.length > 0) {
        throw new BringOverError(
          `${String(failed.length)} of the Bots' threads could not be brought over (${failed.slice(0, 3).join("; ")})`,
        );
      }
    } finally {
      source.close();
    }

    const bbRows = withDatabase(
      join(snapshot.sourceDataDir, "bb.db"),
      studioRows,
      [],
    ).map((row) =>
      row.key === "loopsEnabled" && row.table === "plugin_settings"
        ? { ...row, value: "false" }
        : row,
    );
    const ourRows = studioRows(target);
    await args.controller.setEnabled(STUDIO_PLUGIN_ID, false);
    try {
      await waitForRelease(args.controller);
      await mkdir(aside, { recursive: true });
      await mkdir(targetDir, { recursive: true });
      const moved: string[] = [];
      const placed: string[] = [];
      try {
        for (const name of await readdir(targetDir)) {
          if (KEPT_HERE.has(name)) continue;
          await rename(join(targetDir, name), join(aside, name));
          moved.push(name);
        }
        for (const name of await readdir(staged)) {
          await rename(join(staged, name), join(targetDir, name));
          placed.push(name);
        }
        replaceStudioRows(target, bbRows);
        swapped = true;
      } catch (error) {
        for (const name of placed) {
          await rm(join(targetDir, name), { force: true, recursive: true });
        }
        for (const name of moved)
          await rename(join(aside, name), join(targetDir, name));
        replaceStudioRows(target, ourRows);
        throw error;
      }
    } finally {
      await args.controller.setEnabled(STUDIO_PLUGIN_ID, true);
    }
    return { threads, threadsHere, bots: state.bots };
  } finally {
    await rm(staged, { force: true, recursive: true });
    if (!swapped) await rm(work, { force: true, recursive: true });
  }
}
