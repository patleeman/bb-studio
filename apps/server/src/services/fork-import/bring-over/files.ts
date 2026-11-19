import { constants as fsConstants } from "node:fs";
import { copyFile, link, lstat, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

const COPY_CONCURRENCY = 16;
const IMPORT_TEMP_SUFFIX = ".import-tmp";

export class BringOverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BringOverError";
  }
}

export class BringOverCancelledError extends Error {
  constructor() {
    super("cancelled");
    this.name = "BringOverCancelledError";
  }
}

export function errorDetail(error: unknown): string {
  if (
    error instanceof BringOverError ||
    error instanceof BringOverCancelledError
  ) {
    return error.message;
  }
  const { code, syscall } = (error ?? {}) as NodeJS.ErrnoException;
  if (typeof code === "string") {
    return typeof syscall === "string" ? `${code} (${syscall})` : code;
  }
  return error instanceof Error ? error.name : "unknown error";
}

export function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new BringOverCancelledError();
}

export async function exists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    () => false,
  );
}

async function isRealDirectory(path: string): Promise<boolean> {
  const stats = await lstat(path).catch(() => null);
  return stats?.isDirectory() === true;
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

export async function copyFileIfMissing(
  from: string,
  to: string,
): Promise<boolean> {
  const temp = `${to}${IMPORT_TEMP_SUFFIX}`;
  if (await exists(to)) {
    await rm(temp, { force: true });
    return false;
  }
  const source = await lstat(from).catch(() => null);
  if (source?.isFile() !== true) return false;
  await mkdir(dirname(to), { recursive: true });
  await copyFile(from, temp, fsConstants.COPYFILE_FICLONE);
  try {
    await link(temp, to);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally {
    await rm(temp, { force: true });
  }
}

export async function copyMissingTree(
  fromRoot: string,
  toRoot: string,
  signal?: AbortSignal,
): Promise<string[]> {
  if (!(await isRealDirectory(fromRoot))) return [];
  const files = await listFiles(fromRoot);
  const created: string[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < files.length) {
      throwIfCancelled(signal);
      const file = files[next++]!.split("/");
      const to = join(toRoot, ...file);
      if (await copyFileIfMissing(join(fromRoot, ...file), to)) {
        created.push(to);
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: COPY_CONCURRENCY }, worker));
  } catch (error) {
    await removeCreated(created);
    throw error;
  }
  return created;
}

export async function removeCreated(paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    await rm(path, { force: true, recursive: true }).catch(() => undefined);
  }
}
