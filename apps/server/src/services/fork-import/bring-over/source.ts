import Database from "better-sqlite3";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { readPrimaryHostIdFromDataDir } from "../../hosts/primary-host.js";
import { resolveForkImportSource } from "../import-source.js";
import { BringOverError, exists } from "./files.js";
import { snapshotDatabases } from "./snapshot.js";

export const BRING_OVER_DIR_NAME = "fork-bring-over";
const SNAPSHOT_FILE_NAME = "bb.db";

export interface SourceSnapshot {
  sourceDataDir: string;
  snapshotPath: string;
  takenAt: number;
  sourceHostId: string | null;
}

export async function bringOverSource(
  dataDir: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<string | null> {
  const source = resolveForkImportSource({ dataDir, env });
  if (source === null || source === dataDir) return null;
  return (await exists(join(source, "bb.db"))) ? source : null;
}

function snapshotPath(dataDir: string): string {
  return join(dataDir, BRING_OVER_DIR_NAME, SNAPSHOT_FILE_NAME);
}

export async function takeSourceSnapshot(args: {
  dataDir: string;
  sourceDataDir: string;
  now: number;
  signal?: AbortSignal;
}): Promise<SourceSnapshot> {
  const directory = join(args.dataDir, BRING_OVER_DIR_NAME);
  await mkdir(directory, { recursive: true });
  const temp = join(directory, `${SNAPSHOT_FILE_NAME}.${String(args.now)}.tmp`);
  await rm(temp, { force: true });
  try {
    await snapshotDatabases(
      [{ from: join(args.sourceDataDir, "bb.db"), to: temp }],
      args.signal,
    );
    const copy = new Database(temp, { fileMustExist: true });
    try {
      copy.pragma("journal_mode = DELETE");
    } finally {
      copy.close();
    }
    const target = snapshotPath(args.dataDir);
    for (const suffix of ["-wal", "-shm"]) {
      await rm(`${target}${suffix}`, { force: true });
    }
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  return {
    sourceDataDir: args.sourceDataDir,
    snapshotPath: snapshotPath(args.dataDir),
    takenAt: args.now,
    sourceHostId: readPrimaryHostIdFromDataDir({
      dataDir: args.sourceDataDir,
    }),
  };
}

export async function existingSourceSnapshot(
  dataDir: string,
  sourceDataDir: string,
): Promise<SourceSnapshot | null> {
  const path = snapshotPath(dataDir);
  const stats = await stat(path).catch(() => null);
  if (stats === null) return null;
  return {
    sourceDataDir,
    snapshotPath: path,
    takenAt: Math.round(stats.mtimeMs),
    sourceHostId: readPrimaryHostIdFromDataDir({ dataDir: sourceDataDir }),
  };
}

export function openSnapshot(snapshot: SourceSnapshot): Database.Database {
  try {
    return new Database(snapshot.snapshotPath, {
      fileMustExist: true,
      readonly: true,
    });
  } catch {
    throw new BringOverError("the copy of bb's database could not be opened");
  }
}
