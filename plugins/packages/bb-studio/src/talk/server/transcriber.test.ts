import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { memoryStore } from "../test/db";
import { AudioFiles } from "./audio-files";
import { MAX_ATTEMPTS, Transcriber, isUnavailable, retryDelay } from "./transcriber";

const REC = "rec_cccccccccccccccc";
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "talk-test-"));
  dirs.push(dir);
  const files = new AudioFiles(dir);
  const { store } = memoryStore();
  store.create({ id: REC, kind: "recording", projectId: null, threadId: null });
  const put = async (index: number, bytes = "audio") => {
    const file = await files.write(REC, `sessiona-${index}`, "audio/webm;codecs=opus", Buffer.from(bytes));
    store.addSegment({
      recordingId: REC,
      sessionId: "sessiona",
      index,
      startedAt: 100 + index,
      durationMs: 20_000,
      mimeType: "audio/webm;codecs=opus",
      bytes: bytes.length,
      file,
    });
  };
  return { store, files, put };
}

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  expect(check()).toBe(true);
}

describe("retryDelay", () => {
  it("backs off, waits long for a missing service, and eventually gives up", () => {
    expect(retryDelay(0, "timeout")).toBe(5_000);
    expect(retryDelay(10, "timeout")).toBe(600_000);
    expect(retryDelay(0, "Voice service is not configured")).toBe(600_000);
    expect(retryDelay(MAX_ATTEMPTS - 1, "timeout")).toBeNull();
    expect(isUnavailable("HTTP 401 Unauthorized")).toBe(true);
    expect(isUnavailable("Audio could not be decoded")).toBe(false);
  });
});

