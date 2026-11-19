import Database from "better-sqlite3";
import { constants as fsConstants, existsSync, readFileSync } from "node:fs";
import {
  copyFile,
  link,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, posix, resolve } from "node:path";
import type { ServerLogger } from "../../types.js";
import { FORK_IMPORT_STATE_FILE_NAME } from "./state.js";

export const FIRST_RUN_JOURNAL_FILE_NAME = "fork-import-pending.json";
export const FIRST_RUN_FAILED_FILE_NAME = "fork-import-failed.json";
export const FIRST_RUN_MAX_ATTEMPTS = 3;

const REPLACED_DIR_NAME = "replaced";
const COPY_CONCURRENCY = 16;
const IMPORT_TEMP_SUFFIX = ".import-tmp";

export interface FirstRunJournalEntry {
  path: string;
  id: string;
}

export interface FirstRunJournal {
  version: 2;
  stagingDir: string;
  added: FirstRunJournalEntry[];
  replaced: string[];
}

export interface FirstRunFailure {
  version: 1;
  sourceDataDir: string;
  failedAt: number;
  reason: "timed-out" | "error";
  detail: string;
  message: string;
  attempts?: number;
  retryRequested?: boolean;
}

type Logger = Pick<ServerLogger, "info" | "warn">;

export class FirstRunImportTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`the import did not finish within ${Math.round(timeoutMs / 1000)}s`);
    this.name = "FirstRunImportTimeoutError";
  }
}

export class FirstRunImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FirstRunImportError";
  }
}

export class ImportDeadline {
  readonly at: number;
  readonly timeoutMs: number;

  constructor(timeoutMs: number, startedAt = Date.now()) {
    this.timeoutMs = timeoutMs;
    this.at = startedAt + timeoutMs;
  }

  check(): void {
    if (Date.now() > this.at) {
      throw new FirstRunImportTimeoutError(this.timeoutMs);
    }
  }
}

export function stagingDirPrefix(dataDir: string): string {
  return `.${basename(resolve(dataDir))}-first-run-import-`;
}

export function failureDetail(error: unknown): string {
  if (
    error instanceof FirstRunImportTimeoutError ||
    error instanceof FirstRunImportError
  ) {
    return error.message;
  }
  const { code, syscall } = (error ?? {}) as NodeJS.ErrnoException;
  if (typeof code === "string") {
    return typeof syscall === "string" ? `${code} (${syscall})` : code;
  }
  return error instanceof Error ? error.name : "unknown error";
}

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    () => false,
  );
}

async function identity(path: string): Promise<string | null> {
  try {
    const stats = await lstat(path, { bigint: true });
    return `${String(stats.dev)}:${String(stats.ino)}`;
  } catch {
    return null;
  }
}

async function writeFileAtomically(path: string, text: string): Promise<void> {
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, text);
  await rename(temp, path);
}

export async function copyFilesInParallel(
  copies: readonly { from: string; to: string }[],
  deadline: ImportDeadline,
): Promise<void> {
  const directories = [...new Set(copies.map((copy) => dirname(copy.to)))];
  directories.sort();
  for (const directory of directories) {
    await mkdir(directory, { recursive: true });
  }
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < copies.length) {
      deadline.check();
      const copy = copies[next++]!;
      await copyFile(copy.from, copy.to, fsConstants.COPYFILE_FICLONE);
    }
  };
  await Promise.all(Array.from({ length: COPY_CONCURRENCY }, worker));
}

async function readJournal(dataDir: string): Promise<FirstRunJournal | null> {
  let text: string;
  try {
    text = await readFile(join(dataDir, FIRST_RUN_JOURNAL_FILE_NAME), "utf8");
  } catch {
    return null;
  }
  let value: Partial<FirstRunJournal>;
  try {
    value = JSON.parse(text) as Partial<FirstRunJournal>;
  } catch {
    throw new FirstRunImportError(
      "the unfinished import's journal is unreadable",
    );
  }
  if (
    value.version !== 2 ||
    typeof value.stagingDir !== "string" ||
    !Array.isArray(value.added) ||
    !Array.isArray(value.replaced)
  ) {
    throw new FirstRunImportError(
      "the unfinished import's journal is unreadable",
    );
  }
  return value as FirstRunJournal;
}

export async function hasFirstRunJournal(dataDir: string): Promise<boolean> {
  return exists(join(resolve(dataDir), FIRST_RUN_JOURNAL_FILE_NAME));
}

export async function readFirstRunJournalStaging(
  dataDir: string,
): Promise<string | null> {
  try {
    return (await readJournal(resolve(dataDir)))?.stagingDir ?? null;
  } catch {
    return null;
  }
}

