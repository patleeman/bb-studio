import type Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { join, resolve, sep } from "node:path";
import { quote, rowExists, selectList, sharedColumns } from "../sync.js";
import {
  copyFileIfMissing,
  copyMissingTree,
  removeCreated,
  throwIfCancelled,
} from "./files.js";
import { settleBroughtOverThread } from "./settle.js";

type Sqlite = Database.Database;
type Row = Record<string, unknown>;

const RUNNING_STATUSES = new Set(["starting", "active", "stopping"]);
const THREAD_REFERENCE_COLUMNS = [
  "parent_thread_id",
  "source_thread_id",
  "lifecycle_owner_thread_id",
];
const THREAD_ROW_TABLES = [
  "thread_conversation_outlines",
  "thread_tabs",
  "prompt_history_entries",
  "thread_search_segments",
  "thread_dynamic_context_file_states",
];

export interface ThreadImportContext {
  source: Sqlite;
  target: Sqlite;
  dataDir: string;
  sourceDataDir: string;
  sourceHostId: string | null;
  ourHostId: string | null;
  attachments: boolean;
  signal?: AbortSignal;
}

export interface ThreadImportResult {
  imported: boolean;
  files: number;
}

function insertIfMissing(
  target: Sqlite,
  table: string,
  columns: readonly string[],
  rows: readonly Row[],
): number {
  if (rows.length === 0 || columns.length === 0) return 0;
  const insert = target.prepare(
    `INSERT OR IGNORE INTO ${quote(table)} (${selectList(columns)}) VALUES (${columns.map((column) => `@${column}`).join(", ")})`,
  );
  let count = 0;
  for (const row of rows) {
    const values: Row = {};
    for (const column of columns) values[column] = row[column] ?? null;
    count += insert.run(values).changes;
  }
  return count;
}

function localPathOf(
  source: Sqlite,
  projectId: string,
  hostId: string | null,
): string | null {
  if (hostId === null) return null;
  const row = source
    .prepare<[string, string], { path: string | null }>(
      "SELECT path FROM project_sources WHERE project_id = ? AND host_id = ? AND path IS NOT NULL ORDER BY is_default DESC LIMIT 1",
    )
    .get(projectId, hostId);
  return row?.path ?? null;
}

export function projectHereFor(
  context: Pick<
    ThreadImportContext,
    "source" | "target" | "sourceHostId" | "ourHostId"
  >,
  projectId: string,
): { id: string; name: string } | null {
  const { source, target } = context;
  const same = target
    .prepare<[string], { id: string; name: string }>(
      "SELECT id, name FROM projects WHERE id = ?",
    )
    .get(projectId);
  if (same !== undefined) return same;
  const path = localPathOf(source, projectId, context.sourceHostId);
  if (path === null || context.ourHostId === null) return null;
  return (
    target
      .prepare<[string, string], { id: string; name: string }>(
        `SELECT projects.id, projects.name FROM project_sources
         JOIN projects ON projects.id = project_sources.project_id
         WHERE project_sources.host_id = ? AND project_sources.path = ? AND projects.deleted_at IS NULL
         LIMIT 1`,
      )
      .get(context.ourHostId, path) ?? null
  );
}

function ensureProject(
  context: ThreadImportContext,
  projectId: string,
): string {
  const { source, target } = context;
  const here = projectHereFor(context, projectId);
  if (here !== null) return here.id;
  const columns = sharedColumns(source, target, "projects");
  const project = source
    .prepare<[string], Row>(
      `SELECT ${selectList(columns)} FROM projects WHERE id = ?`,
    )
    .get(projectId);
  if (project === undefined) throw new Error("project missing at the source");
  insertIfMissing(target, "projects", columns, [project]);
  const sourceColumns = sharedColumns(source, target, "project_sources");
  const sources = source
    .prepare<[string], Row>(
      `SELECT ${selectList(sourceColumns)} FROM project_sources WHERE project_id = ?`,
    )
    .all(projectId);
  const hostTaken = target.prepare<[string, string | null], { found: number }>(
    "SELECT 1 AS found FROM project_sources WHERE project_id = ? AND host_id IS ?",
  );
  for (const row of sources) {
    const hostId =
      row.host_id === context.sourceHostId && context.ourHostId !== null
        ? context.ourHostId
        : row.host_id;
    if (hostTaken.get(projectId, hostId as string | null) !== undefined)
      continue;
    if (hostId !== null && !rowExists(target, "hosts", String(hostId)))
      continue;
    insertIfMissing(target, "project_sources", sourceColumns, [
      { ...row, host_id: hostId },
    ]);
  }
  return projectId;
}

