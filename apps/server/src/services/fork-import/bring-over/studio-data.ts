import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { chmod, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { BringOverJob } from "./job.js";
import {
  BringOverError,
  copyFileIfMissing,
  copyMissingTree,
  exists,
} from "./files.js";
import {
  openSnapshot,
  takeSourceSnapshot,
  type SourceSnapshot,
} from "./source.js";

type Sqlite = Database.Database;

export const STUDIO_PLUGIN_ID = "studio";
const IMPORT_DIR_NAME = "import-staged";
const STAGED_DIR_NAME = "staged";
const JOURNAL_FILE_NAME = "journal.json";
const BB_KV_FILE_NAME = "bb-kv.json";
const BEFORE_DIR_NAME = "before";
const REPLACED_DIR_NAME = "replaced";
const ONBOARDING_FILE_NAME = "onboarding.json";

const NOT_COPIED = new Set([
  "secrets",
  "logs",
  "host-data",
  "bridge-data",
  "backup-sessions",
  IMPORT_DIR_NAME,
  "data.db",
  "data.db-wal",
  "data.db-shm",
  "data.db-journal",
]);

export const STUDIO_IMPORT_STATES = [
  "staging",
  "staged",
  "ready",
  "applying",
  "applied",
  "refused",
  "failed",
  "rolling-back",
  "rollback-failed",
  "restore-requested",
  "restoring",
  "restored",
] as const;
export type StudioImportState = (typeof STUDIO_IMPORT_STATES)[number];

const DISCARDABLE = new Set<StudioImportState>([
  "staging",
  "staged",
  "ready",
  "refused",
  "failed",
]);
const FORGETTABLE = new Set<StudioImportState>(["applied", "restored"]);

export interface StudioImportJournal {
  version: 1;
  id: string;
  state: StudioImportState;
  stagedAt: number;
  snapshotAt: number | null;
  updatedAt: number;
  error: string | null;
  required?: string[];
  jobId?: string | null;
  appliedAt?: number | null;
  restoredAt?: number | null;
  [key: string]: unknown;
}

export interface StudioDataState {
  inBb: boolean;
  bots: number;
  pages: number;
  tasks: number;
  journal:
    | (Pick<
        StudioImportJournal,
        "error" | "stagedAt" | "appliedAt" | "restoredAt"
      > & { state: StudioImportState | "unreadable" })
    | null;
}

function studioDir(root: string): string {
  return join(root, "plugins", STUDIO_PLUGIN_ID);
}

export function studioImportDir(dataDir: string): string {
  return join(studioDir(dataDir), IMPORT_DIR_NAME);
}

function journalPath(dataDir: string): string {
  return join(studioImportDir(dataDir), JOURNAL_FILE_NAME);
}

export function readStudioJournal(
  dataDir: string,
): StudioImportJournal | "unreadable" | null {
  let text: string;
  try {
    text = readFileSync(journalPath(dataDir), "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? null
      : "unreadable";
  }
  try {
    const value = JSON.parse(text) as Partial<StudioImportJournal>;
    return value?.version === 1 &&
      typeof value.id === "string" &&
      STUDIO_IMPORT_STATES.includes(value.state as StudioImportState)
      ? (value as StudioImportJournal)
      : "unreadable";
  } catch {
    return "unreadable";
  }
}

function knownJournal(dataDir: string): StudioImportJournal | null {
  const journal = readStudioJournal(dataDir);
  if (journal === "unreadable") {
    throw new BringOverError(
      `The journal in ${studioImportDir(dataDir)} can't be read, so nothing there is changed. It may hold BB Studio's set-aside Studio data`,
    );
  }
  return journal;
}

async function holdsSetAsideData(dataDir: string): Promise<boolean> {
  for (const name of [BEFORE_DIR_NAME, REPLACED_DIR_NAME]) {
    if (await exists(join(studioImportDir(dataDir), name))) return true;
  }
  return false;
}

function writeStudioJournal(
  dataDir: string,
  journal: StudioImportJournal,
): void {
  const path = journalPath(dataDir);
  writeFileSync(`${path}.tmp`, `${JSON.stringify(journal, null, 2)}\n`, {
    mode: 0o600,
  });
  chmodSync(`${path}.tmp`, 0o600);
  renameSync(`${path}.tmp`, path);
}

function countRows(db: Sqlite, sql: string): number {
  try {
    return db.prepare<[], { count: number }>(sql).get()?.count ?? 0;
  } catch {
    return 0;
  }
}

export async function studioDataState(
  dataDir: string,
  sourceDataDir: string,
): Promise<StudioDataState> {
  const source = join(studioDir(sourceDataDir), "data.db");
  const inBb = await exists(source);
  let counts = { bots: 0, pages: 0, tasks: 0 };
  if (inBb) {
    let db: Sqlite | null = null;
    try {
      db = new Database(source, { readonly: true, fileMustExist: true });
      db.pragma("busy_timeout = 1000");
      counts = {
        bots: countRows(db, "SELECT COUNT(*) AS count FROM bots"),
        pages: countRows(
          db,
          "SELECT COUNT(*) AS count FROM pages WHERE archived_at IS NULL",
        ),
        tasks: Math.max(
          countRows(db, "SELECT COUNT(*) AS count FROM tasks"),
          countRows(db, "SELECT COUNT(*) AS count FROM bot_loops"),
        ),
      };
    } catch {
      counts = { bots: 0, pages: 0, tasks: 0 };
    } finally {
      db?.close();
    }
  }
  const journal = readStudioJournal(dataDir);
  return {
    inBb,
    ...counts,
    journal:
      journal === null
        ? null
        : journal === "unreadable"
          ? {
              state: "unreadable",
              error: `The journal in ${studioImportDir(dataDir)} can't be read, so nothing there is changed`,
              stagedAt: 0,
              appliedAt: null,
              restoredAt: null,
            }
          : {
              state: journal.state,
              error: journal.error,
              stagedAt: journal.stagedAt,
              appliedAt: journal.appliedAt ?? null,
              restoredAt: journal.restoredAt ?? null,
            },
  };
}

type KvRow = { key: string; value: string; updated_at: number };

function studioKvRows(db: Sqlite, table: string): KvRow[] {
  try {
    return db
      .prepare<[string], KvRow>(
        `SELECT key, value, updated_at FROM ${table} WHERE plugin_id = ? ORDER BY key`,
      )
      .all(STUDIO_PLUGIN_ID);
  } catch {
    return [];
  }
}

async function copyStudioFiles(from: string, to: string): Promise<void> {
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (NOT_COPIED.has(entry.name)) continue;
    if (entry.isDirectory()) {
      await copyMissingTree(join(from, entry.name), join(to, entry.name));
    } else if (entry.isFile()) {
      await copyFileIfMissing(join(from, entry.name), join(to, entry.name));
    }
  }
}

export async function stageStudioData(args: {
  dataDir: string;
  sourceDataDir: string;
  now: number;
}): Promise<{ journal: StudioImportJournal; snapshot: SourceSnapshot }> {
  const existing = knownJournal(args.dataDir);
  if (await holdsSetAsideData(args.dataDir)) {
    throw new BringOverError(
      `${studioImportDir(args.dataDir)} still holds set-aside Studio data. Put it back or delete it first`,
    );
  }
  if (existing !== null && !DISCARDABLE.has(existing.state)) {
    throw new BringOverError(
      existing.state === "applied" || existing.state === "restored"
        ? "bb's Studio data was already brought in. Put the old data back or delete it first"
        : "BB Studio is still finishing the last bring-over of Studio data. Restart BB Studio first",
    );
  }
  const sourceStudio = studioDir(args.sourceDataDir);
  if (!(await exists(join(sourceStudio, "data.db")))) {
    throw new BringOverError("bb has no BB Studio data");
  }
  const directory = studioImportDir(args.dataDir);
  const staged = join(directory, STAGED_DIR_NAME);
  await rm(directory, { force: true, recursive: true });
  await mkdir(staged, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  await chmod(staged, 0o700);
  let journal: StudioImportJournal = {
    version: 1,
    id: randomUUID(),
    state: "staging",
    stagedAt: args.now,
    snapshotAt: null,
    updatedAt: args.now,
    error: null,
  };
  writeStudioJournal(args.dataDir, journal);
  try {
    const stagedDb = join(staged, "data.db");
    const taken = await takeSourceSnapshot({
      dataDir: args.dataDir,
      sourceDataDir: args.sourceDataDir,
      now: args.now,
      alsoCopy: [{ from: join(sourceStudio, "data.db"), to: stagedDb }],
    });
    const copy = new Database(stagedDb, { fileMustExist: true });
    try {
      copy.pragma("journal_mode = DELETE");
    } finally {
      copy.close();
    }
    await chmod(stagedDb, 0o600);
    await copyStudioFiles(sourceStudio, staged);
    if (!(await exists(join(staged, ONBOARDING_FILE_NAME)))) {
      writeFileSync(
        join(staged, ONBOARDING_FILE_NAME),
        `${JSON.stringify({ version: 1, state: "done", reason: "import", at: args.now, botId: null, welcomeThreadId: null, opened: true })}\n`,
      );
    }
    const source = openSnapshot(taken);
    try {
      const kvPath = join(directory, BB_KV_FILE_NAME);
      writeFileSync(
        kvPath,
        `${JSON.stringify({
          plugin_kv: studioKvRows(source, "plugin_kv"),
          plugin_settings: studioKvRows(source, "plugin_settings"),
        })}\n`,
        { mode: 0o600 },
      );
      chmodSync(kvPath, 0o600);
    } finally {
      source.close();
    }
    const snapshotAt = Math.round((await stat(taken.snapshotPath)).mtimeMs);
    journal = {
      ...journal,
      state: "staged",
      snapshotAt,
      updatedAt: Date.now(),
    };
    writeStudioJournal(args.dataDir, journal);
    return { journal, snapshot: { ...taken, takenAt: snapshotAt } };
  } catch (error) {
    await rm(directory, { force: true, recursive: true });
    throw error;
  }
}

export function checkStudioJob(args: {
  dataDir: string;
  snapshot: SourceSnapshot;
  source: Sqlite;
  required: readonly string[];
}): { missing: string[] } {
  const journal = knownJournal(args.dataDir);
  if (journal?.state !== "staged") {
    throw new BringOverError("Copy bb's Studio data first");
  }
  if (journal.snapshotAt !== args.snapshot.takenAt) {
    throw new BringOverError(
      "bb was read again after its Studio data was copied. Copy it again",
    );
  }
  const present = args.source.prepare<[string], { found: number }>(
    "SELECT 1 AS found FROM threads WHERE id = ? AND deleted_at IS NULL",
  );
  return {
    missing: args.required.filter((id) => present.get(id) === undefined),
  };
}

export function finishStudioJob(args: {
  dataDir: string;
  target: Sqlite;
  job: BringOverJob;
  required: readonly string[];
}): void {
  const journal = readStudioJournal(args.dataDir);
  if (journal === "unreadable" || journal?.state !== "staged") return;
  const here = args.target.prepare<[string], { found: number }>(
    "SELECT 1 AS found FROM threads WHERE id = ?",
  );
  const missing = args.required.filter((id) => here.get(id) === undefined);
  const ready = args.job.state !== "cancelled" && missing.length === 0;
  writeStudioJournal(args.dataDir, {
    ...journal,
    state: ready ? "ready" : "staged",
    required: [...args.required],
    jobId: args.job.id,
    updatedAt: Date.now(),
    error: ready
      ? null
      : args.job.state === "cancelled"
        ? "The Bots' threads were not all brought over (cancelled)"
        : `${String(missing.length)} of the Bots' own threads could not be brought over`,
  });
}

export async function discardStudioData(dataDir: string): Promise<void> {
  const journal = knownJournal(dataDir);
  if (journal !== null && !DISCARDABLE.has(journal.state)) {
    throw new BringOverError(
      "This Studio data is in use and can't be discarded",
    );
  }
  if (await holdsSetAsideData(dataDir)) {
    throw new BringOverError(
      `${studioImportDir(dataDir)} still holds set-aside Studio data, so it is not discarded`,
    );
  }
  await rm(studioImportDir(dataDir), { force: true, recursive: true });
}

export async function forgetStudioData(dataDir: string): Promise<void> {
  const journal = knownJournal(dataDir);
  if (journal === null || !FORGETTABLE.has(journal.state)) {
    throw new BringOverError("There is no set-aside Studio data to delete");
  }
  await rm(studioImportDir(dataDir), { force: true, recursive: true });
}

export async function requestStudioPutBack(dataDir: string): Promise<void> {
  const journal = knownJournal(dataDir);
  if (journal?.state !== "applied") {
    throw new BringOverError("There is no old Studio data to put back");
  }
  if (!(await exists(join(studioImportDir(dataDir), BEFORE_DIR_NAME)))) {
    throw new BringOverError("The old Studio data is not there any more");
  }
  mkdirSync(studioImportDir(dataDir), { recursive: true, mode: 0o700 });
  writeStudioJournal(dataDir, {
    ...journal,
    state: "restore-requested",
    error: null,
    updatedAt: Date.now(),
  });
}
