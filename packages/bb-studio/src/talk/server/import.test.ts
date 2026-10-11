import { createHash } from "node:crypto";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ImportRecording } from "../shared/contract";
import { talkHost } from "../test/host";
import { AudioFiles } from "./audio-files";
import { AudioImport, DISK_RESERVE_BYTES } from "./import";

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function audioImport(free: number | null = 10 * DISK_RESERVE_BYTES) {
  const files = new AudioFiles(await mkdtemp(join(tmpdir(), "talk-import-")));
  return { files, audio: new AudioImport(files, async () => free) };
}

function recording(id: string, segments: { id: string; bytes: number; audio?: boolean }[] = []): ImportRecording {
  return {
    id, title: "Standup", titleSource: "user", titleChars: 0, kind: "recording", status: "done", projectId: null, threadId: "thr_1",
    createdAt: 1, updatedAt: 2, endedAt: 2, heartbeatAt: 2, archivedAt: null, audioRemovedAt: null,
    meetingNotes: JSON.stringify({ summary: "We shipped." }), notesPageId: null, notesItems: null,
    segments: segments.map((segment, index) => ({
      id: segment.id, sessionId: "s1", index, startedAt: index, durationMs: 1000, mimeType: "audio/webm", bytes: segment.bytes,
      file: `${id}/${segment.id}.webm`, audio: segment.audio ?? true, status: "done", text: `Piece ${index}`, cleanedText: null, error: null,
      attempts: 1, nextAttemptAt: 0, createdAt: index,
    })),
  };
}

