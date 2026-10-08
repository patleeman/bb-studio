import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { RestoreTally } from "@bb-studio/kit/backup";
import { BackupReader, BackupWriter } from "@bb-studio/kit/server";
import { afterEach, describe, expect, it } from "vitest";
import { AudioFiles } from "./audio-files";
import { talkBackupHandlers } from "./backup";
import { MIGRATIONS, TalkStore } from "./store";

const REC = "rec_aaaaaaaaaaaaaaaa";
const LIVE = "rec_bbbbbbbbbbbbbbbb";
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function temp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "talk-backup-"));
  dirs.push(dir);
  return dir;
}

async function talk(start = 1_000_000) {
  const dir = await temp();
  const db = new Database(join(dir, "data.db"));
  db.pragma("foreign_keys = ON");
  for (const statement of MIGRATIONS) db.exec(statement);
  let now = start;
  const store = new TalkStore(db, () => now);
  const files = new AudioFiles(dir);
  const changed: string[] = [];
  const handlers = talkBackupHandlers({ db, files, changed: (id) => void changed.push(id) });
  const clock = { set: (at: number) => (now = at) };
  async function segment(recordingId: string, session: string, index: number, bytes: string) {
    const id = `${session}-${index}`;
    const file = await files.write(recordingId, id, "audio/webm", Buffer.from(bytes));
    store.addSegment({ recordingId, sessionId: session, index, startedAt: now, durationMs: 1000, mimeType: "audio/webm", bytes: bytes.length, file });
    return id;
  }
  return { dir, db, store, files, changed, handlers, clock, segment };
}

async function backupOf(source: Awaited<ReturnType<typeof talk>>) {
  const dir = join(await temp(), "talk");
  await mkdir(dir);
  const writer = new BackupWriter(dir);
  const result = await source.handlers.backup(writer);
  return { dir, result, reader: new BackupReader(dir) };
}

async function restore(target: Awaited<ReturnType<typeof talk>>, reader: BackupReader, options: { dryRun?: boolean; projects?: Record<string, string | null> } = {}) {
  const tally = new RestoreTally(options.dryRun ?? false);
  await target.handlers.restore(reader, { dryRun: options.dryRun ?? false, version: 1, projects: options.projects ?? { proj_a: "proj_a" }, tally });
  return tally.result();
}

/** A finished, transcribed recording with notes and a notes page, and one still being captured. */
async function seeded() {
  const source = await talk();
  source.store.create({ id: REC, kind: "recording", projectId: "proj_a", threadId: "thr_x" });
  const first = await source.segment(REC, "s1", 0, "audio-one");
  const second = await source.segment(REC, "s1", 1, "audio-two");
  source.store.markTranscribed(REC, first, "Hello team");
  source.store.markTranscribed(REC, second, "Ship it");
  source.store.setStatus(REC, "finishing");
  source.store.saveMeetingNotes(REC, { summary: "We shipped." });
  source.store.setNotesPage(REC, "page_notes1");
  source.store.create({ id: LIVE, kind: "dictation", projectId: null, threadId: null });
  const done = await source.segment(LIVE, "s2", 0, "live-one");
  await source.segment(LIVE, "s2", 1, "live-two");
  source.store.markTranscribed(LIVE, done, "Partial words");
  return source;
}

