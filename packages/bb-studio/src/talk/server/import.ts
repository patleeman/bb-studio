// What the Talk upgrade bridge (packages/bb-studio-talk) calls to copy the old
// plugin's recordings into Studio: audio files first, a piece at a time, then
// the rows. See docs/merging-add-ons.md.
//
// Audio lands beside Studio's database (audio-files.ts) under the same
// relative path it had in the old plugin, so the rows import unchanged. A
// file is written to `<target>.part` at the offset the bridge sends, fsynced
// after every piece, and moved into place only once its size and SHA-256
// match. A copy that stopped part way resumes from the `.part` file's size;
// a file already in place is never written again.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, stat, statfs } from "node:fs/promises";
import { dirname } from "node:path";
import type Database from "better-sqlite3";
import { DISK_RESERVE_BYTES, type ImportRecording } from "../shared/contract";
import type { AudioFiles } from "./audio-files";

export { DISK_RESERVE_BYTES } from "../shared/contract";

type Outcome = { outcome: "imported" } | { outcome: "existing" } | { outcome: "skipped"; reason: string };

const size = (path: string) => stat(path).then((info) => (info.isFile() ? info.size : null), () => null);

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export class AudioImport {
  constructor(
    private readonly files: Pick<AudioFiles, "inside" | "root">,
    private readonly freeBytes: (path: string) => Promise<number | null> = diskFree,
  ) {}

  /** Free space where the audio goes, or null when the system won't say. */
  async free(): Promise<number | null> {
    await mkdir(this.files.root, { recursive: true });
    return this.freeBytes(this.files.root);
  }

  /** How much of a file Studio has: all of it (`complete`), or the `.part` so far. */
  async have(recordingId: string, file: string, bytes: number): Promise<{ complete: boolean; offset: number }> {
    const target = this.target(recordingId, file);
    if ((await size(target)) === bytes) return { complete: true, offset: bytes };
    const part = await size(`${target}.part`);
    return { complete: false, offset: part !== null && part <= bytes ? part : 0 };
  }

  /** Writes one piece at `offset`; returns how much Studio has and whether the file is in place. */
  async write(input: { recordingId: string; file: string; bytes: number; sha256: string; offset: number; data: string }): Promise<{ offset: number; done: boolean }> {
    const target = this.target(input.recordingId, input.file);
    const have = await this.have(input.recordingId, input.file, input.bytes);
    if (have.complete) return { offset: input.bytes, done: true };
    // A piece for another offset (a retry after a lost answer) changes nothing.
    if (input.offset !== have.offset) return { offset: have.offset, done: false };
    const piece = Buffer.from(input.data, "base64");
    if (input.offset + piece.length > input.bytes) throw new Error(`Audio ${input.file} is longer than ${input.bytes} bytes.`);
    if (input.offset === 0) {
      const free = await this.free();
      if (free !== null && free - input.bytes < DISK_RESERVE_BYTES) {
        throw new Error(`Not enough disk space for ${input.file}: ${input.bytes} bytes needed, ${free} free (Studio keeps ${DISK_RESERVE_BYTES} free).`);
      }
    }
    const part = `${target}.part`;
    await mkdir(dirname(target), { recursive: true });
    const handle = await open(part, input.offset === 0 ? "w" : "r+");
    try {
      if (input.offset === 0) await handle.truncate(0);
      await handle.write(piece, 0, piece.length, input.offset);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const offset = input.offset + piece.length;
    if (offset < input.bytes) return { offset, done: false };
    const written = await size(part);
    const hash = await sha256(part);
    if (written !== input.bytes || hash !== input.sha256) {
      await rm(part, { force: true });
      throw new Error(`Audio ${input.file} didn't arrive intact (${written} bytes, expected ${input.bytes}); it will be copied again.`);
    }
    await rename(part, target);
    return { offset, done: true };
  }

  /** Whether the file is in place at its full size. */
  async complete(recordingId: string, file: string, bytes: number): Promise<boolean> {
    return (await size(this.target(recordingId, file))) === bytes;
  }

  private target(recordingId: string, file: string): string {
    if (!file.startsWith(`${recordingId}/`)) throw new Error(`Audio ${file} isn't in recording ${recordingId}.`);
    return this.files.inside(file);
  }
}

async function diskFree(path: string): Promise<number | null> {
  try {
    const info = await statfs(path);
    return Number(info.bavail) * Number(info.bsize);
  } catch {
    return null;
  }
}

/**
 * Writes one recording and its segments as the old plugin had them. A
 * recording Studio already has is left alone, so reruns change nothing.
 * Every segment the bridge copied audio for must be in place first.
 */
export async function importRecording(
  db: Database.Database,
  audio: Pick<AudioImport, "complete">,
  item: ImportRecording,
): Promise<Outcome> {
  if (db.prepare("SELECT 1 FROM recordings WHERE id = ?").get(item.id)) return { outcome: "existing" };
  for (const segment of item.segments) {
    if (!segment.file.startsWith(`${item.id}/`)) return { outcome: "skipped", reason: `segment ${segment.id}: audio file outside the recording` };
    if (segment.audio && !(await audio.complete(item.id, segment.file, segment.bytes))) {
      // Not a reason to skip: the bridge copies audio first, and retries.
      throw new Error(`Audio ${segment.file} isn't in Studio yet; copy it first.`);
    }
  }
  const insert = db.transaction(() => {
    // A second copy (the bridge retrying after a lost answer) may have won.
    if (db.prepare("SELECT 1 FROM recordings WHERE id = ?").get(item.id)) return false;
    db.prepare(
      `INSERT INTO recordings
         (id, title, title_source, title_chars, kind, status, project_id, thread_id, created_at, updated_at,
          ended_at, heartbeat_at, archived_at, meeting_notes, audio_removed_at, notes_page_id, notes_items)
       VALUES (@id, @title, @titleSource, @titleChars, @kind, @status, @projectId, @threadId, @createdAt, @updatedAt,
          @endedAt, @heartbeatAt, @archivedAt, @meetingNotes, @audioRemovedAt, @notesPageId, @notesItems)`,
    ).run(item);
    const segment = db.prepare(
      `INSERT INTO segments
         (recording_id, id, session_id, idx, started_at, duration_ms, mime_type, bytes, file, status,
          text, error, attempts, next_attempt_at, created_at, cleaned_text)
       VALUES (@recordingId, @id, @sessionId, @index, @startedAt, @durationMs, @mimeType, @bytes, @file, @status,
          @text, @error, @attempts, @nextAttemptAt, @createdAt, @cleanedText)`,
    );
    for (const each of item.segments) {
      const { audio: _audio, ...row } = each;
      segment.run({ ...row, recordingId: item.id });
    }
    return true;
  });
  return insert() ? { outcome: "imported" } : { outcome: "existing" };
}
