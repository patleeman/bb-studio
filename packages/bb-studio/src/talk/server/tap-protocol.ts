// The bb-talk-tap helper's protocol (native/talk-tap): JSON lines on stdout,
// one object per line; stdin takes {"cmd":"stop"}; stderr is logs only.
// Pure: no process or filesystem access here (see tap-helper.ts).
import { z } from "zod";
import { callAppSchema, speakerSchema, type CallTarget } from "../shared/contract";

const index = z.number().int().min(0);
const ms = z.number().min(0);

export const tapEventSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("started"), sources: z.array(speakerSchema) }),
  z.object({ event: z.literal("level"), source: speakerSchema, rms: z.number().min(0).max(1) }),
  z.object({ event: z.literal("segment"), source: speakerSchema, index, path: z.string().min(1), startMs: ms, endMs: ms }),
  z.object({ event: z.literal("partial"), source: speakerSchema, index, text: z.string() }),
  z.object({ event: z.literal("final"), source: speakerSchema, index, text: z.string(), startMs: ms, endMs: ms }),
  z.object({ event: z.literal("appGone"), bundleId: z.string() }),
  // WhisperKit's model: "download" with progress, then "ready". The first load can take minutes; pieces keep coming.
  z.object({ event: z.literal("model"), progress: z.number().min(0).max(1), stage: z.string().max(40) }),
  z.object({ event: z.literal("error"), code: z.enum(["permission", "device", "model", "internal"]), message: z.string() }),
  z.object({ event: z.literal("stopped") }),
]);
export type TapEvent = z.infer<typeof tapEventSchema>;

/** One stdout line as an event; null for blank lines and anything the protocol doesn't know. */
export function parseTapLine(line: string): TapEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = tapEventSchema.safeParse(JSON.parse(trimmed));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const appsOutputSchema = z.object({ apps: z.array(callAppSchema) });
export const permissionOutputSchema = z.object({ audioCapture: z.enum(["granted", "denied", "undetermined"]) });

export type TapStt =
  | { kind: "whisperkit"; model: string; modelDir: string }
  // Fake mode only: finals say "<n> ms of audio", with no model.
  | { kind: "test" }
  | { kind: "none" };

export interface CaptureArgs {
  target: CallTarget;
  mic: boolean;
  segmentDir: string;
  segmentTargetMs: number;
  segmentMaxMs: number;
  stt: TapStt;
}

/** About 8 s per piece, cut at a pause, never past 15 s: text arrives every few seconds. */
export const CALL_SEGMENT_TARGET_MS = 8_000;
export const CALL_SEGMENT_MAX_MS = 15_000;

export interface FakeAudio { them: string; me: string; speed?: number }

/** argv for `capture`; `fake` replays two WAV files instead of tapping (tests and staged captures), `speed` times faster. */
export function captureArgv(args: CaptureArgs, fake?: FakeAudio): string[] {
  const argv = ["capture", "--json-args", JSON.stringify(args)];
  if (fake) argv.push("--fake", fake.them, fake.me);
  if (fake?.speed && fake.speed !== 1) argv.push("--fake-speed", String(fake.speed));
  return argv;
}

export const STOP_COMMAND = `${JSON.stringify({ cmd: "stop" })}\n`;

/** Splits a stream of chunks into lines, keeping a partial line for the next chunk. */
export class LineSplitter {
  private rest = "";

  push(chunk: string): string[] {
    const text = this.rest + chunk;
    const lines = text.split("\n");
    this.rest = lines.pop() ?? "";
    return lines;
  }

  flush(): string[] {
    const rest = this.rest;
    this.rest = "";
    return rest ? [rest] : [];
  }
}
