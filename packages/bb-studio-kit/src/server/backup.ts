// File helpers behind the Studio backup contract (../backup.ts). An add-on
// gets a writer or reader for its own section folder and never a path from
// the caller: the folder is `<BB data>/plugins/studio/backup-sessions/<session>/<pluginId>/`.
import { copyFile, link, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { z as Zod } from "zod";
import { BACKUP_SESSION_PATTERN, RestoreTally, studioBackupSchemas, type RestoreReport } from "../backup";
import { STUDIO_PLUGIN_ID } from "../contract";

/** A JSON file larger than this is refused rather than read into memory. */
const MAX_JSON_BYTES = 256 * 1024 * 1024;

/** Where Studio keeps backup session folders. */
export function backupSessionRoot(dataDir: string): string {
  return join(dataDir, "plugins", STUDIO_PLUGIN_ID, "backup-sessions");
}

/** One add-on's folder in a session. Refuses a malformed session or plugin id. */
export function backupSectionDir(dataDir: string, session: string, pluginId: string): string {
  if (!BACKUP_SESSION_PATTERN.test(session)) throw new Error("Not a backup session id.");
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(pluginId)) throw new Error("Not a plugin id.");
  return join(backupSessionRoot(dataDir), session, pluginId);
}

/**
 * A path in a section folder, refusing absolute paths, `..`, backslashes and
 * empty segments, so a crafted name can't reach outside it.
 */
export function sectionPath(root: string, rel: string): string {
  if (!rel || rel.length > 500 || isAbsolute(rel) || rel.includes("\\") || rel.includes("\0")) throw new Error(`Refusing backup path: ${rel}`);
  const parts = rel.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) throw new Error(`Refusing backup path: ${rel}`);
  const target = resolve(root, normalize(rel));
  const back = relative(root, target);
  if (!back || back.startsWith("..") || isAbsolute(back) || back.split(sep).includes("..")) throw new Error(`Refusing backup path: ${rel}`);
  return target;
}

/** A file-name-safe form of an item id, for `items/<id>.json`. */
export function fileSafeId(id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(id) || id.includes("..")) throw new Error(`Item id can't be a backup file name: ${id}`);
  return id.replace(/:/g, "_");
}

/** Writes an add-on's section. Counts what it wrote. */
export class BackupWriter {
  files = 0;
  bytes = 0;

  constructor(readonly dir: string) {}

  async json(rel: string, value: unknown): Promise<void> {
    await this.bytesAt(rel, Buffer.from(`${JSON.stringify(value)}\n`));
  }

  async bytesAt(rel: string, data: Uint8Array): Promise<void> {
    const target = sectionPath(this.dir, rel);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data, { flag: "wx" });
    this.files += 1;
    this.bytes += data.byteLength;
  }

  /**
   * Adds a file already on disk, such as recorded audio, without reading it
   * into memory: a hard link where the filesystem allows, else a copy.
   */
  async copy(rel: string, source: string): Promise<void> {
    const target = sectionPath(this.dir, rel);
    await mkdir(dirname(target), { recursive: true });
    await link(source, target).catch(() => copyFile(source, target));
    this.files += 1;
    this.bytes += (await stat(target)).size;
  }
}

/** Reads an add-on's section, refusing paths outside it. */
export class BackupReader {
  constructor(readonly dir: string) {}

  path(rel: string): string {
    return sectionPath(this.dir, rel);
  }

  async exists(rel: string): Promise<boolean> {
    return stat(this.path(rel)).then((info) => info.isFile(), () => false);
  }

  /** The file names in a folder, sorted; none when it doesn't exist. */
  async list(relDir: string): Promise<string[]> {
    const entries = await readdir(this.path(relDir), { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  }

  async json<T>(rel: string): Promise<T> {
    const target = this.path(rel);
    const info = await stat(target);
    if (info.size > MAX_JSON_BYTES) throw new Error(`${rel} is too large to restore.`);
    try {
      return JSON.parse(await readFile(target, "utf8")) as T;
    } catch (error) {
      throw new Error(`${rel} isn't valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  bytes(rel: string): Promise<Buffer> {
    return readFile(this.path(rel));
  }

  async size(rel: string): Promise<number> {
    return (await stat(this.path(rel))).size;
  }
}

export interface BackupHandlers {
  /** The add-on's section layout version, saved in the manifest. */
  version: number;
  backup(writer: BackupWriter): Promise<{ counts: Record<string, number>; notes?: string[] }>;
  restore(
    reader: BackupReader,
    options: { dryRun: boolean; version: number; projects: Readonly<Record<string, string | null>>; tally: RestoreTally },
  ): Promise<void>;
}

/** Backs up into `dir`, which must not exist yet. */
export async function runBackup(dir: string, handlers: BackupHandlers) {
  await mkdir(dirname(dir), { recursive: true });
  await mkdir(dir);
  const writer = new BackupWriter(dir);
  try {
    const { counts, notes = [] } = await handlers.backup(writer);
    return { version: handlers.version, counts, files: writer.files, bytes: writer.bytes, notes: notes.slice(0, 50) };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

/** Restores from `dir`; a missing folder is an empty section. */
export async function runRestore(
  dir: string,
  handlers: BackupHandlers,
  input: { dryRun: boolean; version: number; projects: Readonly<Record<string, string | null>> },
): Promise<RestoreReport> {
  if (input.version > handlers.version) throw new Error(`This backup was made by a newer version of this add-on (section version ${input.version}; this one reads up to ${handlers.version}). Update the add-on and try again.`);
  const tally = new RestoreTally(input.dryRun);
  await handlers.restore(new BackupReader(dir), { ...input, tally });
  return tally.result();
}

/**
 * Registers `studio_backup` and `studio_restore` for this add-on. They're
 * published for discovery: an add-on without them is reported as skipped.
 */
export function registerStudioBackup(bb: Pick<BbPluginApi, "rpc" | "server" | "pluginId">, z: typeof Zod, handlers: BackupHandlers): void {
  const schemas = studioBackupSchemas(z);
  const dir = (session: string) => backupSectionDir(bb.server.experimental_dataDir, session, bb.pluginId);
  bb.rpc.register(schemas.provider, {
    studio_backup: ({ session }) => runBackup(dir(session), handlers),
    studio_restore: ({ session, ...input }) => runRestore(dir(session), handlers, input),
  }, {
    experimental_discoverable: true,
    experimental_description: "BB Studio backup: saves and restores this plugin's items for `bb studio backup` and `bb studio restore`.",
  });
}