function ensureHost(context: ThreadImportContext, hostId: string): boolean {
  const { source, target } = context;
  if (rowExists(target, "hosts", hostId)) return true;
  const columns = sharedColumns(source, target, "hosts");
  const row = source
    .prepare<[string], Row>(
      `SELECT ${selectList(columns)} FROM hosts WHERE id = ?`,
    )
    .get(hostId);
  if (row === undefined) return false;
  insertIfMissing(target, "hosts", columns, [row]);
  return true;
}

function insideFolder(path: unknown, folder: string): boolean {
  if (typeof path !== "string" || path.length === 0) return false;
  const root = resolve(folder);
  const target = resolve(path);
  return target === root || target.startsWith(`${root}${sep}`);
}

function safePathId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/u.test(id);
}

export function managedByBb(row: Row, sourceDataDir: string): boolean {
  return (
    (row.environment_provider_id !== null &&
      row.environment_provider_id !== undefined) ||
    row.provider_owns_path === 1 ||
    row.is_worktree === 1 ||
    insideFolder(row.path, sourceDataDir)
  );
}

function ensureEnvironment(
  context: ThreadImportContext,
  environmentId: string,
  projectId: string,
): string | null {
  const { source, target } = context;
  if (rowExists(target, "environments", environmentId)) return environmentId;
  const columns = sharedColumns(source, target, "environments");
  const row = source
    .prepare<[string], Row>(
      `SELECT ${selectList(columns)} FROM environments WHERE id = ?`,
    )
    .get(environmentId);
  if (row === undefined) return null;
  if (managedByBb(row, context.sourceDataDir)) return null;
  let hostId = String(row.host_id);
  if (hostId === context.sourceHostId && context.ourHostId !== null) {
    hostId = context.ourHostId;
    const twin = target
      .prepare<[string, string, unknown], { id: string }>(
        "SELECT id FROM environments WHERE project_id = ? AND host_id = ? AND path IS ?",
      )
      .get(projectId, hostId, row.path ?? null);
    if (twin !== undefined) return twin.id;
  }
  if (!ensureHost(context, hostId)) return null;
  const unmanaged: Row = {
    ...row,
    host_id: hostId,
    project_id: projectId,
    owner_thread_id: null,
    environment_provider_id: null,
    environment_provider_plugin_id: null,
    environment_provider_selection: null,
    environment_provider_instance_key: null,
    provider_owns_path: 0,
    retire_at: null,
    teardown_status: null,
    teardown_message: null,
    teardown_attempt: 0,
  };
  insertIfMissing(target, "environments", columns, [unmanaged]);
  return environmentId;
}

function copyRowsFor(
  context: ThreadImportContext,
  table: string,
  threadId: string,
  map: (row: Row) => Row = (row) => row,
): void {
  const { source, target } = context;
  const columns = sharedColumns(source, target, table);
  if (!columns.includes("thread_id")) return;
  const rows = source
    .prepare<[string], Row>(
      `SELECT ${selectList(columns)} FROM ${quote(table)} WHERE thread_id = ?`,
    )
    .all(threadId);
  insertIfMissing(target, table, columns, rows.map(map));
}

interface AttachmentRow {
  id: string;
  project_id: string;
  stored_path: string;
}

function attachmentsOf(source: Sqlite, threadId: string): AttachmentRow[] {
  return source
    .prepare<[string], AttachmentRow>(
      `SELECT project_attachments.id, project_attachments.project_id, project_attachments.stored_path
       FROM project_attachment_threads
       JOIN project_attachments ON project_attachments.id = project_attachment_threads.attachment_id
       WHERE project_attachment_threads.thread_id = ?`,
    )
    .all(threadId);
}

