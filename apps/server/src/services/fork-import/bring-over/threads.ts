import type Database from "better-sqlite3";
import { randomBytes, randomInt } from "node:crypto";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { GENERATED_ID_ALPHABET, GENERATED_ID_SUFFIX_LENGTH } from "@bb/domain";
import { quote, rowExists, selectList, sharedColumns } from "../sync.js";
import {
  copyFileIfMissing,
  copyMissingTree,
  removeCreated,
  throwIfCancelled,
} from "./files.js";
import {
  BROUGHT_OVER_OPERATION,
  settleBroughtOverThread,
  type BroughtOverWorkspace,
} from "./settle.js";

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
  /** A thread brought over earlier, with no workspace, that got this Mac's project folder. */
  repaired?: boolean;
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

function createEnvironmentId(): string {
  let suffix = "";
  for (let index = 0; index < GENERATED_ID_SUFFIX_LENGTH; index += 1) {
    suffix += GENERATED_ID_ALPHABET[randomInt(GENERATED_ID_ALPHABET.length)];
  }
  return `env_${suffix}`;
}

function isFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Folders a brought-over thread must never work in: bb's data, BB Studio's own. */
function outOfBounds(
  context: Pick<ThreadImportContext, "sourceDataDir" | "dataDir">,
  path: string,
): boolean {
  return [context.sourceDataDir, context.dataDir, join(homedir(), ".bb")].some(
    (folder) => insideFolder(path, folder),
  );
}

/**
 * bb's workspace for a thread stays in bb (a worktree, or a folder a bb
 * plugin owns). Here the thread works in the project's own folder on this
 * Mac: the environment BB Studio already has for it, or a new one that no
 * provider owns, so BB Studio's cleanup never removes the folder. Null when
 * the project has no folder on this Mac, or it is missing or inside bb's
 * or BB Studio's data.
 */
export function checkoutHere(
  context: Pick<
    ThreadImportContext,
    "target" | "ourHostId" | "sourceDataDir" | "dataDir"
  >,
  projectId: string,
): string | null {
  const { target, ourHostId } = context;
  if (ourHostId === null) return null;
  const source = target
    .prepare<[string, string], { path: string }>(
      "SELECT path FROM project_sources WHERE project_id = ? AND host_id = ? AND path IS NOT NULL ORDER BY is_default DESC LIMIT 1",
    )
    .get(projectId, ourHostId);
  if (source === undefined) return null;
  const path = resolve(source.path);
  if (outOfBounds(context, path) || !isFolder(path)) {
    return null;
  }
  const existing = target
    .prepare<[string, string, string], { id: string }>(
      `SELECT id FROM environments
       WHERE project_id = ? AND host_id = ? AND path = ? AND status = 'ready'
         AND is_worktree = 0 AND provider_owns_path = 0 AND owner_thread_id IS NULL
       ORDER BY environment_provider_id IS NOT NULL, created_at LIMIT 1`,
    )
    .get(projectId, ourHostId, path);
  if (existing !== undefined) return existing.id;
  const id = createEnvironmentId();
  const now = Date.now();
  target
    .prepare(
      `INSERT INTO environments (id, project_id, host_id, path, is_git_repo, is_worktree, status, created_at, updated_at, provider_owns_path)
       VALUES (?, ?, ?, ?, ?, 0, 'ready', ?, ?, 0)`,
    )
    .run(
      id,
      projectId,
      ourHostId,
      path,
      isFolder(join(path, ".git")) ? 1 : 0,
      now,
      now,
    );
  return id;
}

/**
 * A thread brought over before BB Studio gave such threads a workspace:
 * attach this Mac's project folder now. Returns whether it changed.
 */
export function attachWorkspaceToBroughtOverThread(
  context: Pick<
    ThreadImportContext,
    "target" | "ourHostId" | "sourceDataDir" | "dataDir"
  >,
  threadId: string,
): boolean {
  const { target } = context;
  const thread = target
    .prepare<[string], { project_id: string; environment_id: string | null }>(
      "SELECT project_id, environment_id FROM threads WHERE id = ? AND deleted_at IS NULL",
    )
    .get(threadId);
  if (thread === undefined || thread.environment_id !== null) return false;
  const broughtOver = target
    .prepare<[string, string], { found: number }>(
      `SELECT 1 AS found FROM events WHERE thread_id = ? AND type = 'system/operation'
       AND json_extract(data, '$.operation') = ? LIMIT 1`,
    )
    .get(threadId, BROUGHT_OVER_OPERATION);
  if (broughtOver === undefined) return false;
  return target.transaction(() => {
    const environmentId = checkoutHere(context, thread.project_id);
    if (environmentId === null) return false;
    const changed = target
      .prepare(
        "UPDATE threads SET environment_id = ?, updated_at = ? WHERE id = ? AND environment_id IS NULL",
      )
      .run(environmentId, Date.now(), threadId).changes;
    return changed > 0;
  })();
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
  if (managedByBb(row, context.sourceDataDir)) {
    return checkoutHere(context, projectId);
  }
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

function workspaceOutcome(
  context: ThreadImportContext,
  sourceEnvironmentId: unknown,
  environmentId: string | null,
): BroughtOverWorkspace {
  if (typeof sourceEnvironmentId !== "string") return { kind: "none" };
  if (environmentId === null) return { kind: "missing" };
  const source = context.source
    .prepare<[string], Row>("SELECT * FROM environments WHERE id = ?")
    .get(sourceEnvironmentId);
  if (source !== undefined && !managedByBb(source, context.sourceDataDir)) {
    return { kind: "same" };
  }
  const path = context.target
    .prepare<[string], { path: string | null }>(
      "SELECT path FROM environments WHERE id = ?",
    )
    .get(environmentId)?.path;
  return { kind: "project-folder", path: path ?? null };
}

export const eventChunking = { threshold: 5_000, size: 2_000 };

export async function importThread(
  context: ThreadImportContext,
  threadId: string,
): Promise<ThreadImportResult> {
  const { source, target } = context;
  throwIfCancelled(context.signal);
  if (rowExists(target, "threads", threadId)) {
    return {
      imported: false,
      files: 0,
      repaired: attachWorkspaceToBroughtOverThread(context, threadId),
    };
  }
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
        const environmentId =
          typeof prepared.environment_id === "string"
            ? prepared.environment_id
            : null;
        settleBroughtOverThread(target, {
          threadId,
          environmentId,
          workspace: workspaceOutcome(
            context,
            thread.environment_id,
            environmentId,
          ),
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
