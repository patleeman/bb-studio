import { constants, type Stats } from "node:fs";
import fs from "node:fs/promises";
import {
  CommandDispatchError,
  ExpectedCommandDispatchError,
} from "../command-dispatch-support.js";

export interface ForkWithinRootRead {
  stat: Stats;
  fileContents: Buffer;
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
  if (offset !== expectedBytes) {
    throw new ExpectedCommandDispatchError(
      "file_changed",
      "File changed during read",
    );
  }
  return bytes.subarray(0, offset);
}

async function assertStillTheCheckedFile(
  readablePath: string,
  requestedPath: string,
  opened: Stats,
): Promise<void> {
  const resolvedNow = await fs.realpath(requestedPath);
  const atPath = await fs.stat(resolvedNow);
  if (
    resolvedNow !== readablePath ||
    atPath.dev !== opened.dev ||
    atPath.ino !== opened.ino
  ) {
    throw new ExpectedCommandDispatchError(
      "file_changed",
      "File changed during read",
    );
  }
}

export async function forkReadWithinRoot(
  readablePath: string,
  args: { resolvedPath: string; rootPath?: string },
  limitBytes: number,
): Promise<ForkWithinRootRead> {
  const file = await fs.open(
    readablePath,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await file.stat();
    if (args.rootPath) {
      await assertStillTheCheckedFile(readablePath, args.resolvedPath, stat);
    }
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