export function referencedFirst(
  source: Sqlite,
  threadIds: readonly string[],
): string[] {
  const wanted = new Set(threadIds);
  const references = source.prepare<[string], Record<string, string | null>>(
    `SELECT ${THREAD_REFERENCE_COLUMNS.join(", ")} FROM threads WHERE id = ?`,
  );
  const ordered: string[] = [];
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    for (const reference of Object.values(references.get(id) ?? {})) {
      if (typeof reference === "string" && wanted.has(reference))
        visit(reference);
    }
    ordered.push(id);
  };
  for (const id of threadIds) visit(id);
  return ordered;
}

export const eventChunking = { threshold: 5_000, size: 2_000 };

export async function importThread(
  context: ThreadImportContext,
  threadId: string,
): Promise<ThreadImportResult> {
  const { source, target } = context;
  throwIfCancelled(context.signal);
  if (rowExists(target, "threads", threadId))
    return { imported: false, files: 0 };
  const threadColumns = sharedColumns(source, target, "threads");
  const thread = source
    .prepare<[string], Row>(
      `SELECT ${selectList(threadColumns)} FROM threads WHERE id = ? AND deleted_at IS NULL`,
    )
    .get(threadId);
  if (thread === undefined) return { imported: false, files: 0 };

  const targetProject =
    projectHereFor(context, String(thread.project_id))?.id ??
    String(thread.project_id);
  const created: string[] = [];
  try {
    created.push(
      ...(await copyMissingTree(
        join(context.sourceDataDir, "thread-storage", threadId),
        join(context.dataDir, "thread-storage", threadId),
        context.signal,
      )),
    );
    if (context.attachments) {
      for (const attachment of attachmentsOf(source, threadId)) {
        throwIfCancelled(context.signal);
        const parts = attachment.stored_path.split("/");
        if (parts.some((part) => part === ".." || part === "")) continue;
        if (!safePathId(attachment.project_id) || !safePathId(targetProject)) {
          continue;
        }
        const to = join(
          context.dataDir,
          "attachments",
          targetProject,
          ...parts,
        );
        if (
          await copyFileIfMissing(
            join(
              context.sourceDataDir,
              "attachments",
              attachment.project_id,
              ...parts,
            ),
            to,
          )
        ) {
          created.push(to);
        }
      }
    }
    throwIfCancelled(context.signal);
    const chunked =
      (source
        .prepare<[string], { count: number }>(
          "SELECT COUNT(*) AS count FROM events WHERE thread_id = ?",
        )
        .get(threadId)?.count ?? 0) > eventChunking.threshold;
    const environmentIds = new Map<string, string | null>();
    let projectId = targetProject;
    const environmentFor = (id: unknown): string | null => {
      if (typeof id !== "string") return null;
      if (!environmentIds.has(id)) {
        environmentIds.set(id, ensureEnvironment(context, id, projectId));
      }
      return environmentIds.get(id) ?? null;
    };
    const withEnvironment = (row: Row): Row => ({
      ...row,
      environment_id: environmentFor(row.environment_id),
    });
    const finishRows = () => {
      copyRowsFor(context, "retained_event_outputs", threadId);
      if (context.attachments) {
        const attachmentColumns = sharedColumns(
          source,
          target,
          "project_attachments",
        );
        for (const attachment of attachmentsOf(source, threadId)) {
          const row = source
            .prepare<[string], Row>(
              `SELECT ${selectList(attachmentColumns)} FROM project_attachments WHERE id = ?`,
            )
            .get(attachment.id);
          if (row === undefined) continue;
          insertIfMissing(target, "project_attachments", attachmentColumns, [
            { ...row, project_id: projectId, deletion_claimed_at: null },
          ]);
        }
        copyRowsFor(context, "project_attachment_threads", threadId);
      }
    };
    const eventColumns = sharedColumns(source, target, "events");
    const staging = chunked
      ? `bring_over_events_${randomBytes(6).toString("hex")}`
      : null;
    try {
      if (staging !== null) {
        target.exec(
          `CREATE TEMP TABLE ${staging} AS SELECT ${selectList(eventColumns)} FROM main.events WHERE 0`,
        );
        const stage = target.prepare(
          `INSERT INTO temp.${staging} (${selectList(eventColumns)}) VALUES (${eventColumns.map((column) => `@${column}`).join(", ")})`,
        );
        const page = source.prepare<
          [string, number, number],
          Row & { _rowid: number }
        >(
          `SELECT rowid AS _rowid, ${selectList(eventColumns)} FROM events WHERE thread_id = ? AND rowid > ? ORDER BY rowid LIMIT ?`,
        );
        let after = 0;
        for (;;) {
          throwIfCancelled(context.signal);
          const rows = page.all(threadId, after, eventChunking.size);
          if (rows.length === 0) break;
          after = rows[rows.length - 1]!._rowid;
          target.transaction(() => {
            for (const row of rows) {
              const values: Row = {};
              for (const column of eventColumns)
                values[column] = row[column] ?? null;
              stage.run(values);
            }
          })();
          await new Promise<void>((resolve) => {
            setImmediate(resolve);
          });
        }
        throwIfCancelled(context.signal);
      }
      target.transaction(() => {
        target.pragma("defer_foreign_keys = ON");
        projectId = ensureProject(context, String(thread.project_id));
        const sectionId = thread.section_id;
        if (
          typeof sectionId === "string" &&
          !rowExists(target, "thread_sections", sectionId)
        ) {
          const sectionColumns = sharedColumns(
            source,
            target,
            "thread_sections",
          );
          const section = source
            .prepare<[string], Row>(
              `SELECT ${selectList(sectionColumns)} FROM thread_sections WHERE id = ?`,
            )
            .get(sectionId);
          if (section !== undefined) {
            insertIfMissing(target, "thread_sections", sectionColumns, [
              section,
            ]);
          }
        }
        const prepared: Row = {
          ...thread,
          project_id: projectId,
          environment_id: environmentFor(thread.environment_id),
          status: RUNNING_STATUSES.has(String(thread.status))
            ? "idle"
            : thread.status,
          section_id:
            typeof sectionId === "string" &&
            rowExists(target, "thread_sections", sectionId)
              ? sectionId
              : null,
        };
        for (const column of THREAD_REFERENCE_COLUMNS) {
          const reference = prepared[column];
          if (
            typeof reference === "string" &&
            !rowExists(target, "threads", reference)
          ) {
            prepared[column] = null;
          }
        }
        insertIfMissing(target, "threads", threadColumns, [prepared]);
        const withProject = (row: Row): Row =>
          "project_id" in row ? { ...row, project_id: projectId } : row;
        for (const table of THREAD_ROW_TABLES) {
          copyRowsFor(context, table, threadId, withProject);
        }
        if (staging === null) {
          copyRowsFor(context, "events", threadId, withEnvironment);
        } else {
          for (const row of target
            .prepare<[], { environment_id: string }>(
              `SELECT DISTINCT environment_id FROM temp.${staging} WHERE environment_id IS NOT NULL`,
            )
            .all()) {
            const mapped = environmentFor(row.environment_id);
            if (mapped !== row.environment_id) {
              target
                .prepare(
                  `UPDATE temp.${staging} SET environment_id = ? WHERE environment_id = ?`,
                )
                .run(mapped, row.environment_id);
            }
          }
          target.exec(
            `INSERT OR IGNORE INTO main.events (${selectList(eventColumns)}) SELECT ${selectList(eventColumns)} FROM temp.${staging}`,
          );
        }
        settleBroughtOverThread(target, {
          threadId,
          environmentId:
            typeof prepared.environment_id === "string"
              ? prepared.environment_id
              : null,
          now: Date.now(),
        });
        finishRows();
      })();
    } finally {
      if (staging !== null) target.exec(`DROP TABLE IF EXISTS temp.${staging}`);
    }
  } catch (error) {
    await removeCreated(created);
    throw error;
  }
  return { imported: true, files: created.length };
}
