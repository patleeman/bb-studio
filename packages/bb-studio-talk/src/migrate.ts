// Copies the old Studio Talk plugin's recordings into Studio, where Talk is
// built in now:
//
// 1. Audio. Each segment's file under this plugin's data folder
//    (`<dataDir>/plugins/talk/audio/<recording>/<segment>.<ext>`) goes to
//    Studio in pieces of AUDIO_CHUNK_BYTES, read from disk a piece at a time,
//    with its size and SHA-256. Studio writes each piece durably and keeps a
//    file only when it arrives whole, so a copy that stops resumes where it
//    stopped and a file Studio has is never sent again. Before sending
//    anything, the copy checks that Studio's disk has room for what's left
//    (plus DISK_RESERVE_BYTES). The originals stay here: removing this plugin
//    deletes them, after the copy completes.
// 2. Rows, in batches (by count and transcript size), once their audio is in
//    Studio. Each recording Studio has (copied now or before) gets a
//    `migrated:<id>` marker, so a rerun only sends what's left. Malformed rows
//    are listed, kept here, and never sent.
// 3. Settings and model choices, once (`migrated-settings`).
//
// The bridge never writes recordings, so once every row has a marker or is
// skipped, and the settings went, the copy is complete.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type Database from "better-sqlite3";
import {
  AUDIO_CHECK_BATCH, AUDIO_CHUNK_BYTES, AUDIO_FILE, DISK_RESERVE_BYTES, IMPORT_BATCH, IMPORT_BATCH_CHARS, importRecordingSchema,
  type ImportRecording, type MigrationStatus, type ModelPreferences, type TalkSettings,
} from "@bb-studio/kit/talk-contract";