function insideDataDir(dataDir: string, relativePath: string): string | null {
  if (
    relativePath.length === 0 ||
    relativePath.startsWith("/") ||
    relativePath.split("/").some((part) => part === ".." || part === "")
  ) {
    return null;
  }
  return join(dataDir, ...relativePath.split("/"));
}

async function removeEmptyParents(
  dataDir: string,
  paths: readonly string[],
): Promise<void> {
  const parents = new Set<string>();
  for (const path of paths) {
    for (let parent = posix.dirname(path); parent !== ".";) {
      parents.add(parent);
      parent = posix.dirname(parent);
    }
  }
  const deepestFirst = [...parents].sort(
    (left, right) => right.split("/").length - left.split("/").length,
  );
  for (const parent of deepestFirst) {
    const absolute = insideDataDir(dataDir, parent);
    if (absolute !== null) await rmdir(absolute).catch(() => undefined);
  }
}

export async function recoverInterruptedFirstRunImport(
  dataDir: string,
  logger: Logger,
): Promise<"none" | "rolled-back" | "finished"> {
  const root = resolve(dataDir);
  const journal = await readJournal(root);
  if (journal === null) return "none";
  if (await exists(join(root, FORK_IMPORT_STATE_FILE_NAME))) {
    await rm(join(root, FIRST_RUN_JOURNAL_FILE_NAME), { force: true });
    logger.info({ dataDir: root }, "First-run import finished its cleanup");
    return "finished";
  }
  let removed = 0;
  for (const entry of [...journal.added].reverse()) {
    const absolute = insideDataDir(root, entry.path);
    if (absolute === null) continue;
    if ((await identity(absolute)) !== entry.id) continue;
    await rm(absolute, { force: true, recursive: true });
    removed += 1;
  }
  const staging = journal.stagingDir;
  const stagingOk =
    staging.length > 0 &&
    dirname(staging) === dirname(root) &&
    basename(staging).startsWith(stagingDirPrefix(root));
  for (const path of journal.replaced) {
    const absolute = insideDataDir(root, path);
    if (absolute === null || !stagingOk) continue;
    const backup = join(staging, REPLACED_DIR_NAME, ...path.split("/"));
    if ((await exists(backup)) && !(await exists(absolute))) {
      await rename(backup, absolute);
    }
  }
  await removeEmptyParents(
    root,
    journal.added.map((entry) => entry.path),
  );
  await rm(join(root, FIRST_RUN_JOURNAL_FILE_NAME), { force: true });
  logger.warn(
    { dataDir: root, removed },
    "First-run import was interrupted; took the half-moved import back out",
  );
  return "rolled-back";
}

export async function sweepFirstRunStaging(
  dataDir: string,
  keep: string | null = null,
): Promise<number> {
  const root = resolve(dataDir);
  const prefix = stagingDirPrefix(root);
  let names: string[];
  try {
    names = await readdir(dirname(root));
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    const path = join(dirname(root), name);
    if (!name.startsWith(prefix) || path === keep) continue;
    await rm(path, { force: true, recursive: true });
    removed += 1;
  }
  return removed;
}

export interface MoveIntoDataDirArgs {
  dataDir: string;
  stagingDir: string;
  filesDir: string;
  paths: readonly string[];
  replaceable: ReadonlySet<string>;
  commit: () => Promise<void>;
}

export async function moveIntoDataDir(
  args: MoveIntoDataDirArgs,
): Promise<void> {
  const dataDir = resolve(args.dataDir);
  const replaced: string[] = [];
  const added: FirstRunJournalEntry[] = [];
  for (const path of args.paths) {
    const destination = insideDataDir(dataDir, path);
    if (destination === null) throw new Error(`unsafe import path ${path}`);
    if (await exists(destination)) {
      if (!args.replaceable.has(path)) {
        throw new FirstRunImportError(`the data dir already has ${path}`);
      }
      replaced.push(path);
    }
    const id = await identity(join(args.filesDir, ...path.split("/")));
    if (id === null) throw new FirstRunImportError(`${path} was not staged`);
    added.push({ path, id });
  }
  const journal: FirstRunJournal = {
    version: 2,
    stagingDir: args.stagingDir,
    added,
    replaced,
  };
  await writeFileAtomically(
    join(dataDir, FIRST_RUN_JOURNAL_FILE_NAME),
    `${JSON.stringify(journal, null, 2)}\n`,
  );
  try {
    for (const path of replaced) {
      const backup = join(
        args.stagingDir,
        REPLACED_DIR_NAME,
        ...path.split("/"),
      );
      await mkdir(dirname(backup), { recursive: true });
      await rename(join(dataDir, ...path.split("/")), backup);
    }
    for (const path of args.paths) {
      const destination = join(dataDir, ...path.split("/"));
      await mkdir(dirname(destination), { recursive: true });
      await rename(join(args.filesDir, ...path.split("/")), destination);
    }
    await args.commit();
  } catch (error) {
    await recoverInterruptedFirstRunImport(dataDir, {
      info: () => {},
      warn: () => {},
    }).catch(() => undefined);
    throw error;
  }
  await rm(join(dataDir, FIRST_RUN_JOURNAL_FILE_NAME), { force: true });
}

