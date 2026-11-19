import type Database from "better-sqlite3";
import { projectHereFor } from "./threads.js";

type Sqlite = Database.Database;

export interface ProjectItem {
  id: string;
  name: string;
  threads: number;
  threadsHere: number;
  lastActivityAt: number | null;
  joins: { id: string; name: string } | null;
}

export interface ThreadItem {
  id: string;
  title: string;
  updatedAt: number;
  archived: boolean;
  attachments: number;
  here: boolean;
}

interface HostIds {
  sourceHostId: string | null;
  ourHostId: string | null;
}

function threadIdsHere(target: Sqlite, ids: readonly string[]): Set<string> {
  const here = new Set<string>();
  const lookup = target.prepare<[string], { id: string }>(
    "SELECT id FROM threads WHERE id = ?",
  );
  for (const id of ids) if (lookup.get(id) !== undefined) here.add(id);
  return here;
}

export function listProjects(
  source: Sqlite,
  target: Sqlite,
  hosts: HostIds,
): ProjectItem[] {
  const rows = source
    .prepare<
      [],
      { id: string; name: string; threads: number; last: number | null }
    >(
      `SELECT projects.id, projects.name, COUNT(threads.id) AS threads, MAX(threads.updated_at) AS last
       FROM projects JOIN threads ON threads.project_id = projects.id AND threads.deleted_at IS NULL
       WHERE projects.deleted_at IS NULL
       GROUP BY projects.id
       ORDER BY last DESC`,
    )
    .all();
  const threadsOf = source.prepare<[string], { id: string }>(
    "SELECT id FROM threads WHERE project_id = ? AND deleted_at IS NULL",
  );
  return rows.map((row) => {
    const here = projectHereFor({ source, target, ...hosts }, row.id);
    return {
      id: row.id,
      name: row.name,
      threads: row.threads,
      threadsHere: threadIdsHere(
        target,
        threadsOf.all(row.id).map((thread) => thread.id),
      ).size,
      lastActivityAt: row.last,
      joins: here !== null && here.id !== row.id ? here : null,
    };
  });
}

export function listThreads(
  source: Sqlite,
  target: Sqlite,
  projectId: string,
): ThreadItem[] {
  const rows = source
    .prepare<
      [string],
      {
        id: string;
        title: string | null;
        title_fallback: string | null;
        updated_at: number;
        archived_at: number | null;
        attachments: number;
      }
    >(
      `SELECT threads.id, threads.title, threads.title_fallback, threads.updated_at, threads.archived_at,
         (SELECT COUNT(*) FROM project_attachment_threads WHERE project_attachment_threads.thread_id = threads.id) AS attachments
       FROM threads WHERE threads.project_id = ? AND threads.deleted_at IS NULL
       ORDER BY threads.updated_at DESC`,
    )
    .all(projectId);
  const here = threadIdsHere(
    target,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title ?? row.title_fallback ?? "Untitled",
    updatedAt: row.updated_at,
    archived: row.archived_at !== null,
    attachments: row.attachments,
    here: here.has(row.id),
  }));
}

export function threadIdsOfProject(
  source: Sqlite,
  projectId: string,
): string[] {
  return source
    .prepare<[string], { id: string }>(
      "SELECT id FROM threads WHERE project_id = ? AND deleted_at IS NULL ORDER BY updated_at",
    )
    .all(projectId)
    .map((row) => row.id);
}
