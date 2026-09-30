// Segment audio on disk beside the plugin database:
// <dataDir>/plugins/talk/audio/<recordingId>/<segmentId>.<ext>
import { mkdir, readFile, rename, rm, writeFile, open } from "node:fs/promises";
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
  async write(recordingId: string, segmentId: string, mimeType: string, bytes: Uint8Array): Promise<string> {
    const relativePath = join(recordingId, `${segmentId}.${extensionFor(mimeType)}`);
    const target = this.inside(relativePath);
    await mkdir(dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, bytes);
    const handle = await open(temp, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, target);
    return relativePath;
  }

  read(relativePath: string): Promise<Buffer> {
    return readFile(this.inside(relativePath));
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
