import { constants as fsConstants, readFileSync } from "node:fs";
import {
  copyFile,
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

const REPLACED_DIR_NAME = "replaced";
const COPY_CONCURRENCY = 16;

export interface FirstRunJournal {
  version: 1;
  stagingDir: string;
  added: string[];
  replaced: string[];
}

export interface FirstRunFailure {
  version: 1;
  sourceDataDir: string;
  failedAt: number;
  reason: "timed-out" | "error";
  detail: string;
  message: string;
}

type Logger = Pick<ServerLogger, "info" | "warn">;

export class FirstRunImportTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`the import did not finish within ${Math.round(timeoutMs / 1000)}s`);
    this.name = "FirstRunImportTimeoutError";
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

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    () => false,
  );
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
  try {
    const value = JSON.parse(text) as Partial<FirstRunJournal>;
    if (
      value.version === 1 &&
      typeof value.stagingDir === "string" &&
      Array.isArray(value.added) &&
      Array.isArray(value.replaced)
    ) {
      return value as FirstRunJournal;
    }
  } catch {}
  return { version: 1, stagingDir: "", added: [], replaced: [] };
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
  for (const path of [...journal.added].reverse()) {
    const absolute = insideDataDir(root, path);
    if (absolute === null) continue;
    await rm(absolute, { force: true, recursive: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOTDIR") throw error;
      },
    );
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
    if (await exists(backup)) await rename(backup, absolute);
  }
  await removeEmptyParents(root, journal.added);
  await rm(join(root, FIRST_RUN_JOURNAL_FILE_NAME), { force: true });
  logger.warn(
    { dataDir: root, added: journal.added.length },
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
  for (const path of args.paths) {
    const destination = insideDataDir(dataDir, path);
    if (destination === null) throw new Error(`unsafe import path ${path}`);
    if (await exists(destination)) {
      if (!args.replaceable.has(path)) {
        throw new Error(`the data dir already has ${path}`);
      }
      replaced.push(path);
    }
  }
  const journal: FirstRunJournal = {
    version: 1,
    stagingDir: args.stagingDir,
    added: [...args.paths],
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

export function firstRunFailureMessage(
  sourceDataDir: string,
  reason: FirstRunFailure["reason"],
): string {
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
      try {
        await copyFile(
          join(fromRoot, ...file),
          join(toRoot, ...file),
          fsConstants.COPYFILE_EXCL | fsConstants.COPYFILE_FICLONE,
        );
        copied += 1;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") failed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: COPY_CONCURRENCY }, worker));
  return { copied, failed };
}