/** BB checks each statement's hash: these are the old plugin's statements, byte for byte. */
export const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS recordings (
     id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     title_source TEXT NOT NULL,
     title_chars INTEGER NOT NULL DEFAULT 0,
     kind TEXT NOT NULL,
     status TEXT NOT NULL,
     project_id TEXT,
     thread_id TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     ended_at INTEGER,
     heartbeat_at INTEGER NOT NULL
   , archived_at INTEGER, meeting_notes TEXT, audio_removed_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS segments (
     recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
     id TEXT NOT NULL,
     session_id TEXT NOT NULL,
     idx INTEGER NOT NULL,
     started_at INTEGER NOT NULL,
     duration_ms INTEGER NOT NULL,
     mime_type TEXT NOT NULL,
     bytes INTEGER NOT NULL,
     file TEXT NOT NULL,
     status TEXT NOT NULL,
     text TEXT,
     error TEXT,
     attempts INTEGER NOT NULL DEFAULT 0,
     next_attempt_at INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL, cleaned_text TEXT,
     PRIMARY KEY (recording_id, id)
   )`,
  `CREATE INDEX IF NOT EXISTS segments_order ON segments(recording_id, started_at, idx)`,
  `CREATE INDEX IF NOT EXISTS segments_pending ON segments(status, next_attempt_at)`,
  `CREATE INDEX IF NOT EXISTS recordings_updated ON recordings(updated_at)`,
  `ALTER TABLE recordings ADD COLUMN notes_page_id TEXT`,
  `ALTER TABLE recordings ADD COLUMN notes_items TEXT`,
];

export const MIGRATED = "migrated:";
export const SETTINGS_MIGRATED = "migrated-settings";

type Result = { imported: string[]; existing: string[]; skipped: { id: string; reason: string }[] };
type AudioRef = { recordingId: string; file: string };

/** What the copy needs from Studio: its `recordings.*` bridge methods. */
export interface StudioImport {
  missingAudio(files: (AudioRef & { bytes: number })[]): Promise<{ missing: (AudioRef & { offset: number })[]; freeBytes: number | null }>;
  importAudio(input: AudioRef & { bytes: number; sha256: string; offset: number; data: string }): Promise<{ offset: number; done: boolean }>;
  importRows(recordings: ImportRecording[]): Promise<Result>;
  importSettings(input: { settings: TalkSettings; models: Partial<ModelPreferences> }): Promise<{ applied: string[] }>;
}

export interface Markers {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

type Row = Record<string, unknown>;

const reasonOf = (error: { issues: { path: PropertyKey[]; message: string }[] }) => {
  const issue = error.issues[0];
  return `${issue?.path.join(".") || "row"}: ${issue?.message ?? "invalid"}`;
};

/** A file under the audio folder, or null for a path that would leave it. */
export function audioPath(root: string, file: string): string | null {
  if (!AUDIO_FILE.test(file)) return null;
  const target = resolve(root, file);
  const back = relative(root, target);
  return back && !back.startsWith("..") && !back.includes(`..${sep}`) ? target : null;
}

const fileSize = (path: string | null) => (path ? stat(path).then((info) => (info.isFile() ? info.size : null), () => null) : Promise.resolve(null));

/**
 * A recording with its segments in the import shape, or why it can't be
 * copied. A segment's audio goes along when its file is here, and `bytes` is
 * the file's size on disk. A dictation whose audio expired has none.
 */
export async function readRecording(db: Database.Database, root: string, row: Row): Promise<{ item: ImportRecording } | { reason: string }> {
  const segments = db.prepare("SELECT * FROM segments WHERE recording_id = ? ORDER BY started_at, session_id, idx").all(row.id) as Row[];
  const audioKept = row.audio_removed_at == null;
  const read = await Promise.all(segments.map(async (each) => {
    const size = audioKept ? await fileSize(audioPath(root, String(each.file))) : null;
    return {
      id: each.id, sessionId: each.session_id, index: each.idx, startedAt: each.started_at, durationMs: each.duration_ms,
      mimeType: each.mime_type, bytes: size ?? each.bytes, file: each.file, audio: size !== null, status: each.status,
      text: each.text, cleanedText: each.cleaned_text ?? null, error: each.error, attempts: each.attempts,
      nextAttemptAt: each.next_attempt_at, createdAt: each.created_at,
    };
  }));
  const parsed = importRecordingSchema.safeParse({
    id: row.id, title: row.title, titleSource: row.title_source, titleChars: row.title_chars, kind: row.kind, status: row.status,
    projectId: row.project_id, threadId: row.thread_id, createdAt: row.created_at, updatedAt: row.updated_at, endedAt: row.ended_at,
    heartbeatAt: row.heartbeat_at, archivedAt: row.archived_at, audioRemovedAt: row.audio_removed_at,
    meetingNotes: row.meeting_notes ?? null, notesPageId: row.notes_page_id ?? null, notesItems: row.notes_items ?? null,
    segments: read,
  });
  return parsed.success ? { item: parsed.data } : { reason: reasonOf(parsed.error) };
}

/** A recording's size on the wire: its transcripts. */
const size = (item: ImportRecording) => item.segments.reduce((sum, segment) => sum + (segment.text?.length ?? 0) + (segment.cleanedText?.length ?? 0), 0);

/** Batches of at most IMPORT_BATCH recordings and IMPORT_BATCH_CHARS of transcript; a larger recording goes alone. */
export function batches(items: ImportRecording[]): ImportRecording[][] {
  const out: ImportRecording[][] = [];
  let current: ImportRecording[] = [];
  let chars = 0;
  for (const item of items) {
    if (current.length && (current.length >= IMPORT_BATCH || chars + size(item) > IMPORT_BATCH_CHARS)) {
      out.push(current);
      current = [];
      chars = 0;
    }
    current.push(item);
    chars += size(item);
  }
  if (current.length) out.push(current);
  return out;
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

const mb = (bytes: number) => `${Math.ceil(bytes / (1024 * 1024))} MB`;

/** The audio files these recordings carry. */
const audioOf = (items: ImportRecording[]) =>
  items.flatMap((item) => item.segments.filter((segment) => segment.audio).map((segment) => ({ recordingId: item.id, file: segment.file, bytes: segment.bytes })));

/** Which of these files Studio doesn't have whole, with where each copy resumes. */
async function missingAudio(studio: StudioImport, files: (AudioRef & { bytes: number })[]) {
  const bytes = new Map(files.map((each) => [each.file, each.bytes]));
  const missing: (AudioRef & { offset: number; bytes: number })[] = [];
  let freeBytes: number | null = null;
  for (let start = 0; start < files.length; start += AUDIO_CHECK_BATCH) {
    const result = await studio.missingAudio(files.slice(start, start + AUDIO_CHECK_BATCH));
    freeBytes = result.freeBytes;
    for (const each of result.missing) missing.push({ ...each, bytes: bytes.get(each.file) ?? 0 });
  }
  return { missing, freeBytes };
}

/** Sends one file from `offset`, a piece at a time, following where Studio says it is. */
async function copyFile(studio: StudioImport, root: string, ref: AudioRef & { offset: number; bytes: number }): Promise<void> {
  const path = audioPath(root, ref.file);
  if (!path) throw new Error(`Audio ${ref.file} isn't in Talk's audio folder.`);
  const digest = await sha256(path);
  const handle = await open(path, "r");
  try {
    let offset = ref.offset;
    for (;;) {
      const length = Math.min(AUDIO_CHUNK_BYTES, Math.max(0, ref.bytes - offset));
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      const result = await studio.importAudio({ recordingId: ref.recordingId, file: ref.file, bytes: ref.bytes, sha256: digest, offset, data: buffer.subarray(0, bytesRead).toString("base64") });
      if (result.done) return;
      if (result.offset === offset && bytesRead === 0) throw new Error(`Audio ${ref.file} ended before ${ref.bytes} bytes.`);
      offset = result.offset;
    }
  } finally {
    await handle.close();
  }
}

export interface MigrateOptions {
  /** This plugin's audio folder. */
  audioRoot: string;
  /** The user's Talk settings and model choices, to copy once. */
  settings(): Promise<{ settings: TalkSettings; models: Partial<ModelPreferences> }>;
}

export async function migrate(db: Database.Database, studio: StudioImport, markers: Markers, options: MigrateOptions): Promise<Omit<MigrationStatus, "error">> {
  const ids = db.prepare("SELECT id FROM recordings ORDER BY created_at, id").all() as { id: string }[];
  const get = db.prepare("SELECT * FROM recordings WHERE id = ?");
  const files = db.prepare("SELECT s.file AS file FROM segments s JOIN recordings r ON r.id = s.recording_id WHERE s.recording_id = ? AND r.audio_removed_at IS NULL");
  const skipped: { id: string; reason: string }[] = [];
  let copied = 0;

  const left: string[] = [];
  for (const { id } of ids) {
    if ((await markers.get(`${MIGRATED}${id}`)) != null) copied++;
    else left.push(id);
  }

  // Room for the audio still to copy, before copying any of it. Only the
  // file list is read here; transcripts are read a batch at a time below.
  if (left.length) {
    const wanted: (AudioRef & { bytes: number })[] = [];
    for (const recordingId of left) {
      for (const { file } of files.all(recordingId) as { file: string }[]) {
        const bytes = await fileSize(audioPath(options.audioRoot, file));
        if (bytes !== null) wanted.push({ recordingId, file, bytes });
      }
    }
    const { missing, freeBytes } = await missingAudio(studio, wanted);
    const needed = missing.reduce((sum, each) => sum + Math.max(0, each.bytes - each.offset), 0);
    if (freeBytes !== null && needed > 0 && needed + DISK_RESERVE_BYTES > freeBytes) {
      throw new Error(`Not enough disk space for Talk's audio in Studio: ${mb(needed)} to copy, ${mb(freeBytes)} free, and Studio keeps ${mb(DISK_RESERVE_BYTES)} free. Free some space, then run bb talk migrate again; what's copied so far is kept.`);
    }
  }

  // Each batch: its audio, then its rows.
  let pending: ImportRecording[] = [];
  let pendingChars = 0;
  const flush = async () => {
    for (const batch of batches(pending)) {
      const { missing } = await missingAudio(studio, audioOf(batch));
      for (const each of missing) await copyFile(studio, options.audioRoot, each);
      const result = await studio.importRows(batch);
      for (const id of [...result.imported, ...result.existing]) {
        await markers.set(`${MIGRATED}${id}`, { at: Date.now() });
        copied++;
      }
      skipped.push(...result.skipped);
    }
    pending = [];
    pendingChars = 0;
  };
  for (const id of left) {
    const read = await readRecording(db, options.audioRoot, get.get(id) as Row);
    if ("reason" in read) { skipped.push({ id, reason: read.reason }); continue; }
    pending.push(read.item);
    pendingChars += size(read.item);
    if (pending.length >= IMPORT_BATCH || pendingChars >= IMPORT_BATCH_CHARS) await flush();
  }
  await flush();

  let settingsCopied = (await markers.get(SETTINGS_MIGRATED)) != null;
  if (!settingsCopied) {
    const { applied } = await studio.importSettings(await options.settings());
    await markers.set(SETTINGS_MIGRATED, { at: Date.now(), applied });
    settingsCopied = true;
  }

  // Skipped rows can't be copied by trying again; they're listed, not waited on.
  return { complete: settingsCopied && copied + skipped.length === ids.length, total: ids.length, copied, skipped };
}