export async function writeFirstRunFailure(
  dataDir: string,
  failure: FirstRunFailure,
): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFileAtomically(
    join(dataDir, FIRST_RUN_FAILED_FILE_NAME),
    `${JSON.stringify(failure, null, 2)}\n`,
  );
}

export function readFirstRunFailure(dataDir: string): FirstRunFailure | null {
  try {
    const value = JSON.parse(
      readFileSync(join(dataDir, FIRST_RUN_FAILED_FILE_NAME), "utf8"),
    ) as Partial<FirstRunFailure>;
    return value.version === 1 && typeof value.message === "string"
      ? (value as FirstRunFailure)
      : null;
  } catch {
    return null;
  }
}

export function failureAttempts(failure: FirstRunFailure): number {
  return typeof failure.attempts === "number" && failure.attempts > 0
    ? failure.attempts
    : 1;
}

export function firstRunFailureMessage(
  sourceDataDir: string,
  reason: FirstRunFailure["reason"],
  attempts = 1,
): string {
  if (attempts >= FIRST_RUN_MAX_ATTEMPTS) {
    return `BB Studio tried ${String(attempts)} times to copy your bb data from ${sourceDataDir} and could not, so it started without it. Your bb data there is unchanged.`;
  }
  return reason === "timed-out"
    ? `BB Studio could not copy your bb data from ${sourceDataDir} in time, so it started without it. Your bb data there is unchanged.`
    : `BB Studio could not copy your bb data from ${sourceDataDir}, so it started without it. Your bb data there is unchanged.`;
}

async function listFiles(root: string, relative = ""): Promise<string[]> {
  const files: string[] = [];
  let entries;
  try {
    entries = await readdir(join(root, relative), { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const path =
      relative.length === 0 ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await listFiles(root, path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

export async function copyMissingFiles(
  fromRoot: string,
  toRoot: string,
): Promise<{ copied: number; failed: number }> {
  const rootStats = await lstat(fromRoot).catch(() => null);
  if (rootStats?.isDirectory() !== true) return { copied: 0, failed: 0 };
  const files = await listFiles(fromRoot);
  const directories = [
    ...new Set(files.map((file) => dirname(join(toRoot, ...file.split("/"))))),
  ];
  for (const directory of directories) {
    await mkdir(directory, { recursive: true });
  }
  let next = 0;
  let copied = 0;
  let failed = 0;
  const worker = async (): Promise<void> => {
    while (next < files.length) {
      const file = files[next++]!.split("/");
      const destination = join(toRoot, ...file);
      const temp = `${destination}${IMPORT_TEMP_SUFFIX}`;
      try {
        if (await exists(destination)) {
          await rm(temp, { force: true });
          continue;
        }
        await copyFile(
          join(fromRoot, ...file),
          temp,
          fsConstants.COPYFILE_FICLONE,
        );
        try {
          await link(temp, destination);
          copied += 1;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        } finally {
          await rm(temp, { force: true });
        }
      } catch {
        failed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: COPY_CONCURRENCY }, worker));
  return { copied, failed };
}

export function cleanStartHasUserContent(dataDir: string): boolean {
  const path = join(dataDir, "bb.db");
  if (!existsSync(path)) return false;
  let database: Database.Database | null = null;
  try {
    database = new Database(path, { readonly: true, fileMustExist: true });
    database.pragma("busy_timeout = 1000");
    const threads = database
      .prepare<[], { id: string }>(
        "SELECT id FROM threads WHERE deleted_at IS NULL LIMIT 2",
      )
      .all();
    if (threads.length > 1) return true;
    if (threads.length === 0) return false;
    const turns = database
      .prepare<[string], { count: number }>(
        "SELECT COUNT(*) AS count FROM events WHERE thread_id = ? AND type = 'client/turn/requested'",
      )
      .get(threads[0]!.id);
    return (turns?.count ?? 0) > 1;
  } catch {
    return true;
  } finally {
    database?.close();
  }
}

export function firstRunRetryPending(
  dataDir: string,
  failure: FirstRunFailure,
): boolean {
  return (
    (failure.retryRequested === true ||
      failureAttempts(failure) < FIRST_RUN_MAX_ATTEMPTS) &&
    !cleanStartHasUserContent(dataDir)
  );
}
