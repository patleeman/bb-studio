import Database from "better-sqlite3";
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { cp, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ServerLogger } from "../../types.js";
import {
  openForkImportDatabase,
  readCursor,
  readForkImportState,
  writeCursor,
  type ForkImportDatabase,
} from "./state.js";

type Sqlite = Database.Database;
type Row = Record<string, unknown>;

const RUNNING_STATUSES = new Set(["starting", "active", "stopping"]);
const THREAD_SCOPED_TABLES = [
  "thread_plugin_metadata",
  "thread_conversation_outlines",
  "thread_tabs",
  "project_attachment_threads",
  "prompt_history_entries",
  "thread_search_segments",
];
const THREAD_REFERENCE_COLUMNS = [
  "parent_thread_id",
  "source_thread_id",
  "lifecycle_owner_thread_id",
];
const DELETION_CHECK_INTERVAL_MS = 10 * 60_000;

export interface ForkSyncSummary {
  skipped: string | null;
  projects: number;
  environments: number;
  threads: number;
  eventsAdded: number;
  eventReloads: number;
  threadsDeleted: number;
  conflicts: string[];
}

export interface RunForkImportSyncArgs {
  dataDir: string;
  database: Sqlite;
  logger: Pick<ServerLogger, "info" | "warn">;
  now: number;
}

