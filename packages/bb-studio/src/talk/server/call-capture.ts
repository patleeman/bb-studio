// Call capture: runs the bb-talk-tap helper (tap-helper.ts) and turns its
// events into a Talk recording tagged as a call. The app's audio is "them",
// the mic is "me"; each side arrives as its own stream of short WAV pieces,
// which go into the store with their start time, so the transcript merges
// them by when they were spoken.
//
// With local STT the helper transcribes too: its partials go out live over
// realtime, and its finals land on their pieces. Otherwise the pieces wait in
// Talk's transcription queue like any recording's.
//
// One call at a time. Nothing starts on its own: only `start`, from the user.
import { mkdir, readFile, rm } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { newId } from "../../kit/ids";
import type { CallInfo, CallLive, CallStt, CallTarget, Recording, Speaker } from "../shared/contract";
import type { AudioFiles } from "./audio-files";
import type { TalkStore } from "./store";
import { CALL_SEGMENT_MAX_MS, CALL_SEGMENT_TARGET_MS, type TapEvent, type TapStt } from "./tap-protocol";
import { HelperError, platformSupport, type CaptureHandle, type TapHelper } from "./tap-helper";

export const CONSENT_KEY = "talk.callConsent";
export const ALL_SYSTEM_AUDIO = "All system audio";
/** Live updates (levels, partials) go out at most this often. */
const PUBLISH_EVERY_MS = 250;
const HEARTBEAT_MS = 20_000;
export const LOCAL_UNFINISHED = "Local transcription stopped before this piece. Retry sends it to BB's voice service.";

export interface CallCaptureDeps {
  store: TalkStore;
  files: AudioFiles;
  helper: TapHelper;
  /** Where the helper writes pieces before Studio takes them: <talk>/incoming/<recordingId>. */
  incomingRoot: string;
  /** WhisperKit's models: <talk>/whisperkit. */
  modelDir: string;
  settings(): { stt: CallStt; localModel: string };
  kv: { get<T>(key: string): Promise<T | undefined>; set(key: string, value: unknown): Promise<void> };
  /** The recording changed (Studio, open pages). */
  changed(id: string): void;
  /** The live call, or null once it ended. */
  publish(live: CallLive | null): void;
  /** A piece is waiting in the transcription queue. */
  wake(): void;
  /** A piece's text landed. */
  onText(id: string): void;
  /** Capture ended; the recording is finishing or done. */
  onEnded(id: string): void;
  log(message: string): void;
  now?: () => number;
}

interface Session {
  recordingId: string;
  info: CallInfo;
  /** Capture time zero: the helper's startMs and endMs count from here. */
  anchor: number;
  dir: string;
  phase: CallLive["phase"];
  handle: CaptureHandle | null;
  partials: Map<string, CallLive["partials"][number]>;
  levels: CallLive["levels"];
  error: string | null;
  gone: Set<string>;
  /** Pieces and finals in the order the helper sent them. */
  queue: Promise<void>;
  /** Finals that came before their piece's file. */
  early: Map<string, string>;
  heartbeat: NodeJS.Timeout;
  ended: Promise<void>;
}

const segmentId = (speaker: Speaker, index: number) => `${speaker}-${index}`;

function errorText(event: Extract<TapEvent, { event: "error" }>): string {
  if (event.code === "permission") {
    return "macOS hasn't allowed BB to record other apps' audio. Allow BB in System Settings › Privacy & Security › Screen & System Audio Recording, then start again.";
  }
  if (event.code === "model") return `Local transcription couldn't start: ${event.message}`;
  if (event.code === "device") return `The audio device failed: ${event.message}`;
  return event.message;
}

export class CallCaptures {
  private session: Session | null = null;
  private lastPublish = 0;
  private publishTimer: NodeJS.Timeout | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: CallCaptureDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** Apps playing audio, permission, and whether this Mac can capture. Never creates a tap. */
  async sources() {
    const reason = this.deps.helper.fake ? null : platformSupport();
    if (reason) return { supported: false, reason, permission: null, apps: [] };
    try {
      const [apps, permission] = await Promise.all([this.deps.helper.apps(), this.deps.helper.permission()]);
      apps.sort((a, b) => Number(b.playing) - Number(a.playing) || a.name.localeCompare(b.name));
      return { supported: true, reason: null, permission, apps };
    } catch (error) {
      return { supported: false, reason: error instanceof Error ? error.message : String(error), permission: null, apps: [] };
    }
  }

  async consented(): Promise<boolean> {
    return Boolean(await this.deps.kv.get(CONSENT_KEY));
  }

  async consent(): Promise<void> {
    await this.deps.kv.set(CONSENT_KEY, { at: this.now() });
  }

  live(): CallLive | null {
    const session = this.session;
    if (!session) return null;
    return {
      recordingId: session.recordingId,
      app: session.info.app,
      mic: session.info.mic,
      startedAt: session.anchor,
      phase: session.phase,
      partials: [...session.partials.values()].sort((a, b) => a.startMs - b.startMs),
      levels: { ...session.levels },
      error: session.error,
    };
  }