describe("copying audio into Studio", () => {
  it("writes a file in pieces, resumes where it stopped, and moves it into place only when whole", async () => {
    const { files, audio } = await audioImport();
    const bytes = Buffer.from("0123456789");
    const base = { recordingId: "rec_aaaaaaaa", file: "rec_aaaaaaaa/s1-0.webm", bytes: bytes.length, sha256: sha(bytes) };
    expect(await audio.have(base.recordingId, base.file, base.bytes)).toEqual({ complete: false, offset: 0 });
    expect(await audio.write({ ...base, offset: 0, data: bytes.subarray(0, 4).toString("base64") })).toEqual({ offset: 4, done: false });
    // The bridge restarted: Studio says where to go on.
    expect(await audio.have(base.recordingId, base.file, base.bytes)).toEqual({ complete: false, offset: 4 });
    // A piece for the wrong offset changes nothing.
    expect(await audio.write({ ...base, offset: 0, data: bytes.subarray(0, 4).toString("base64") })).toEqual({ offset: 4, done: false });
    expect(await stat(files.inside(base.file)).catch(() => null)).toBeNull();
    expect(await audio.write({ ...base, offset: 4, data: bytes.subarray(4).toString("base64") })).toEqual({ offset: 10, done: true });
    expect(await readFile(files.inside(base.file))).toEqual(bytes);
    expect(await audio.have(base.recordingId, base.file, base.bytes)).toEqual({ complete: true, offset: 10 });
    // Again: already in place, nothing written.
    expect(await audio.write({ ...base, offset: 0, data: bytes.toString("base64") })).toEqual({ offset: 10, done: true });
  });

  it("throws away a file that arrives with the wrong contents, to copy it again", async () => {
    const { files, audio } = await audioImport();
    const base = { recordingId: "rec_aaaaaaaa", file: "rec_aaaaaaaa/s1-0.webm", bytes: 3, sha256: sha(Buffer.from("abc")) };
    await expect(audio.write({ ...base, offset: 0, data: Buffer.from("abd").toString("base64") })).rejects.toThrow(/intact/);
    expect(await stat(files.inside(base.file)).catch(() => null)).toBeNull();
    expect(await audio.have(base.recordingId, base.file, base.bytes)).toEqual({ complete: false, offset: 0 });
  });

  it("refuses to start a file the disk has no room for, keeping a reserve free", async () => {
    const { audio } = await audioImport(DISK_RESERVE_BYTES + 5);
    const bytes = Buffer.from("0123456789");
    await expect(audio.write({ recordingId: "rec_aaaaaaaa", file: "rec_aaaaaaaa/s1-0.webm", bytes: 10, sha256: sha(bytes), offset: 0, data: bytes.toString("base64") }))
      .rejects.toThrow(/Not enough disk space/);
  });

  it("keeps audio inside its recording's directory", async () => {
    const { audio } = await audioImport();
    await expect(audio.have("rec_aaaaaaaa", "rec_bbbbbbbb/s1-0.webm", 1)).rejects.toThrow(/isn't in recording/);
  });
});

describe("the bridge's import methods", () => {
  let dispose: (() => Promise<void>) | undefined;
  afterEach(async () => { await dispose?.(); dispose = undefined; });

  it("imports a recording once its audio is in place, keeping ids, text and thread, and leaves it alone after", async () => {
    const host = await talkHost();
    dispose = () => host.harness.lifecycle.dispose();
    const bytes = Buffer.from("opus bytes");
    const row = recording("rec_aaaaaaaa", [{ id: "s1-0", bytes: bytes.length }, { id: "s1-1", bytes: 7, audio: false }]);
    // Audio first: a row whose copied audio isn't there yet is refused, to retry.
    await expect(host.call("recordings.importRows", { recordings: [row] })).rejects.toThrow(/isn't in Studio yet/);
    const { missing, freeBytes } = await host.call("recordings.missingAudio", { files: [{ recordingId: row.id, file: row.segments[0]!.file, bytes: bytes.length }] });
    expect(missing).toEqual([{ recordingId: row.id, file: row.segments[0]!.file, offset: 0 }]);
    expect(typeof freeBytes === "number" || freeBytes === null).toBe(true);
    await host.call("recordings.importAudio", { recordingId: row.id, file: row.segments[0]!.file, bytes: bytes.length, sha256: sha(bytes), offset: 0, data: bytes.toString("base64") });
    expect(await host.call("recordings.importRows", { recordings: [row] })).toEqual({ imported: [row.id], existing: [], skipped: [] });
    const { recording: copied, segments } = await host.call("recordings.recording_get", { id: row.id });
    expect(copied).toMatchObject({ id: row.id, title: "Standup", threadId: "thr_1", wordCount: 4, meetingNotes: { summary: "We shipped." } });
    expect(segments.map((segment: { text: string }) => segment.text)).toEqual(["Piece 0", "Piece 1"]);
    const audio = await host.harness.behavior.fetchHttp("GET", `/recordings/audio?recording=${row.id}&segment=s1-0`);
    expect(Buffer.from(await audio.arrayBuffer())).toEqual(bytes);
    expect(await host.call("recordings.importRows", { recordings: [{ ...row, title: "Changed" }] })).toEqual({ imported: [], existing: [row.id], skipped: [] });
    expect((await host.call("recordings.recording_get", { id: row.id })).recording.title).toBe("Standup");
  });

  it("takes the old settings and models once, keeping what the user set in Studio", async () => {
    const host = await talkHost();
    dispose = () => host.harness.lifecycle.dispose();
    const model = { providerId: "codex", model: "gpt-5", reasoningLevel: "low" as const };
    await host.call("recordings.models.set", { purpose: "title", selection: { ...model, model: "mine" } });
    const first = await host.call("recordings.importSettings", {
      settings: { segmentSeconds: 40, replaceBuiltInDictation: false, autoTitle: true },
      models: { cleanup: model, title: model, summary: null },
    });
    expect(first.applied.sort()).toEqual(["model:cleanup", "replaceBuiltInDictation", "segmentSeconds"]);
    const models = await host.call("recordings.models.get", null);
    expect(models).toMatchObject({ cleanup: model, title: { model: "mine" }, summary: null });
    expect(await host.call("recordings.importSettings", { settings: { segmentSeconds: 50 }, models: {} })).toEqual({ applied: [] });
  });
});