function columnsOf(database: Sqlite, table: string): string[] {
  return database
    .prepare<[string], { name: string }>(
      "SELECT name FROM pragma_table_info(?)",
    )
    .all(table)
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

function quote(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export function sharedColumns(
  source: Sqlite,
  target: Sqlite,
  table: string,
): string[] {
  const ours = new Set(columnsOf(target, table));
  return columnsOf(source, table).filter((column) => ours.has(column));
}

export function upsertRows(
  target: Sqlite,
  table: string,
  columns: readonly string[],
  rows: readonly Row[],
): number {
  if (rows.length === 0 || columns.length === 0) return 0;
  const key = primaryKeyOf(target, table);
  const list = columns.map(quote).join(", ");
  const values = columns.map((column) => `@${column}`).join(", ");
  const updates = columns
    .filter((column) => !key.includes(column))
    .map((column) => `${quote(column)} = excluded.${quote(column)}`)
    .join(", ");
  const conflict =
    key.length === 0
      ? ""
      : updates.length === 0
        ? ` ON CONFLICT(${key.map(quote).join(", ")}) DO NOTHING`
        : ` ON CONFLICT(${key.map(quote).join(", ")}) DO UPDATE SET ${updates}`;
  const statement = target.prepare(
    `INSERT INTO ${quote(table)} (${list}) VALUES (${values})${conflict}`,
  );
  let written = 0;
  for (const row of rows) {
    const bound: Row = {};
    for (const column of columns) bound[column] = row[column] ?? null;
    written += statement.run(bound).changes;
  }
  return written;
}

function selectList(columns: readonly string[]): string {
  return columns.map(quote).join(", ");
}

function readHostId(dataDir: string): string | null {
  try {
    const value = readFileSync(join(dataDir, "host-id"), "utf8").trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function rowExists(database: Sqlite, table: string, id: string): boolean {
  return (
    database
      .prepare<[string], { found: number }>(
        `SELECT 1 AS found FROM ${quote(table)} WHERE id = ?`,
      )
      .get(id) !== undefined
  );
}

function syncUpdatedTable(
  source: Sqlite,
  target: Sqlite,
  fork: ForkImportDatabase,
  table: string,
  skip: (row: Row) => boolean,
  conflicts: string[],
): number {
  const columns = sharedColumns(source, target, table);
  if (!columns.includes("updated_at") || !columns.includes("id")) return 0;
  const cursorKey = `${table}.updated_at`;
  const cursor = Number(
    readCursor(fork, cursorKey) ??
      target
        .prepare<[], { value: number | null }>(
          `SELECT MAX(updated_at) AS value FROM ${quote(table)}`,
        )
        .get()?.value ??
      0,
  );
  const rows = source
    .prepare<[number], Row>(
      `SELECT ${selectList(columns)} FROM ${quote(table)} WHERE updated_at > ? ORDER BY updated_at`,
    )
    .all(cursor);
  let written = 0;
  let newest = cursor;
  for (const row of rows) {
    newest = Math.max(newest, Number(row.updated_at));
    if (skip(row)) continue;
    try {
      written += upsertRows(target, table, columns, [row]);
    } catch (error) {
      conflicts.push(`${table} ${String(row.id)}: ${String(error)}`);
    }
  }
  writeCursor(fork, cursorKey, String(newest));
  return written;
}

function ensureHosts(source: Sqlite, target: Sqlite): void {
  const columns = sharedColumns(source, target, "hosts");
  const rows = source
    .prepare<[], Row>(`SELECT ${selectList(columns)} FROM hosts`)
    .all();
  const insert = target.prepare(
    `INSERT OR IGNORE INTO hosts (${selectList(columns)}) VALUES (${columns.map((column) => `@${column}`).join(", ")})`,
  );
  for (const row of rows) {
    if (!rowExists(target, "hosts", String(row.id))) insert.run(row);
  }
}

function syncProjectSources(
  source: Sqlite,
  target: Sqlite,
  sourceHostId: string | null,
  ourHostId: string | null,
  conflicts: string[],
): void {
  if (ourHostId === null || !rowExists(target, "hosts", ourHostId)) return;
  if (sourceHostId !== null && sourceHostId !== ourHostId) {
    target
      .prepare(
        `UPDATE project_sources SET host_id = @ours
         WHERE host_id = @theirs AND NOT EXISTS (
           SELECT 1 FROM project_sources other
           WHERE other.project_id = project_sources.project_id AND other.host_id = @ours
         )`,
      )
      .run({ ours: ourHostId, theirs: sourceHostId });
  }
  const columns = sharedColumns(source, target, "project_sources");
  const rows = source
    .prepare<[], Row>(`SELECT ${selectList(columns)} FROM project_sources`)
    .all();
  const taken = target.prepare<[string, string | null], { found: number }>(
    "SELECT 1 AS found FROM project_sources WHERE project_id = ? AND host_id IS ?",
  );
  const hasDefault = target.prepare<[string], { found: number }>(
    "SELECT 1 AS found FROM project_sources WHERE project_id = ? AND is_default = 1",
  );
  for (const row of rows) {
    const hostId = row.host_id === sourceHostId ? ourHostId : row.host_id;
    const projectId = String(row.project_id);
    if (rowExists(target, "project_sources", String(row.id))) continue;
    if (!rowExists(target, "projects", projectId)) continue;
    if (taken.get(projectId, hostId as string | null) !== undefined) continue;
    try {
      upsertRows(target, "project_sources", columns, [
        {
          ...row,
          host_id: hostId,
          is_default:
            hasDefault.get(projectId) === undefined ? row.is_default : 0,
        },
      ]);
    } catch (error) {
      conflicts.push(`project_sources ${String(row.id)}: ${String(error)}`);
    }
  }
}

function copyIfMissing(sourcePath: string, targetPath: string): void {
  if (!existsSync(sourcePath) || existsSync(targetPath)) return;
  mkdirSync(dirname(targetPath), { recursive: true });
  cpSync(sourcePath, targetPath, { recursive: true });
}

interface ThreadSyncContext {
  source: Sqlite;
  target: Sqlite;
  fork: ForkImportDatabase;
  dataDir: string;
  sourceDataDir: string;
  summary: ForkSyncSummary;
}

function ensureEnvironment(context: ThreadSyncContext, id: string): boolean {
  const { source, target, fork } = context;
  if (rowExists(target, "environments", id)) return true;
  if (
    fork
      .prepare("SELECT 1 FROM taken_over_environments WHERE environment_id = ?")
      .get(id) !== undefined
  ) {
    return false;
  }
  const columns = sharedColumns(source, target, "environments");
  const row = source
    .prepare<[string], Row>(
      `SELECT ${selectList(columns)} FROM environments WHERE id = ?`,
    )
    .get(id);
  if (row === undefined) return false;
  try {
    upsertRows(target, "environments", columns, [row]);
    return true;
  } catch (error) {
    context.summary.conflicts.push(`environments ${id}: ${String(error)}`);
    return false;
  }
}

function syncThreadEvents(context: ThreadSyncContext, threadId: string): void {
  const { source, target, summary } = context;
  const columns = sharedColumns(source, target, "events");
  const ours = target
    .prepare<[string], { count: number; last: number | null }>(
      "SELECT COUNT(*) AS count, MAX(sequence) AS last FROM events WHERE thread_id = ?",
    )
    .get(threadId) ?? { count: 0, last: null };
  const last = ours.last ?? -1;
  const theirsUpToLast =
    source
      .prepare<[string, number], { count: number }>(
        "SELECT COUNT(*) AS count FROM events WHERE thread_id = ? AND sequence <= ?",
      )
      .get(threadId, last)?.count ?? 0;
  const environmentExists = target.prepare<[string], { found: number }>(
    "SELECT 1 AS found FROM environments WHERE id = ?",
  );
  const prepared = (row: Row): Row =>
    row.environment_id !== null &&
    environmentExists.get(String(row.environment_id)) === undefined
      ? { ...row, environment_id: null }
      : row;
  if (theirsUpToLast !== ours.count) {
    target.prepare("DELETE FROM events WHERE thread_id = ?").run(threadId);
    const rows = source
      .prepare<[string], Row>(
        `SELECT ${selectList(columns)} FROM events WHERE thread_id = ? ORDER BY sequence`,
      )
      .all(threadId);
    upsertRows(target, "events", columns, rows.map(prepared));
    summary.eventReloads += 1;
    return;
  }
  const rows = source
    .prepare<[string, number], Row>(
      `SELECT ${selectList(columns)} FROM events WHERE thread_id = ? AND sequence > ? ORDER BY sequence`,
    )
    .all(threadId, last);
  summary.eventsAdded += upsertRows(
    target,
    "events",
    columns,
    rows.map(prepared),
  );
}

function reloadThreadScopedTable(
  context: ThreadSyncContext,
  table: string,
  threadId: string,
): void {
  const { source, target } = context;
  const columns = sharedColumns(source, target, table);
  if (!columns.includes("thread_id")) return;
  const rows = source
    .prepare<[string], Row>(
      `SELECT ${selectList(columns)} FROM ${quote(table)} WHERE thread_id = ?`,
    )
    .all(threadId);
  if (table === "project_attachment_threads") {
    const attachmentColumns = sharedColumns(
      source,
      target,
      "project_attachments",
    );
    for (const row of rows) {
      const attachmentId = String(row.attachment_id);
      if (rowExists(target, "project_attachments", attachmentId)) continue;
      const attachment = source
        .prepare<[string], Row>(
          `SELECT ${selectList(attachmentColumns)} FROM project_attachments WHERE id = ?`,
        )
        .get(attachmentId);
      if (attachment === undefined) continue;
      upsertRows(target, "project_attachments", attachmentColumns, [
        attachment,
      ]);
      const relative = join(
        "attachments",
        String(attachment.project_id),
        String(attachment.stored_path),
      );
      try {
        copyIfMissing(
          join(context.sourceDataDir, relative),
          join(context.dataDir, relative),
        );
      } catch (error) {
        context.summary.conflicts.push(
          `attachment file ${relative}: ${String(error)}`,
        );
      }
    }
  }
  target
    .prepare(`DELETE FROM ${quote(table)} WHERE thread_id = ?`)
    .run(threadId);
  const existingAttachments = rows.filter(
    (row) =>
      table !== "project_attachment_threads" ||
      rowExists(target, "project_attachments", String(row.attachment_id)),
  );
  upsertRows(target, table, columns, existingAttachments);
}

function syncThread(context: ThreadSyncContext, threadId: string): void {
  const { source, target, fork, summary } = context;
  const columns = sharedColumns(source, target, "threads");
  const row = source
    .prepare<[string], Row>(
      `SELECT ${selectList(columns)} FROM threads WHERE id = ?`,
    )
    .get(threadId);
  if (row === undefined) return;
  const mirrored = fork
    .prepare<[string], { taken_over_at: number | null }>(
      "SELECT taken_over_at FROM mirrored_threads WHERE thread_id = ?",
    )
    .get(threadId);
  if (mirrored !== undefined && mirrored.taken_over_at !== null) return;
  if (mirrored === undefined && rowExists(target, "threads", threadId)) return;
  if (!rowExists(target, "projects", String(row.project_id))) {
    const projectColumns = sharedColumns(source, target, "projects");
    const project = source
      .prepare<[string], Row>(
        `SELECT ${selectList(projectColumns)} FROM projects WHERE id = ?`,
      )
      .get(String(row.project_id));
    if (project === undefined) return;
    upsertRows(target, "projects", projectColumns, [project]);
  }
  const sourceStatus = String(row.status);
  const prepared: Row = {
    ...row,
    status: RUNNING_STATUSES.has(sourceStatus) ? "idle" : sourceStatus,
  };
  if (
    prepared.environment_id !== null &&
    !ensureEnvironment(context, String(prepared.environment_id))
  ) {
    prepared.environment_id = null;
  }
  for (const column of THREAD_REFERENCE_COLUMNS) {
    const reference = prepared[column];
    if (
      reference !== null &&
      reference !== undefined &&
      !rowExists(target, "threads", String(reference))
    ) {
      prepared[column] = null;
    }
  }
  if (
    prepared.section_id !== null &&
    prepared.section_id !== undefined &&
    !rowExists(target, "thread_sections", String(prepared.section_id))
  ) {
    prepared.section_id = null;
  }
  target.transaction(() => {
    upsertRows(target, "threads", columns, [prepared]);
    syncThreadEvents(context, threadId);
    for (const table of THREAD_SCOPED_TABLES) {
      reloadThreadScopedTable(context, table, threadId);
    }
  })();
  fork
    .prepare(
      `INSERT INTO mirrored_threads (thread_id, source_updated_at, source_status)
       VALUES (?, ?, ?)
       ON CONFLICT(thread_id) DO UPDATE SET
         source_updated_at = excluded.source_updated_at,
         source_status = excluded.source_status`,
    )
    .run(threadId, Number(row.updated_at), sourceStatus);
  try {
    const storage = join("thread-storage", threadId);
    const sourceStorage = join(context.sourceDataDir, storage);
    if (existsSync(sourceStorage)) {
      cpSync(sourceStorage, join(context.dataDir, storage), {
        recursive: true,
        force: true,
      });
    }
  } catch (error) {
    summary.conflicts.push(`thread storage ${threadId}: ${String(error)}`);
  }
  summary.threads += 1;
}

function deleteThreadsRemovedAtSource(
  context: ThreadSyncContext,
  now: number,
): void {
  const { source, target, fork, summary } = context;
  const last = Number(readCursor(fork, "deletionCheckAt") ?? 0);
  if (now - last < DELETION_CHECK_INTERVAL_MS) return;
  const present = source.prepare<[string], { found: number }>(
    "SELECT 1 AS found FROM threads WHERE id = ?",
  );
  const mirrored = fork
    .prepare<[], { thread_id: string }>(
      "SELECT thread_id FROM mirrored_threads WHERE taken_over_at IS NULL",
    )
    .all();
  for (const { thread_id: threadId } of mirrored) {
    if (present.get(threadId) !== undefined) continue;
    try {
      target.prepare("DELETE FROM threads WHERE id = ?").run(threadId);
      fork
        .prepare("DELETE FROM mirrored_threads WHERE thread_id = ?")
        .run(threadId);
      summary.threadsDeleted += 1;
    } catch (error) {
      summary.conflicts.push(`delete thread ${threadId}: ${String(error)}`);
    }
  }
  writeCursor(fork, "deletionCheckAt", String(now));
}

export function runForkImportSync(
  args: RunForkImportSyncArgs,
): ForkSyncSummary | null {
  const state = readForkImportState(args.dataDir);
  if (state === null) return null;
  const summary: ForkSyncSummary = {
    skipped: null,
    projects: 0,
    environments: 0,
    threads: 0,
    eventsAdded: 0,
    eventReloads: 0,
    threadsDeleted: 0,
    conflicts: [],
  };
  const sourcePath = join(state.sourceDataDir, "bb.db");
  if (!existsSync(sourcePath)) {
    return { ...summary, skipped: "The source database is not there" };
  }
  const fork = openForkImportDatabase(args.dataDir);
  if (readCursor(fork, "paused") === "true") {
    return { ...summary, skipped: "Sync is paused" };
  }
  const source = new Database(sourcePath, {
    fileMustExist: true,
    readonly: true,
  });
  try {
    source.pragma("busy_timeout = 2000");
    const target = args.database;
    const context: ThreadSyncContext = {
      source,
      target,
      fork,
      dataDir: args.dataDir,
      sourceDataDir: state.sourceDataDir,
      summary,
    };
    const never = () => false;
    summary.projects = syncUpdatedTable(
      source,
      target,
      fork,
      "projects",
      never,
      summary.conflicts,
    );
    syncUpdatedTable(
      source,
      target,
      fork,
      "thread_sections",
      never,
      summary.conflicts,
    );
    ensureHosts(source, target);
    syncProjectSources(
      source,
      target,
      state.sourceServerHostId,
      readHostId(args.dataDir),
      summary.conflicts,
    );
    const takenOverEnvironment = fork.prepare<[string], { found: number }>(
      "SELECT 1 AS found FROM taken_over_environments WHERE environment_id = ?",
    );
    summary.environments = syncUpdatedTable(
      source,
      target,
      fork,
      "environments",
      (row) => takenOverEnvironment.get(String(row.id)) !== undefined,
      summary.conflicts,
    );

    const threadCursor = Number(
      readCursor(fork, "threads.updated_at") ??
        fork
          .prepare<[], { value: number | null }>(
            "SELECT MAX(source_updated_at) AS value FROM mirrored_threads",
          )
          .get()?.value ??
        0,
    );
    const eventCursor = Number(
      readCursor(fork, "events.rowid") ?? state.sourceEventRowid,
    );
    const changed = new Map<string, number>();
    for (const row of source
      .prepare<[number], { id: string; updated_at: number }>(
        "SELECT id, updated_at FROM threads WHERE updated_at > ? ORDER BY updated_at",
      )
      .all(threadCursor)) {
      changed.set(row.id, row.updated_at);
    }
    const newestEvent =
      source
        .prepare<[], { value: number | null }>(
          "SELECT MAX(rowid) AS value FROM events",
        )
        .get()?.value ?? eventCursor;
    for (const row of source
      .prepare<[number, number], { thread_id: string }>(
        "SELECT DISTINCT thread_id FROM events WHERE rowid > ? AND rowid <= ?",
      )
      .all(eventCursor, newestEvent)) {
      if (!changed.has(row.thread_id)) changed.set(row.thread_id, 0);
    }
    let newestThread = threadCursor;
    for (const [threadId, updatedAt] of changed) {
      try {
        syncThread(context, threadId);
        newestThread = Math.max(newestThread, updatedAt);
      } catch (error) {
        summary.conflicts.push(`thread ${threadId}: ${String(error)}`);
      }
    }
    writeCursor(fork, "threads.updated_at", String(newestThread));
    writeCursor(fork, "events.rowid", String(newestEvent));
    deleteThreadsRemovedAtSource(context, args.now);
    writeCursor(fork, "lastSyncAt", String(args.now));
    writeCursor(fork, "lastSummary", JSON.stringify(summary));
    if (summary.conflicts.length > 0) {
      args.logger.warn(
        { conflicts: summary.conflicts.slice(0, 20) },
        "Import sync finished with rows it could not apply",
      );
    }
    return summary;
  } finally {
    source.close();
  }
}

export async function copyMissingThreadStorage(args: {
  dataDir: string;
  logger: Pick<ServerLogger, "info" | "warn">;
}): Promise<number | null> {
  const state = readForkImportState(args.dataDir);
  if (state === null) return null;
  const fork = openForkImportDatabase(args.dataDir);
  if (readCursor(fork, "threadStorageCopied") === "2") return null;
  const sourceRoot = join(state.sourceDataDir, "thread-storage");
  const targetRoot = join(args.dataDir, "thread-storage");
  let copied = 0;
  if (existsSync(sourceRoot)) {
    const entries = await readdir(sourceRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isFile()) continue;
      try {
        await cp(join(sourceRoot, entry.name), join(targetRoot, entry.name), {
          recursive: true,
          force: false,
          errorOnExist: false,
          verbatimSymlinks: true,
        });
        copied += 1;
      } catch (error) {
        args.logger.warn(
          { threadId: entry.name, error: String(error) },
          "Import could not copy a thread's storage",
        );
      }
    }
  }
  writeCursor(fork, "threadStorageCopied", "2");
  args.logger.info({ copied }, "Import copied thread storage");
  return copied;
}