describe("Transcriber", () => {
  it("transcribes in order, passing the previous text as the hint", async () => {
    const { store, files, put } = await setup();
    await put(0, "first");
    await put(1, "second");
    const calls: { name: string; type: string; hint: string }[] = [];
    const changed: string[] = [];
    const transcriber = new Transcriber({
      store,
      files,
      async transcribe(audio, hint) {
        calls.push({ name: audio.name, type: audio.type, hint });
        return `text of ${await audio.text()}`;
      },
      onSegment: (id) => changed.push(id),
      warn: () => {},
    });
    const lifetime = new AbortController();
    const running = transcriber.run(lifetime.signal);
    await until(() => store.recording(REC)!.pendingCount === 0);
    lifetime.abort();
    await running;
    expect(calls).toEqual([
      { name: "sessiona-0.webm", type: "audio/webm", hint: "" },
      { name: "sessiona-1.webm", type: "audio/webm", hint: "text of first" },
    ]);
    expect(store.transcript(REC)).toBe("text of first text of second");
    expect(changed).toEqual([REC, REC]);
  });

  it("wakes for work that arrives while it sleeps", async () => {
    const { store, files, put } = await setup();
    const transcriber = new Transcriber({
      store,
      files,
      transcribe: async () => "late",
      onSegment: () => {},
      warn: () => {},
    });
    const lifetime = new AbortController();
    const running = transcriber.run(lifetime.signal);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await put(0);
    transcriber.wake();
    await until(() => store.transcript(REC) === "late");
    lifetime.abort();
    await running;
  });

  it("schedules a retry on failure and gives up on missing audio", async () => {
    const { store, files, put } = await setup();
    await put(0);
    store.addSegment({
      recordingId: "rec_cccccccccccccccc",
      sessionId: "sessionb",
      index: 0,
      startedAt: 5_000,
      durationMs: 1000,
      mimeType: "audio/webm",
      bytes: 1,
      file: `${REC}/gone.webm`,
    });
    const warnings: string[] = [];
    const transcriber = new Transcriber({
      store,
      files,
      transcribe: async () => {
        throw new Error("upstream timeout");
      },
      onSegment: () => {},
      warn: (message) => warnings.push(message),
    });
    const lifetime = new AbortController();
    const running = transcriber.run(lifetime.signal);
    await until(() => store.segments(REC)[0]!.attempts === 1);
    lifetime.abort();
    await running;
    const [first, missing] = store.segments(REC);
    expect(first).toMatchObject({ status: "pending", error: "upstream timeout" });
    // The first segment blocks later ones in the same recording while it waits.
    expect(missing!.status).toBe("pending");
    expect(warnings).toHaveLength(1);
  });

  it("refuses paths outside the audio directory", async () => {
    const { files } = await setup();
    expect(() => files.inside("../data.db")).toThrow(/outside/);
    expect(() => files.inside("/etc/passwd")).toThrow(/outside/);
  });

  it("times out a hung transcribe call, aborts its signal, schedules a retry (never drops), and frees the slot for other recordings", async () => {
    const { store, files, put } = await setup();
    await put(0, "hung");
    const rec2 = "rec_dddddddddddddddd";
    store.create({ id: rec2, kind: "recording", projectId: null, threadId: null });
    const file2 = await files.write(rec2, "sessionb-0", "audio/webm;codecs=opus", Buffer.from("ok"));
    store.addSegment({
      recordingId: rec2,
      sessionId: "sessionb",
      index: 0,
      startedAt: 200,
      durationMs: 10_000,
      mimeType: "audio/webm;codecs=opus",
      bytes: 2,
      file: file2,
    });

    let hungSignal: AbortSignal | undefined;
    const transcriber = new Transcriber({
      store,
      files,
      concurrency: 1,
      timeoutMs: 40,
      transcribe: async (_audio, _hint, signal, segment) => {
        if (segment.recordingId === REC) {
          hungSignal = signal;
          return new Promise<string>(() => {}); // hangs forever
        }
        return "second ok";
      },
      onSegment: () => {},
      warn: () => {},
    });

    const lifetime = new AbortController();
    const running = transcriber.run(lifetime.signal);
    await until(() => store.transcript(rec2) === "second ok");
    lifetime.abort();
    await running;

    expect(hungSignal?.aborted).toBe(true);
    const [seg] = store.segments(REC);
    expect(seg).toMatchObject({ status: "pending", attempts: 1 });
    expect(seg!.error).toMatch(/timed out/i);
    expect(store.transcript(REC)).toBe("");
    expect(store.transcript(rec2)).toBe("second ok");
  });

  it("returns promptly on shutdown even if transcribe ignores abort, without counting an attempt", async () => {
    const { store, files, put } = await setup();
    await put(0, "hung");
    let started!: () => void;
    const began = new Promise<void>((resolve) => { started = resolve; });
    const transcriber = new Transcriber({
      store,
      files,
      timeoutMs: 5_000,
      transcribe: () => {
        started();
        return new Promise<string>(() => {}); // ignores abort, hangs forever
      },
      onSegment: () => {},
      warn: () => {},
    });
    const lifetime = new AbortController();
    const running = transcriber.run(lifetime.signal);
    await began;
    const t0 = Date.now();
    lifetime.abort();
    await running;
    expect(Date.now() - t0).toBeLessThan(500);
    expect(store.segments(REC)[0]).toMatchObject({ status: "pending", attempts: 0, error: null });
  });

  it("ignores a late transcribe() resolution after timeout (writes nothing)", async () => {
    const { store, files, put } = await setup();
    await put(0, "late");
    let resolveLate!: (text: string) => void;
    const transcriber = new Transcriber({
      store,
      files,
      timeoutMs: 30,
      transcribe: () => new Promise<string>((resolve) => { resolveLate = resolve; }),
      onSegment: () => {},
      warn: () => {},
    });
    const lifetime = new AbortController();
    const running = transcriber.run(lifetime.signal);
    await until(() => store.segments(REC)[0]!.attempts === 1);
    resolveLate("late text that must not land");
    await new Promise((r) => setTimeout(r, 20));
    lifetime.abort();
    await running;
    expect(store.transcript(REC)).toBe("");
    expect(store.segments(REC)[0]).toMatchObject({ status: "pending", attempts: 1 });
  });
});
