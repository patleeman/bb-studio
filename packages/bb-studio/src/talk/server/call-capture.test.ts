import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CallLive, CallStt } from "../shared/contract";
import { memoryStore } from "../test/db";
import { installStub, piece, waitFor, type StubPlan } from "../test/tap-fixture";
import { AudioFiles } from "./audio-files";
import { CallCaptures, LOCAL_UNFINISHED } from "./call-capture";
import { echoSegments } from "./call-echo";
import { TapHelper } from "./tap-helper";

function setup(plan: StubPlan, options: { stt?: CallStt; consented?: boolean } = {}) {
  const stub = installStub(plan);
  const { store } = memoryStore();
  const root = mkdtempSync(join(tmpdir(), "talk-call-"));
  const files = new AudioFiles(root);
  const kv = new Map<string, unknown>(options.consented === false ? [] : [["talk.callConsent", { at: 1 }]]);
  const published: (CallLive | null)[] = [];
  const ended: string[] = [];
  let wakes = 0;
  const calls = new CallCaptures({
    store,
    files,
    helper: new TapHelper({ path: stub.path, fake: stub.fake }),
    incomingRoot: join(root, "incoming"),
    modelDir: join(root, "whisperkit"),
    settings: () => ({ stt: options.stt ?? "whisperkit", localModel: "tiny" }),
    kv: { get: async <T,>(key: string) => kv.get(key) as T | undefined, set: async (key, value) => void kv.set(key, value) },
    changed: () => {},
    publish: (live) => published.push(live),
    wake: () => void wakes++,
    onText: (id) => {
      // As Talk's server does: drop "me" pieces that echo "them".
      store.markEcho(id, echoSegments(store.segments(id)));
    },
    onEnded: (id) => ended.push(id),
    log: () => {},
  });
  return { stub, store, files, root, calls, published, ended, kv, wakes: () => wakes };
}

const started = { at: 0, event: "started", sources: ["them", "me"] };

