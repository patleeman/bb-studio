// Talk's section of a BB Studio backup (see @bb-studio/kit/backup).
//
// Layout, inside Talk's section folder:
//   items/<recordingId>.json        one recording: its row, segments and transcripts
//   audio/<recordingId>/<file>      that recording's segment audio, hard-linked or copied
//
// Restore is keyed by recording id, so running it twice changes nothing, and a
// newer copy here is never overwritten. Audio is copied into place (temp file,
// fsync, rename) before one transaction writes every row.
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type Database from "better-sqlite3";
import { mapProject, restoreDecision } from "@bb-studio/kit/backup";
import { fileSafeId, fileSafeIdMatches, type BackupHandlers, type BackupReader, type BackupWriter } from "@bb-studio/kit/server";
import { z } from "zod";
import { meetingNotesSchema, recordingKindSchema, recordingStatusSchema, segmentStatusSchema } from "../shared/contract";
import { extensionFor, type AudioFiles } from "./audio-files";

export const TALK_BACKUP_VERSION = 1;

const NOT_TRANSCRIBED = "Not transcribed before the backup was made. Retry to transcribe it.";
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;
const AUDIO_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}\.[a-z0-9]{1,8}$/;

const time = z.number().int().min(0);
const segmentSchema = z.object({
  id: z.string().regex(ID),
  sessionId: z.string().min(1).max(200),
  index: z.number().int().min(0),
  startedAt: time,
  durationMs: z.number().int().min(0),
  mimeType: z.string().min(1).max(200),
  bytes: z.number().int().min(0),
  status: segmentStatusSchema,
  text: z.string().nullable(),
  cleanedText: z.string().nullable(),
  error: z.string().max(2000).nullable(),
  attempts: z.number().int().min(0),
  createdAt: time,
  /** The audio file's name under `audio/<recordingId>/`, or null when it wasn't saved. */
  audio: z.string().regex(AUDIO_NAME).nullable(),
});

export const backupItemSchema = z.object({
  id: z.string().regex(ID),
  title: z.string().max(2000),
  titleSource: z.enum(["pending", "auto", "user"]),
  titleChars: z.number().int().min(0),
  kind: recordingKindSchema,
  status: recordingStatusSchema,
  projectId: z.string().min(1).max(200).nullable(),
  createdAt: time,
  updatedAt: time,
  endedAt: time.nullable(),
  heartbeatAt: time,
  archivedAt: time.nullable(),
  audioRemovedAt: time.nullable(),
  meetingNotes: meetingNotesSchema.nullable(),
  /** The Studio Page made from this recording; it reconnects when Pages restores the same page. */
  notesPageId: z.string().min(1).max(200).nullable(),
  /** Keys of the action items the last notes run wrote (older backups have none). */
  notesItems: z.array(z.string().max(2000)).max(200).nullable().default(null),
  segments: z.array(segmentSchema),
});
export type TalkBackupItem = z.infer<typeof backupItemSchema>;

interface RecordingRow {
  id: string;
  title: string;
  title_source: TalkBackupItem["titleSource"];
  title_chars: number;
  kind: TalkBackupItem["kind"];
  status: TalkBackupItem["status"];
  project_id: string | null;
  thread_id: string | null;
  created_at: number;
  updated_at: number;
  ended_at: number | null;
  heartbeat_at: number;
  archived_at: number | null;
  meeting_notes: string | null;
  audio_removed_at: number | null;
  notes_page_id: string | null;
  notes_items: string | null;
}

interface SegmentRow {
  id: string;
  session_id: string;
  idx: number;
  started_at: number;
  duration_ms: number;
  mime_type: string;
  bytes: number;
  file: string;
  status: TalkBackupItem["segments"][number]["status"];
  text: string | null;
  cleaned_text: string | null;
  error: string | null;
  attempts: number;
  created_at: number;
}

export interface TalkBackupDeps {
  db: Database.Database;
  files: Pick<AudioFiles, "inside">;
  /** Tells Studio and open pages a recording changed. */
  changed(id: string): void;
}

const isCapturing = (status: string) => status === "recording" || status === "paused" || status === "interrupted";

