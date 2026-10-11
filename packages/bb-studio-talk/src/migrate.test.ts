import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { AUDIO_CHUNK_BYTES, DISK_RESERVE_BYTES, type ImportRecording } from "@bb-studio/kit/talk-contract";
// Studio's real store and import, so the copy is checked against what Studio does with it.
import { TALK_MIGRATIONS, TalkStore } from "../../bb-studio/src/talk/server/store";
import { AudioFiles } from "../../bb-studio/src/talk/server/audio-files";
import { AudioImport, importRecording } from "../../bb-studio/src/talk/server/import";
import { MIGRATED, MIGRATIONS, SETTINGS_MIGRATED, batches, migrate, type Markers, type StudioImport } from "./migrate";

const tempDir = (name: string) => mkdtemp(join(tmpdir(), `talk-${name}-`));

/** The old plugin's database and audio folder, with a recording or two. */
async function oldPlugin() {
  const db = new Database(":memory:");
  for (const statement of MIGRATIONS) db.exec(statement);
  const store = new TalkStore(db);
  const root = join(await tempDir("old"), "audio");
  const add = async (id: string, pieces: Buffer[], options: { kind?: "recording" | "dictation"; transcribe?: boolean } = {}) => {
    store.create({ id, kind: options.kind ?? "recording", projectId: "proj_1", threadId: "thr_1" });
    for (const [index, bytes] of pieces.entries()) {
      const file = `${id}/s1-${index}.webm`;
      await mkdir(join(root, id), { recursive: true });
      await writeFile(join(root, file), bytes);
      store.addSegment({ recordingId: id, sessionId: "s1", index, startedAt: index, durationMs: 1000, mimeType: "audio/webm", bytes: bytes.length, file });
      if (options.transcribe !== false) store.markTranscribed(id, `s1-${index}`, `Piece ${index}`);
    }
    return id;
  };
  return { db, store, root, add };
}

/** Studio's side: its own database and audio folder, behind the bridge methods. */
async function studio(options: { free?: number | null; failAfterPieces?: number } = {}) {
  const db = new Database(":memory:");
  for (const statement of TALK_MIGRATIONS) db.exec(statement);
  const files = new AudioFiles(await tempDir("studio"));
  const audio = new AudioImport(files, async () => (options.free === undefined ? 10 * DISK_RESERVE_BYTES : options.free));
  const calls = { pieces: 0, rows: 0, settings: [] as unknown[] };
  let failAfter = options.failAfterPieces ?? Infinity;
  const api: StudioImport = {
    async missingAudio(wanted) {
      const missing = [];
      for (const each of wanted) {
        const have = await audio.have(each.recordingId, each.file, each.bytes);
        if (!have.complete) missing.push({ recordingId: each.recordingId, file: each.file, offset: have.offset });
      }
      return { missing, freeBytes: await audio.free() };
    },
    async importAudio(input) {
      if (failAfter-- <= 0) throw new Error("Studio isn't running");
      calls.pieces++;
      return audio.write(input);
    },
    async importRows(recordings) {
      calls.rows++;
      const result = { imported: [] as string[], existing: [] as string[], skipped: [] as { id: string; reason: string }[] };
      for (const item of recordings) {
        const outcome = await importRecording(db, audio, item);
        if (outcome.outcome === "skipped") result.skipped.push({ id: item.id, reason: outcome.reason });
        else result[outcome.outcome].push(item.id);
      }
      return result;
    },
    async importSettings(input) {
      calls.settings.push(input);
      return { applied: Object.keys(input.settings) };
    },
  };
  const unfail = () => { failAfter = Infinity; };
  return { db, store: new TalkStore(db), files, api, calls, unfail };
}

function markers(): Markers & { keys(): string[] } {
  const map = new Map<string, unknown>();
  return { get: async (key) => map.get(key), set: async (key, value) => void map.set(key, value), keys: () => [...map.keys()] };
}

const options = (root: string) => ({ audioRoot: root, settings: async () => ({ settings: { segmentSeconds: 40 }, models: {} }) });