  isCapturing(id: string): boolean {
    return this.session?.recordingId === id;
  }

  async start(input: { target: CallTarget; app: string; mic: boolean; projectId?: string | null }): Promise<Recording> {
    const { store, helper } = this.deps;
    if (this.session) throw new Error(`Talk is already recording a call (${this.session.info.app}). Stop it first.`);
    if (!(await this.consented())) throw new Error("Read the call recording notice first.");
    const unsupported = helper.fake ? null : platformSupport();
    if (unsupported) throw new Error(unsupported);
    await helper.verify();

    const { stt, localModel } = this.deps.settings();
    const info: CallInfo = {
      app: "all" in input.target ? ALL_SYSTEM_AUDIO : input.app,
      bundleIds: "bundleIds" in input.target ? input.target.bundleIds : [],
      mic: input.mic,
      stt,
    };
    const recording = store.create({ id: newId("rec_"), kind: "recording", projectId: input.projectId ?? null, threadId: null, call: info });
    const dir = join(this.deps.incomingRoot, recording.id);
    let markEnded!: () => void;
    const session: Session = {
      recordingId: recording.id,
      info,
      anchor: this.now(),
      dir,
      phase: "starting",
      handle: null,
      partials: new Map(),
      levels: { me: 0, them: 0 },
      error: null,
      gone: new Set(),
      queue: Promise.resolve(),
      early: new Map(),
      heartbeat: setInterval(() => store.heartbeat(recording.id), HEARTBEAT_MS),
      ended: new Promise<void>((resolve) => { markEnded = resolve; }),
    };
    this.session = session;
    const tapStt: TapStt = stt === "whisperkit" ? { kind: "whisperkit", model: localModel, modelDir: this.deps.modelDir } : { kind: "none" };
    try {
      await mkdir(dir, { recursive: true });
      if (stt === "whisperkit") await mkdir(this.deps.modelDir, { recursive: true });
      session.handle = await helper.capture(
        { target: input.target, mic: input.mic, segmentDir: dir, segmentTargetMs: CALL_SEGMENT_TARGET_MS, segmentMaxMs: CALL_SEGMENT_MAX_MS, stt: tapStt },
        (event) => this.onEvent(session, event),
      );
    } catch (error) {
      clearInterval(session.heartbeat);
      this.session = null;
      store.delete(recording.id);
      await rm(dir, { recursive: true, force: true });
      this.deps.changed(recording.id);
      markEnded();
      throw error instanceof HelperError ? new Error(error.message) : error;
    }
    void session.handle.exited.then(({ code, signal }) => {
      if (code && !session.error) session.error = `The capture helper stopped unexpectedly (exit ${code}).`;
      else if (signal && session.phase !== "stopping" && !session.error) session.error = `The capture helper stopped unexpectedly (${signal}).`;
      return this.finish(session);
    }).catch((error) => this.deps.log(`Talk could not finish call ${session.recordingId}: ${String(error)}`)).finally(markEnded);
    this.deps.changed(recording.id);
    this.publishNow();
    return store.recording(recording.id)!;
  }

  /** Stops the call; resolves once its last pieces are stored. A call left capturing by a restart is just finished. */
  async stop(id: string): Promise<Recording> {
    const session = this.session;
    if (session?.recordingId === id) {
      if (session.phase !== "stopping") {
        session.phase = "stopping";
        this.publishNow();
      }
      await session.handle?.stop();
      await session.ended;
    } else {
      this.finishOrphan(id);
    }
    const recording = this.deps.store.recording(id);
    if (!recording) throw new Error(`No recording ${id}.`);
    return recording;
  }

  /** At startup: a call whose helper died with the server is finished with what it stored. */
  async recover(): Promise<void> {
    for (const id of this.deps.store.capturingCalls()) this.finishOrphan(id);
    await rm(this.deps.incomingRoot, { recursive: true, force: true });
  }

  dispose(): void {
    const session = this.session;
    if (!session) return;
    clearInterval(session.heartbeat);
    session.handle?.kill();
    // Finished at the next start (recover).
  }

  private finishOrphan(id: string): void {
    const { store } = this.deps;
    if (!store.call(id)) return;
    const status = store.recording(id)?.status;
    if (status !== "recording" && status !== "paused" && status !== "interrupted") return;
    store.releaseHeld(id, LOCAL_UNFINISHED);
    store.setStatus(id, "finishing");
    this.deps.changed(id);
    this.deps.onEnded(id);
  }

