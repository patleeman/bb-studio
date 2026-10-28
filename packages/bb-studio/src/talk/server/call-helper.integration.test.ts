// The real bb-talk-tap (bin/, from native/talk-tap) driven by Studio's call
// capture, in fake mode only: it replays two WAV files, with no tap, mic or
// permission prompt. Skipped where the helper isn't built or this isn't a Mac.
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { memoryStore } from "../test/db";
import { waitFor } from "../test/tap-fixture";
import { AudioFiles } from "./audio-files";
import { CallCaptures } from "./call-capture";
import { TapHelper, defaultHelperPath } from "./tap-helper";

/** 16 kHz mono 16-bit PCM: a tone during each [startMs, endMs) span, silence elsewhere. */
function wav(totalMs: number, spans: [number, number][]): Buffer {
  const rate = 16_000;
  const samples = Math.round((rate * totalMs) / 1000);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const ms = (i / rate) * 1000;
    const on = spans.some(([start, end]) => ms >= start && ms < end);
    // A voice-like sound: a 220 Hz tone with a slow wobble in loudness.
    const value = on ? 0.4 * Math.sin((2 * Math.PI * 220 * i) / rate) * (0.6 + 0.4 * Math.sin((2 * Math.PI * 3 * i) / rate)) : 0;
    buffer.writeInt16LE(Math.round(value * 32_767), 44 + i * 2);
  }
  return buffer;
}

const helperPath = defaultHelperPath();
const available = process.platform === "darwin" && existsSync(helperPath) && existsSync(`${helperPath}.sha256`);

describe.skipIf(!available)("the real helper, in fake mode", () => {
  it("lists apps without a tap, and records a fake call into a Me/Them recording", async () => {
    const root = mkdtempSync(join(tmpdir(), "talk-helper-"));
    const them = join(root, "them.wav");
    const me = join(root, "me.wav");
    // Them talks, then Me answers after a pause, then Them again.
    writeFileSync(them, wav(12_000, [[500, 3_000], [8_500, 10_500]]));
    writeFileSync(me, wav(12_000, [[4_500, 7_000]]));
    const helper = new TapHelper({ path: helperPath, fake: { them, me, speed: 8 } });
    expect(Array.isArray(await helper.apps())).toBe(true);

    const { store } = memoryStore();
    const ended: string[] = [];
    const calls = new CallCaptures({
      store,
      files: new AudioFiles(join(root, "talk")),
      helper,
      incomingRoot: join(root, "talk", "incoming"),
      modelDir: join(root, "talk", "whisperkit"),
      settings: () => ({ stt: "whisperkit", localModel: "unused" }),
      testStt: true,
      kv: { get: async <T,>() => ({ at: 1 }) as T, set: async () => {} },
      changed: () => {},
      publish: () => {},
      wake: () => {},
      // Test finals all read "<n> ms of audio", which dedupe would take for echoes.
      onText: () => {},
      onEnded: (id) => ended.push(id),
      log: () => {},
    });
    const { id } = await calls.start({ target: { all: true }, app: "ignored", mic: true });
    // The helper stops by itself when the files end.
    await waitFor(() => ended.includes(id), 20_000);

    const segments = store.segments(id);
    expect(segments.map((segment) => segment.speaker)).toEqual(["them", "me", "them"]);
    expect(segments.every((segment) => segment.status === "done" && /^\d+ ms of audio$/.test(segment.text ?? ""))).toBe(true);
    // Merged by when they were spoken, from the shared zero.
    expect(segments[1]!.startedAt - segments[0]!.startedAt).toBeGreaterThan(3_000);
    expect(store.recording(id)?.status).toBe("done");
    expect(store.transcript(id)).toMatch(/^Them: \d+ ms of audio\n\nMe: \d+ ms of audio\n\nThem: \d+ ms of audio$/);
  }, 30_000);
});