describe("Talk backup and restore", () => {
  it("round-trips recordings, transcripts, audio and notes links into an empty store", async () => {
    const source = await seeded();
    const { result, reader, dir } = await backupOf(source);
    expect(result.counts).toEqual({ recordings: 2, segments: 4, audioFiles: 4, notesPages: 1, inProgress: 1 });
    expect(result.notes?.join(" ")).toMatch(/thread/);
    expect((await readdir(join(dir, "items"))).sort()).toEqual([`${REC}.json`, `${LIVE}.json`].sort());

    const target = await talk(5_000_000);
    const report = await restore(target, reader);
    expect(report).toMatchObject({ created: 2, updated: 0, failed: 0, unmapped: 0 });
    expect(target.changed.sort()).toEqual([REC, LIVE].sort());

    const original = source.store.recording(REC)!;
    const restored = target.store.recording(REC)!;
    expect(restored).toMatchObject({
      title: original.title,
      status: "done",
      projectId: "proj_a",
      threadId: null,
      updatedAt: original.updatedAt,
      wordCount: 4,
      meetingNotes: { summary: "We shipped." },
      notesPageId: "page_notes1",
    });
    expect(target.store.transcript(REC)).toBe("Hello team Ship it");
    const entry = target.store.segmentFile(REC, "s1-1")!;
    expect((await target.files.read(entry.file)).toString()).toBe("audio-two");

    // The capture in progress comes back stopped, and nothing waits to be transcribed.
    expect(target.store.recording(LIVE)).toMatchObject({ status: "done", pendingCount: 0, failedCount: 1 });
    expect(target.store.due(10)).toEqual([]);
    expect(target.store.transcript(LIVE)).toBe("Partial words");
    expect(report.notes.join(" ")).toMatch(/still recording/);
  });

  it("leaves out a recording deleted while its audio was being copied", async () => {
    const source = await seeded();
    const dir = join(await temp(), "talk");
    await mkdir(dir);
    class Deleting extends BackupWriter {
      override async copy(...args: Parameters<BackupWriter["copy"]>) {
        if (args[0].includes(`/${REC}/`)) source.store.delete(REC);
        return super.copy(...args);
      }
    }
    const result = await source.handlers.backup(new Deleting(dir));
    expect(result.counts.recordings).toBe(1);
    expect(result.counts.audioFiles).toBe(2);
    expect(await readdir(join(dir, "items"))).toEqual([`${LIVE}.json`]);
    expect(result.notes?.join(" ")).toMatch(/deleted while the backup ran/);
  });

  it("changes nothing when the same backup is restored again", async () => {
    const source = await seeded();
    const { reader } = await backupOf(source);
    const target = await talk();
    await restore(target, reader);
    target.changed.length = 0;
    const report = await restore(target, reader);
    expect(report).toMatchObject({ created: 0, updated: 0, unchanged: 2, kept: 0, failed: 0 });
    expect(target.changed).toEqual([]);
  });

  it("keeps a newer copy here and updates an older one", async () => {
    const source = await seeded();
    const { reader } = await backupOf(source);
    const target = await talk();
    await restore(target, reader);

    // REC edited here after the backup: kept. LIVE older here than the backup: updated.
    target.clock.set(9_000_000);
    target.store.rename(REC, "Renamed here", "user");
    target.db.prepare(`UPDATE recordings SET updated_at = 1, title = 'Old' WHERE id = ?`).run(LIVE);
    await writeFile(target.files.inside(`${LIVE}/stale.webm`), "stale");

    const report = await restore(target, reader);
    expect(report).toMatchObject({ kept: 1, updated: 1, created: 0 });
    expect(target.store.recording(REC)!.title).toBe("Renamed here");
    expect(target.store.recording(LIVE)!.title).not.toBe("Old");
    expect(await readdir(target.files.inside(LIVE))).not.toContain("stale.webm");
  });

  it("writes nothing on a dry run but reports the same counts", async () => {
    const source = await seeded();
    const { reader } = await backupOf(source);
    const target = await talk();
    const dry = await restore(target, reader, { dryRun: true, projects: {} });
    expect(dry).toMatchObject({ created: 2, unmapped: 1 });
    expect(target.store.list({ includeArchived: true })).toEqual([]);
    expect(await readdir(target.dir)).toEqual(["data.db"]);
    expect(target.changed).toEqual([]);
    const real = await restore(target, reader, { projects: {} });
    expect({ ...real, problems: [], notes: [] }).toEqual({ ...dry, problems: [], notes: [] });
  });

  it("fails a malformed item without stopping the rest", async () => {
    const source = await seeded();
    const { reader, dir } = await backupOf(source);
    const path = join(dir, "items", `${LIVE}.json`);
    const item = JSON.parse(await readFile(path, "utf8"));
    item.segments[0].audio = "../../escape.webm";
    await writeFile(path, JSON.stringify(item));
    await writeFile(join(dir, "items", "rec_broken.json"), "{not json");

    const target = await talk();
    const report = await restore(target, reader);
    expect(report).toMatchObject({ created: 1, failed: 2 });
    expect(report.problems.map((problem) => problem.id).sort()).toEqual([LIVE, "rec_broken"].sort());
    expect(target.store.recording(LIVE)).toBeNull();
  });

  it("fails an item whose audio is missing from the backup", async () => {
    const source = await seeded();
    const { reader, dir } = await backupOf(source);
    await rm(join(dir, "audio", REC, "s1-0.webm"));
    const target = await talk();
    const report = await restore(target, reader);
    expect(report).toMatchObject({ created: 1, failed: 1 });
    expect(target.store.recording(REC)).toBeNull();
  });

  it("restores a recording whose project isn't here as a global one", async () => {
    const source = await seeded();
    const { reader } = await backupOf(source);
    const target = await talk();
    const report = await restore(target, reader, { projects: { proj_a: null } });
    expect(report).toMatchObject({ created: 2, unmapped: 1 });
    expect(target.store.recording(REC)!.projectId).toBeNull();
  });
});