  private onEvent(session: Session, event: TapEvent): void {
    if (this.session !== session) return;
    const { store } = this.deps;
    switch (event.event) {
      case "started":
        session.phase = session.phase === "stopping" ? "stopping" : "recording";
        store.heartbeat(session.recordingId);
        this.publishNow();
        return;
      case "level":
        session.levels[event.source] = event.rms;
        this.publishSoon();
        return;
      case "partial":
        session.partials.set(segmentId(event.source, event.index), {
          speaker: event.source,
          index: event.index,
          text: event.text,
          startMs: session.partials.get(segmentId(event.source, event.index))?.startMs ?? this.now() - session.anchor,
        });
        this.publishSoon();
        return;
      case "segment":
        this.enqueue(session, () => this.ingest(session, event));
        return;
      case "final":
        this.enqueue(session, async () => {
          const id = segmentId(event.source, event.index);
          session.partials.delete(id);
          if (store.saveFinal(session.recordingId, id, event.text)) this.landed(session.recordingId);
          else if (!store.hasSegment(session.recordingId, id)) session.early.set(id, event.text);
          this.publishSoon();
        });
        return;
      case "appGone": {
        session.gone.add(event.bundleId);
        const targets = session.info.bundleIds;
        if (targets.length && targets.every((bundleId) => session.gone.has(bundleId)) && session.phase !== "stopping") {
          this.deps.log(`Talk: ${session.info.app} quit; stopping the call recording.`);
          void this.stop(session.recordingId).catch((error) => this.deps.log(`Talk could not stop call ${session.recordingId}: ${String(error)}`));
        }
        return;
      }
      case "error":
        session.error = errorText(event);
        this.deps.log(`Talk call capture: ${event.code}: ${event.message}`);
        this.publishNow();
        return;
      case "stopped":
        return;
    }
  }

  private enqueue(session: Session, work: () => Promise<void>): void {
    session.queue = session.queue.then(work).catch((error) => {
      this.deps.log(`Talk could not store a call piece for ${session.recordingId}: ${String(error)}`);
    });
  }

  private landed(id: string): void {
    this.deps.changed(id);
    this.deps.onText(id);
  }

  /** Takes a closed piece from the helper's folder into Talk's audio store. */
  private async ingest(session: Session, event: Extract<TapEvent, { event: "segment" }>): Promise<void> {
    const { store, files } = this.deps;
    const source = resolve(event.path);
    const back = relative(session.dir, source);
    if (!back || back.startsWith("..") || back.includes(`..${sep}`) || resolve(back) === back) {
      throw new Error(`The helper wrote a piece outside its folder: ${event.path}`);
    }
    const bytes = await readFile(source);
    const id = segmentId(event.source, event.index);
    if (bytes.length === 0) {
      await rm(source, { force: true });
      return;
    }
    const recordingId = session.recordingId;
    const file = await files.write(recordingId, id, "audio/wav", bytes, () => store.recording(recordingId) !== null);
    await rm(source, { force: true });
    const held = session.info.stt === "whisperkit";
    store.addSegment({
      recordingId,
      sessionId: event.source,
      index: event.index,
      startedAt: Math.round(session.anchor + event.startMs),
      durationMs: Math.max(0, Math.round(event.endMs - event.startMs)),
      mimeType: "audio/wav",
      bytes: bytes.length,
      file,
      speaker: event.source,
      held,
    });
    const early = session.early.get(id);
    if (early !== undefined) {
      session.early.delete(id);
      store.saveFinal(recordingId, id, early);
      this.landed(recordingId);
    } else {
      this.deps.changed(recordingId);
    }
    if (!held) this.deps.wake();
  }

  private async finish(session: Session): Promise<void> {
    const { store } = this.deps;
    await session.queue;
    clearInterval(session.heartbeat);
    if (this.session === session) this.session = null;
    if (this.publishTimer) clearTimeout(this.publishTimer);
    this.publishTimer = null;
    const id = session.recordingId;
    if (store.recording(id)) {
      store.releaseHeld(id, LOCAL_UNFINISHED);
      store.setStatus(id, "finishing");
      this.deps.changed(id);
    }
    this.deps.publish(session.error ? { ...this.snapshot(session), phase: "stopping" } : null);
    if (session.error) this.deps.publish(null);
    await rm(session.dir, { recursive: true, force: true });
    if (store.recording(id)) this.deps.onEnded(id);
  }

  private snapshot(session: Session): CallLive {
    return {
      recordingId: session.recordingId,
      app: session.info.app,
      mic: session.info.mic,
      startedAt: session.anchor,
      phase: session.phase,
      partials: [],
      levels: { me: 0, them: 0 },
      error: session.error,
    };
  }

  private publishNow(): void {
    if (this.publishTimer) clearTimeout(this.publishTimer);
    this.publishTimer = null;
    this.lastPublish = this.now();
    this.deps.publish(this.live());
  }

  private publishSoon(): void {
    if (this.publishTimer) return;
    const wait = Math.max(0, this.lastPublish + PUBLISH_EVERY_MS - this.now());
    if (wait === 0) {
      this.publishNow();
      return;
    }
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null;
      if (this.session) this.publishNow();
    }, wait);
  }
}
