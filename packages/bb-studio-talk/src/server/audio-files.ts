// Segment audio on disk beside the plugin database:
// <dataDir>/plugins/talk/audio/<recordingId>/<segmentId>.<ext>
import { mkdir, readFile, rename, rm, rmdir, writeFile, open } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, relative, resolve, sep } from "node:path";
import type Database from "better-sqlite3";

/** The directory holding the plugin's data.db. */
export function pluginDataDirectory(db: Database.Database): string {
  const main = (db.pragma("database_list") as { name: string; file: string }[]).find(
    (entry) => entry.name === "main",
  );
  if (!main?.file) throw new Error("Talk needs a file-backed plugin database for audio storage.");
  return dirname(main.file);
}

const EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
};

export function extensionFor(mimeType: string): string {
  return EXTENSIONS[mimeType.split(";")[0]!.trim().toLowerCase()] ?? "bin";
}

export class AudioFiles {
  readonly root: string;

  constructor(dataDirectory: string) {
    this.root = resolve(dataDirectory, "audio");
  }

  /** Writes durably (temp file, fsync, rename) and returns the relative path. */
  async write(recordingId: string, segmentId: string, mimeType: string, bytes: Uint8Array, wanted: () => boolean = () => true): Promise<string> {
    const relativePath = join(recordingId, `${segmentId}.${extensionFor(mimeType)}`);
    const target = this.inside(relativePath);
    // A late chunk for a deleted recording must not bring its directory back.
    if (!wanted()) throw new Error(`No recording ${recordingId}.`);
    await mkdir(dirname(target), { recursive: true });
    const temp = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, bytes, { flag: "wx" });
      const handle = await open(temp, "r+");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temp, target);
    } finally {
      await rm(temp, { force: true });
    }
    if (!wanted()) {
      await this.remove(relativePath);
      await this.removeEmptyDirectory(recordingId);
      throw new Error(`No recording ${recordingId}.`);
    }
    return relativePath;
  }

  read(relativePath: string): Promise<Buffer> {
    return readFile(this.inside(relativePath));
  }

  async remove(relativePath: string): Promise<void> {
    await rm(this.inside(relativePath), { force: true });
  }

  /** Removes a recording's directory only if nothing is in it. */
  async removeEmptyDirectory(recordingId: string): Promise<void> {
    await rmdir(this.inside(recordingId)).catch(() => {});
  }

  async removeRecording(recordingId: string): Promise<void> {
    await rm(this.inside(recordingId), { recursive: true, force: true });
  }

  /** Resolves a stored relative path, refusing anything outside the root. */
  inside(relativePath: string): string {
    const target = resolve(this.root, relativePath);
    const back = relative(this.root, target);
    if (back === "" || back.startsWith("..") || back.includes(`..${sep}`) || resolve(back) === back) {
      throw new Error(`Refusing audio path outside the Talk store: ${relativePath}`);
    }
    return target;
  }
}