describe("call capture", () => {
  it("stores both sides by when they were spoken, with labels, and finishes on Stop", async () => {
    const { calls, store, root, ended, stub } = setup({
      steps: [
        started,
        // The helper's streams arrive out of time order: "me" closes its piece first.
        ...piece("me", 0, 4_000, 9_000, "Sounds good to me.", 10),
        ...piece("them", 0, 0, 8_000, "Can we move the review to Thursday?", 30),
        ...piece("them", 1, 9_500, 15_000, "Great, I'll send the invite.", 50),
      ],
    });
    const recording = await calls.start({ target: { bundleIds: ["us.zoom.xos"] }, app: "zoom.us", mic: true });
    expect(recording.call).toEqual({ app: "zoom.us", bundleIds: ["us.zoom.xos"], mic: true, stt: "whisperkit" });
    expect(recording.title).toMatch(/^Call · zoom\.us · /);
    await waitFor(() => store.segments(recording.id).filter((segment) => segment.status === "done").length === 3);
    expect(calls.live()?.phase).toBe("recording");
    const done = await calls.stop(recording.id);
    expect(done.status).toBe("done");
    expect(ended).toEqual([recording.id]);
    expect(calls.live()).toBeNull();

    const segments = store.segments(recording.id);
    expect(segments.map((segment) => [segment.id, segment.speaker])).toEqual([["them-0", "them"], ["me-0", "me"], ["them-1", "them"]]);
    expect(segments.map((segment) => segment.offsetMs)).toEqual([0, 4_000, 9_500]);
    expect(store.transcript(recording.id)).toBe(
      "Them: Can we move the review to Thursday?\n\nMe: Sounds good to me.\n\nThem: Great, I'll send the invite.",
    );
    // The call's length is the time it ran, not the two sides added up.
    expect(done.durationMs).toBe(15_000);
    // Studio owns the pieces now: they're in Talk's audio store, and the helper's folder is gone.
    expect(readdirSync(join(root, "audio", recording.id)).sort()).toEqual(["me-0.wav", "them-0.wav", "them-1.wav"]);
    expect(existsSync(join(root, "incoming", recording.id))).toBe(false);
    expect(JSON.parse(stub.log()[0]!.argv![2]!)).toMatchObject({ mic: true, segmentTargetMs: 8000, segmentMaxMs: 15000, stt: { kind: "whisperkit", model: "tiny", modelDir: join(root, "whisperkit") } });
  });

  it("drops a 'me' piece that echoes the other side", async () => {
    const { calls, store } = setup({
      steps: [
        started,
        ...piece("them", 0, 0, 7_000, "We should launch on the twelfth if the review passes.", 10),
        ...piece("me", 0, 300, 7_200, "we should launch on the twelfth if the review", 20),
        ...piece("me", 1, 7_500, 10_000, "Yes, the twelfth works.", 30),
      ],
    });
    const { id } = await calls.start({ target: { all: true }, app: "ignored", mic: true });
    await waitFor(() => store.segments(id).filter((segment) => segment.status === "done").length === 3);
    await calls.stop(id);
    expect(store.segments(id).find((segment) => segment.id === "me-0")?.echo).toBe(true);
    expect(store.transcript(id)).toBe("Them: We should launch on the twelfth if the review passes.\n\nMe: Yes, the twelfth works.");
    expect(store.recording(id)?.call?.app).toBe("All system audio");
  });

  it("shows partials live and replaces them with the final; a final before its piece still lands", async () => {
    const { calls, store, published } = setup({
      steps: [
        started,
        { at: 10, event: "partial", source: "them", index: 0, text: "Can we" },
        { at: 400, event: "final", source: "them", index: 0, text: "Can we start?", startMs: 0, endMs: 3000 },
        { at: 450, event: "segment", source: "them", index: 0, startMs: 0, endMs: 3000 },
      ],
    });
    const { id } = await calls.start({ target: { all: true }, app: "x", mic: false });
    await waitFor(() => published.some((live) => live?.partials.some((partial) => partial.text === "Can we")));
    await waitFor(() => store.segments(id)[0]?.status === "done");
    expect(store.segments(id)[0]?.text).toBe("Can we start?");
    expect(calls.live()?.partials).toEqual([]);
    await calls.stop(id);
  });

  it("with the voice service, sends pieces to Talk's queue instead of holding them", async () => {
    const { calls, store, wakes, stub } = setup({ steps: [started, ...piece("them", 0, 0, 5_000, "ignored", 10)] }, { stt: "voice-service" });
    const { id } = await calls.start({ target: { all: true }, app: "x", mic: true });
    await waitFor(() => store.segments(id).length === 1);
    expect(wakes()).toBe(1);
    expect(store.due(5).map((segment) => segment.id)).toEqual(["them-0"]);
    await calls.stop(id);
    expect(store.recording(id)?.status).toBe("finishing");
    expect(JSON.parse(stub.log()[0]!.argv![2]!).stt).toEqual({ kind: "none" });
  });

  it("holds local pieces from the queue, and fails the ones the helper never finished so Retry can send them", async () => {
    const { calls, store } = setup({ steps: [started, ...piece("them", 0, 0, 5_000, null, 10)] });
    const { id } = await calls.start({ target: { all: true }, app: "x", mic: true });
    await waitFor(() => store.segments(id).length === 1);
    expect(store.due(5)).toEqual([]);
    expect(store.nextDueAt()).toBeNull();
    await calls.stop(id);
    expect(store.segments(id)[0]).toMatchObject({ status: "failed", error: LOCAL_UNFINISHED });
    expect(store.recording(id)?.status).toBe("done");
    store.retryFailed(id);
    expect(store.due(5).map((segment) => segment.id)).toEqual(["them-0"]);
  });

  it("stops by itself when the tapped app quits", async () => {
    const { calls, store, ended } = setup({
      steps: [started, ...piece("them", 0, 0, 3_000, "Bye everyone.", 10), { at: 40, event: "appGone", bundleId: "us.zoom.xos" }],
    });
    const { id } = await calls.start({ target: { bundleIds: ["us.zoom.xos"] }, app: "zoom.us", mic: true });
    await waitFor(() => ended.includes(id));
    expect(store.recording(id)?.status).toBe("done");
    expect(calls.live()).toBeNull();
  });

  it("says why when the helper reports an error and exits", async () => {
    const { calls, store, published, ended } = setup({
      steps: [{ at: 0, event: "error", code: "permission", message: "denied" }],
      exitAfterSteps: true,
      exitCode: 1,
    });
    const { id } = await calls.start({ target: { all: true }, app: "x", mic: true });
    await waitFor(() => ended.includes(id));
    expect(published.some((live) => live?.error?.includes("System Settings"))).toBe(true);
    expect(published.at(-1)).toBeNull();
    // Nothing was said, so Talk's server discards it like any empty recording.
    expect(store.emptyRecordings(id)).toEqual([id]);
  });

  it("asks for the notice first, and records one call at a time", async () => {
    const first = setup({ steps: [started] }, { consented: false });
    await expect(first.calls.start({ target: { all: true }, app: "x", mic: true })).rejects.toThrow(/notice/);
    expect(first.store.list()).toEqual([]);
    await first.calls.consent();
    expect(await first.calls.consented()).toBe(true);
    const { id } = await first.calls.start({ target: { all: true }, app: "x", mic: true });
    await expect(first.calls.start({ target: { all: true }, app: "y", mic: true })).rejects.toThrow(/already recording/);
    await first.calls.stop(id);
  });

  it("removes the recording when the helper can't start", async () => {
    const { calls, store, stub } = setup({ steps: [started] });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(`${stub.path}.sha256`, "0".repeat(64));
    await expect(calls.start({ target: { all: true }, app: "x", mic: true })).rejects.toThrow(/checksum/);
    expect(store.list()).toEqual([]);
    expect(calls.live()).toBeNull();
  });

  it("finishes a call left capturing by a restart", async () => {
    const { calls, store, ended } = setup({ steps: [] });
    const recording = store.create({ id: "rec_orphan0001", kind: "recording", projectId: null, threadId: null, call: { app: "zoom.us", bundleIds: [], mic: true, stt: "whisperkit" } });
    store.addSegment({ recordingId: recording.id, sessionId: "them", index: 0, startedAt: 1, durationMs: 1000, mimeType: "audio/wav", bytes: 10, file: `${recording.id}/them-0.wav`, speaker: "them", held: true });
    await calls.recover();
    expect(store.recording(recording.id)?.status).toBe("done");
    expect(store.segments(recording.id)[0]?.status).toBe("failed");
    expect(ended).toEqual([recording.id]);
  });

  it("lists apps playing audio first", async () => {
    const { calls } = setup({
      permission: "undetermined",
      apps: [
        { bundleId: "com.apple.FaceTime", name: "FaceTime", pid: 3, playing: false },
        { bundleId: "us.zoom.xos", name: "zoom.us", pid: 1, playing: true },
      ],
      steps: [],
    });
    const sources = await calls.sources();
    expect(sources).toMatchObject({ supported: true, permission: "undetermined" });
    expect(sources.apps.map((app) => app.name)).toEqual(["zoom.us", "FaceTime"]);
  });
});