describe("copying Talk into Studio", () => {
  it("copies the audio byte for byte, then the rows, then the settings, and a rerun sends nothing", async () => {
    const old = await oldPlugin();
    const big = Buffer.alloc(AUDIO_CHUNK_BYTES * 2 + 123, 7);
    await old.add("rec_aaaaaaaa", [Buffer.from("first piece"), big]);
    const target = await studio();
    const kv = markers();
    expect(await migrate(old.db, target.api, kv, options(old.root))).toEqual({ complete: true, total: 1, copied: 1, skipped: [] });
    // The large file went in three pieces, the small one in one.
    expect(target.calls.pieces).toBe(4);
    expect((await readFile(target.files.inside("rec_aaaaaaaa/s1-1.webm"))).equals(big)).toBe(true);
    expect(await readFile(target.files.inside("rec_aaaaaaaa/s1-0.webm"))).toEqual(Buffer.from("first piece"));
    expect(target.store.recording("rec_aaaaaaaa")).toMatchObject({ threadId: "thr_1", projectId: "proj_1", segmentCount: 2, wordCount: 4 });
    expect(target.calls.settings).toEqual([{ settings: { segmentSeconds: 40 }, models: {} }]);
    expect(kv.keys().sort()).toEqual([SETTINGS_MIGRATED, `${MIGRATED}rec_aaaaaaaa`].sort());
    // The originals stay where they were.
    expect((await readFile(join(old.root, "rec_aaaaaaaa/s1-1.webm"))).equals(big)).toBe(true);
    const again = await migrate(old.db, target.api, kv, options(old.root));
    expect(again).toMatchObject({ complete: true, copied: 1 });
    expect(target.calls).toMatchObject({ pieces: 4, rows: 1 });
    expect(target.calls.settings).toHaveLength(1);
  });

  it("resumes a file part way through after Studio went away", async () => {
    const old = await oldPlugin();
    const big = Buffer.alloc(AUDIO_CHUNK_BYTES * 3, 1);
    await old.add("rec_aaaaaaaa", [big]);
    const target = await studio({ failAfterPieces: 2 });
    const kv = markers();
    await expect(migrate(old.db, target.api, kv, options(old.root))).rejects.toThrow("isn't running");
    expect(target.store.recording("rec_aaaaaaaa")).toBeNull();
    target.unfail();
    expect(await migrate(old.db, target.api, kv, options(old.root))).toMatchObject({ complete: true, copied: 1 });
    // Two pieces before the failure, one after: nothing was sent twice.
    expect(target.calls.pieces).toBe(3);
    expect((await readFile(target.files.inside("rec_aaaaaaaa/s1-0.webm"))).equals(big)).toBe(true);
  });

  it("stops before copying anything when Studio's disk can't hold the audio", async () => {
    const old = await oldPlugin();
    await old.add("rec_aaaaaaaa", [Buffer.alloc(1000)]);
    const target = await studio({ free: DISK_RESERVE_BYTES + 10 });
    await expect(migrate(old.db, target.api, markers(), options(old.root))).rejects.toThrow(/Not enough disk space/);
    expect(target.calls.pieces).toBe(0);
  });

  it("copies a dictation whose audio expired, and one with untranscribed pieces left for Studio to finish", async () => {
    const old = await oldPlugin();
    await old.add("rec_aaaaaaaa", [Buffer.from("gone")], { kind: "dictation" });
    old.store.markAudioRemoved("rec_aaaaaaaa");
    await old.add("rec_bbbbbbbb", [Buffer.from("pending")], { transcribe: false });
    old.store.setStatus("rec_bbbbbbbb", "finishing");
    const target = await studio();
    expect(await migrate(old.db, target.api, markers(), options(old.root))).toMatchObject({ complete: true, copied: 2 });
    expect(target.store.recording("rec_aaaaaaaa")).toMatchObject({ audioRemoved: true, kind: "dictation" });
    expect(target.store.recording("rec_bbbbbbbb")).toMatchObject({ status: "finishing", pendingCount: 1 });
    expect(target.store.due(10).map((each) => each.id)).toEqual(["s1-0"]);
  });

  it("lists a malformed row with the reason and keeps it here", async () => {
    const old = await oldPlugin();
    await old.add("rec_aaaaaaaa", [Buffer.from("ok")]);
    old.db.prepare("UPDATE recordings SET kind = 'bogus' WHERE id = 'rec_aaaaaaaa'").run();
    const target = await studio();
    const result = await migrate(old.db, target.api, markers(), options(old.root));
    expect(result).toMatchObject({ complete: true, total: 1, copied: 0, skipped: [{ id: "rec_aaaaaaaa", reason: expect.stringContaining("kind") }] });
    expect(old.store.recording("rec_aaaaaaaa")).not.toBeNull();
  });

  it("batches by count and transcript size", () => {
    const item = (id: string, chars: number) => ({ id, segments: [{ text: "x".repeat(chars), cleanedText: null }] }) as unknown as ImportRecording;
    expect(batches(Array.from({ length: 150 }, (_, index) => item(`r${index}`, 1))).map((batch) => batch.length)).toEqual([100, 50]);
    expect(batches([item("a", 5_000_000), item("b", 5_000_000), item("c", 1)]).map((batch) => batch.map((each) => each.id))).toEqual([["a"], ["b", "c"]]);
  });
});
