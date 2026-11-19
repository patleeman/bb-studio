import { constants, type Stats } from "node:fs";
import fs from "node:fs/promises";
import {
  CommandDispatchError,
  ExpectedCommandDispatchError,
} from "../command-dispatch-support.js";

export const O_NOFOLLOW_ANY_DARWIN = 0x20000000;

export interface ForkWithinRootRead {
  stat: Stats;
  fileContents: Buffer;
}

interface ForkReadArgs {
  resolvedPath: string;
  rootPath?: string;
}

const SWAP_ERROR_CODES = new Set(["ELOOP", "ENOTDIR", "EINVAL", "EMLINK"]);

function fileChanged(): ExpectedCommandDispatchError {
  return new ExpectedCommandDispatchError(
    "file_changed",
    "File changed during read",
  );
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

function mapSwapError(error: unknown): never {
  const code = errorCode(error);
  if (code !== undefined && SWAP_ERROR_CODES.has(code)) throw fileChanged();
  throw error;
}

export function noSymlinkOpenFlags(
  platform: NodeJS.Platform = process.platform,
): number {
  const base = constants.O_RDONLY | constants.O_NONBLOCK;
  if (platform === "darwin") return base | O_NOFOLLOW_ANY_DARWIN;
  return base | (constants.O_NOFOLLOW ?? 0);
}

export async function openRefusingSymlinks(
  path: string,
): Promise<fs.FileHandle> {
  try {
    return await fs.open(path, noSymlinkOpenFlags());
  } catch (error) {
    if (process.platform !== "darwin" || errorCode(error) !== "EINVAL") {
      throw error;
    }
    return fs.open(
      path,
      constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
    );
  }
}

async function assertHandleIsPath(
  file: fs.FileHandle,
  readablePath: string,
): Promise<void> {
  if (process.platform !== "linux") return;
  const opened = await fs.readlink(`/proc/self/fd/${file.fd}`);
  if (opened !== readablePath) throw fileChanged();
}

async function assertStillTheCheckedFile(
  file: fs.FileHandle,
  readablePath: string,
  requestedPath: string,
): Promise<void> {
  const opened = await file.stat({ bigint: true });
  const resolvedNow = await fs.realpath(requestedPath);
  const atPath = await fs.stat(resolvedNow, { bigint: true });
  if (
    resolvedNow !== readablePath ||
    atPath.dev !== opened.dev ||
    atPath.ino !== opened.ino
  ) {
    throw fileChanged();
  }
}

async function throwIfDirectory(path: string, error: unknown): Promise<never> {
  const code = errorCode(error);
  if (code === "EISDIR" || code === "EPERM" || code === "EACCES") {
    const stat = await fs.stat(path).catch(() => null);
    if (stat?.isDirectory()) {
      throw new CommandDispatchError(
        "invalid_path",
        "Path is a directory, not a file",
      );
    }
  }
  throw error;
}

export async function forkOpenWithinRoot(
  readablePath: string,
  args: ForkReadArgs,
  unrootedFlags: number,
): Promise<fs.FileHandle> {
  if (!args.rootPath) return fs.open(readablePath, unrootedFlags);
  const file = await openRefusingSymlinks(readablePath)
    .catch(mapSwapError)
    .catch((error: unknown) => throwIfDirectory(readablePath, error));
  try {
    await assertHandleIsPath(file, readablePath);
    await assertStillTheCheckedFile(
      file,
      readablePath,
      args.resolvedPath,
    ).catch(mapSwapError);
    return file;
  } catch (error) {
    await file.close();
    throw error;
  }
}

async function readCapped(
  file: fs.FileHandle,
  expectedBytes: number,
  limitBytes: number,
): Promise<Buffer> {
  const bytes = Buffer.alloc(Math.min(expectedBytes, limitBytes) + 1);
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesRead } = await file.read(
      bytes,
      offset,
      bytes.length - offset,
      offset,
    );
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  if (offset > limitBytes) {
    throw new CommandDispatchError(
      "file_too_large",
      `File grew past the ${Math.floor(limitBytes / (1024 * 1024))} MB limit during read`,
    );
  }
  if (offset !== expectedBytes) throw fileChanged();
  return bytes.subarray(0, offset);
}

export async function forkReadWithinRoot(
  readablePath: string,
  args: ForkReadArgs,
  limitBytes: number,
): Promise<ForkWithinRootRead> {
  if (!args.rootPath) {
    const stat = await fs.stat(readablePath);
    if (!stat.isFile() || stat.size > limitBytes) {
      return { stat, fileContents: Buffer.alloc(0) };
    }
  }
  const file = await forkOpenWithinRoot(
    readablePath,
    args,
    constants.O_RDONLY | constants.O_NONBLOCK,
  );
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > limitBytes) {
      return { stat, fileContents: Buffer.alloc(0) };
    }
    return {
      stat,
      fileContents: await readCapped(file, stat.size, limitBytes),
    };
  } finally {
    await file.close();
  }
}