/**
 * A backed-up recording as it should be stored here: never capturing, and
 * never waiting to be transcribed, so nothing is re-sent to the voice
 * service. Pieces that weren't transcribed become failed; Retry picks them up.
 */
function settled(item: TalkBackupItem): TalkBackupItem {
  const unfinished = item.status !== "done";
  return {
    ...item,
    status: "done",
    endedAt: unfinished ? item.endedAt ?? item.updatedAt : item.endedAt,
    segments: item.segments.map((segment) =>
      segment.status === "pending" ? { ...segment, status: "failed", error: NOT_TRANSCRIBED } : segment,
    ),
  };
}

async function placeFile(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.${randomUUID()}.tmp`;
  try {
    await copyFile(source, temp, constants.COPYFILE_EXCL);
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
}

export function talkBackupHandlers(deps: TalkBackupDeps): BackupHandlers {
  const { db, files } = deps;
  const recordingRow = db.prepare(`SELECT * FROM recordings WHERE id = ?`);
  const segmentRows = db.prepare(`SELECT * FROM segments WHERE recording_id = ? ORDER BY started_at, session_id, idx`);
  const localRow = db.prepare(`SELECT updated_at, status FROM recordings WHERE id = ?`);

  return {
    version: TALK_BACKUP_VERSION,

    async backup(writer: BackupWriter) {
      const counts = { recordings: 0, segments: 0, audioFiles: 0, notesPages: 0, inProgress: 0 };
      let threadLinks = 0;
      let missingAudio = 0;
      let removedAudio = 0;
      let skipped = 0;
      let vanished = 0;
      const ids = (db.prepare(`SELECT id FROM recordings ORDER BY created_at, id`).all() as { id: string }[]).map((row) => row.id);
      // One recording at a time, so memory holds one recording's transcript.
      for (const id of ids) {
        const read = db.transaction(() => ({
          row: recordingRow.get(id) as RecordingRow | undefined,
          segments: segmentRows.all(id) as SegmentRow[],
        }));
        const { row, segments } = read();
        if (!row) continue;
        let name: string;
        try {
          name = fileSafeId(row.id);
        } catch {
          skipped += 1;
          continue;
        }
        const item: TalkBackupItem = {
          id: row.id,
          title: row.title,
          titleSource: row.title_source,
          titleChars: row.title_chars,
          kind: row.kind,
          status: row.status,
          projectId: row.project_id,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          endedAt: row.ended_at,
          heartbeatAt: row.heartbeat_at,
          archivedAt: row.archived_at,
          audioRemovedAt: row.audio_removed_at,
          meetingNotes: row.meeting_notes ? (JSON.parse(row.meeting_notes) as TalkBackupItem["meetingNotes"]) : null,
          notesPageId: row.notes_page_id,
          notesItems: row.notes_items ? (JSON.parse(row.notes_items) as string[]) : null,
          segments: [],
        };
        for (const segment of segments) {
          let audio: string | null = null;
          const fileName = basename(segment.file);
          if (row.audio_removed_at === null && AUDIO_NAME.test(fileName)) {
            try {
              await writer.copy(`audio/${name}/${fileName}`, files.inside(segment.file));
              audio = fileName;
              counts.audioFiles += 1;
            } catch {
              missingAudio += 1;
            }
          } else if (row.audio_removed_at === null) {
            missingAudio += 1;
          }
          item.segments.push({
            id: segment.id,
            sessionId: segment.session_id,
            index: segment.idx,
            startedAt: segment.started_at,
            durationMs: segment.duration_ms,
            mimeType: segment.mime_type,
            bytes: segment.bytes,
            status: segment.status,
            text: segment.text,
            cleanedText: segment.cleaned_text,
            error: segment.error,
            attempts: segment.attempts,
            createdAt: segment.created_at,
            audio,
          });
        }
        // Deleted while its audio was being copied: saving it would restore a recording without audio.
        if (!recordingRow.get(id)) {
          vanished += 1;
          missingAudio -= item.segments.filter((segment) => segment.audio === null && row.audio_removed_at === null).length;
          counts.audioFiles -= item.segments.filter((segment) => segment.audio !== null).length;
          continue;
        }
        await writer.json(`items/${name}.json`, item);
        counts.recordings += 1;
        counts.segments += item.segments.length;
        if (item.notesPageId) counts.notesPages += 1;
        if (item.status !== "done" || item.segments.some((segment) => segment.status === "pending")) counts.inProgress += 1;
        if (row.thread_id) threadLinks += 1;
        if (row.audio_removed_at !== null) removedAudio += 1;
      }
      const notes: string[] = [];
      if (counts.inProgress) {
        notes.push(`${counts.inProgress} recording(s) were still recording or transcribing. What was stored is saved; they restore as finished, with untranscribed pieces marked failed so they can be retried.`);
      }
      if (threadLinks) notes.push(`Not saved: the BB thread ${threadLinks} recording(s) were started from. They restore without the thread link.`);
      if (removedAudio) notes.push(`${removedAudio} dictation(s) had their audio removed already; only their transcripts are saved.`);
      if (missingAudio) notes.push(`${missingAudio} audio file(s) were missing on disk and weren't saved; their transcripts are.`);
      if (vanished) notes.push(`${vanished} recording(s) were deleted while the backup ran and were left out.`);
      if (skipped) notes.push(`${skipped} recording(s) with an unusable id were skipped.`);
      if (counts.notesPages) notes.push("Notes pages are linked by page id; restore Studio Pages too to reconnect them.");
      return { counts, notes };
    },

    async restore(reader: BackupReader, { dryRun, projects, tally }) {
      interface Planned {
        item: TalkBackupItem;
        decision: "create" | "update";
        unmapped: boolean;
        /** Local audio paths this restore wrote, to undo for a failed create. */
        placed: string[];
      }
      const planned: Planned[] = [];
      const seen = new Set<string>();
      let inProgress = 0;

      for (const fileName of await reader.list("items")) {
        const fallback = { id: fileName.replace(/\.json$/, ""), title: fileName };
        if (!fileName.endsWith(".json")) continue;
        let item: TalkBackupItem;
        try {
          const parsed = backupItemSchema.safeParse(await reader.json(`items/${fileName}`));
          if (!parsed.success) throw new Error(`Not a valid recording: ${parsed.error.issues[0]?.message ?? "invalid"} at ${parsed.error.issues[0]?.path.join(".") ?? ""}`);
          item = parsed.data;
          if (!fileName.endsWith(".json") || !fileSafeIdMatches(item.id, fileName.slice(0, -5))) throw new Error("The file name doesn't match the recording id.");
          if (seen.has(item.id)) throw new Error("This recording appears twice in the backup.");
          if (new Set(item.segments.map((segment) => segment.id)).size !== item.segments.length) throw new Error("A segment appears twice.");
        } catch (error) {
          tally.record("failed", fallback, error instanceof Error ? error.message : String(error));
          continue;
        }
        seen.add(item.id);
        const ref = { id: item.id, title: item.title };
        const local = localRow.get(item.id) as { updated_at: number; status: string } | undefined;
        const decision = restoreDecision(local?.updated_at ?? null, item.updatedAt);
        if (decision === "unchanged" || decision === "keep") {
          tally.decided(decision, ref);
          continue;
        }
        if (local && (isCapturing(local.status) || local.status === "finishing")) {
          tally.record("kept", ref, dryRun ? "It is being recorded or transcribed here; it would be kept." : "It is being recorded or transcribed here; it was kept.");
          continue;
        }
        // Check every audio file before touching anything.
        const placed: string[] = [];
        try {
          const name = fileSafeId(item.id);
          const audio = item.segments.flatMap((segment) => (segment.audio ? [segment.audio] : []));
          for (const file of audio) {
            if (!(await reader.exists(`audio/${name}/${file}`))) throw new Error(`Its audio file ${file} is missing from the backup.`);
          }
          if (!dryRun) {
            for (const file of audio) {
              const target = files.inside(`${item.id}/${file}`);
              await placeFile(reader.path(`audio/${name}/${file}`), target);
              placed.push(target);
            }
          }
        } catch (error) {
          if (decision === "create") await Promise.all(placed.map((target) => rm(target, { force: true })));
          tally.record("failed", ref, error instanceof Error ? error.message : String(error));
          continue;
        }
        const mapped = mapProject(projects, item.projectId);
        if (item.status !== "done" || item.segments.some((segment) => segment.status === "pending")) inProgress += 1;
        planned.push({ item: { ...settled(item), projectId: mapped.projectId }, decision, unmapped: mapped.unmapped, placed });
      }

      if (!dryRun && planned.length) {
        const deleteSegments = db.prepare(`DELETE FROM segments WHERE recording_id = ?`);
        const upsert = db.prepare(
          `INSERT INTO recordings
             (id, title, title_source, title_chars, kind, status, project_id, thread_id, created_at, updated_at,
              ended_at, heartbeat_at, archived_at, meeting_notes, audio_removed_at, notes_page_id, notes_items)
           VALUES (@id, @title, @titleSource, @titleChars, @kind, @status, @projectId, NULL, @createdAt, @updatedAt,
              @endedAt, @heartbeatAt, @archivedAt, @meetingNotes, @audioRemovedAt, @notesPageId, @notesItems)
           ON CONFLICT(id) DO UPDATE SET
             title = excluded.title, title_source = excluded.title_source, title_chars = excluded.title_chars,
             kind = excluded.kind, status = excluded.status, project_id = excluded.project_id, thread_id = NULL,
             created_at = excluded.created_at, updated_at = excluded.updated_at, ended_at = excluded.ended_at,
             heartbeat_at = excluded.heartbeat_at, archived_at = excluded.archived_at,
             meeting_notes = excluded.meeting_notes, audio_removed_at = excluded.audio_removed_at,
             notes_page_id = excluded.notes_page_id, notes_items = excluded.notes_items`,
        );
        const insertSegment = db.prepare(
          `INSERT INTO segments
             (recording_id, id, session_id, idx, started_at, duration_ms, mime_type, bytes, file, status,
              text, error, attempts, next_attempt_at, created_at, cleaned_text)
           VALUES (@recordingId, @id, @sessionId, @index, @startedAt, @durationMs, @mimeType, @bytes, @file, @status,
              @text, @error, @attempts, 0, @createdAt, @cleanedText)`,
        );
        const write = db.transaction((items: Planned[]) => {
          for (const { item } of items) {
            upsert.run({ ...item, meetingNotes: item.meetingNotes ? JSON.stringify(item.meetingNotes) : null, notesItems: item.notesItems ? JSON.stringify(item.notesItems) : null });
            deleteSegments.run(item.id);
            for (const segment of item.segments) {
              insertSegment.run({
                ...segment,
                recordingId: item.id,
                // A segment whose audio wasn't saved keeps a path; the player reports it missing.
                file: `${item.id}/${segment.audio ?? `${segment.id}.${extensionFor(segment.mimeType)}`}`,
              });
            }
          }
        });
        try {
          write(planned);
        } catch (error) {
          for (const entry of planned) {
            if (entry.decision === "create") await Promise.all(entry.placed.map((target) => rm(target, { force: true })));
          }
          throw error;
        }
        // An updated recording's audio that the backup no longer lists is stale.
        for (const { item, decision } of planned) {
          if (decision !== "update") continue;
          const keep = new Set(item.segments.flatMap((segment) => (segment.audio ? [segment.audio] : [])));
          const dir = files.inside(item.id);
          const present = await readdir(dir).catch(() => [] as string[]);
          await Promise.all(present.filter((file) => !keep.has(file) && !file.endsWith(".tmp")).map((file) => rm(`${dir}/${file}`, { force: true })));
        }
        for (const { item } of planned) deps.changed(item.id);
      }

      for (const { item, decision, unmapped } of planned) {
        const ref = { id: item.id, title: item.title };
        tally.decided(decision, ref);
        if (unmapped) tally.unmapped(ref);
      }
      if (inProgress) {
        tally.note(`${inProgress} recording(s) were still recording or transcribing when backed up; they ${dryRun ? "would restore" : "restored"} as finished, with untranscribed pieces marked failed so they can be retried.`);
      }
    },
  };
}
