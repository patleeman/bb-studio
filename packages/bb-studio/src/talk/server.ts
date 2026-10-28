import type { StudioChanged } from "../kit/server/core";
// Talk, built into Studio: long-form, durable dictation and recording.
//
// The browser captures audio in short segments and uploads each one over RPC
// as soon as it closes (see ui/). This server writes every segment to disk
// before acknowledging it, then a background queue transcribes segments in
// order through BB's configured voice service (Settings → AI services — the
// user's ChatGPT subscription through Codex by default). Each recording is a
// durable object: a Studio tab at /plugins/studio/studio/recordings/<id>, a
// mention in the composer's @ menu, and `bb studio recordings` on the
// command line.
//
// This was the Studio Talk plugin (id `talk`). Its recordings keep that id as
// their namespace; its agent tools, skill, mention provider, message
// directive and commands keep their names (docs/merging-add-ons.md).
import { join } from "node:path";
import { studioSchemas } from "../kit/contract";
import { subcommand, takeOption } from "../kit/cli";
import { newId } from "../kit/ids";
import { createChangeBus, defineItemMention, serveBytes, type BackupHandlers, type StudioProviderHandlers } from "../kit/server/index";
import type { BbPluginApi, PluginSettingsHandle } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { z } from "zod";
import { rpcContract, TALK_SETTINGS } from "./shared/contract";
import { PANEL_PATH, PLUGIN_ID, RECORDING_CHANGED, formatLength, recordingHref } from "./shared/format";
import { AudioFiles, extensionFor, pluginDataDirectory } from "./server/audio-files";
import { audioResponse } from "./server/audio-response";
import { audioArchive } from "./server/audio-archive";
import { MENTION_TRANSCRIPT_CHARS, mentionContext, mentionSubtitle } from "./server/mentions";
import { TalkStore } from "./server/store";
import { deleteRecording, recordingProvider } from "./server/studio";
import { generateTitle } from "./server/titles";
import { Transcriber } from "./server/transcriber";
import { Summaries, generateRecordingSummary } from "./server/meetings";
import { cleanTranscript } from "./server/cleanup";
import { talkModels } from "./server/models";
import { NotesMaker, generateNotes, notesPagePath, type PagesClient } from "./server/notes";
import { talkBackupHandlers } from "./server/backup";
import { abortableWait } from "./server/abortable-wait";
import { CallCaptures } from "./server/call-capture";
import { echoSegments } from "./server/call-echo";
import { CallFinisher, callContext } from "./server/call-finish";
import { transcribeOnServer } from "./server/call-stt";
import { TapHelper } from "./server/tap-helper";
import { CALL_LIVE, type CallLive } from "./shared/format";
import { callRetentionDays, callSttFor } from "./shared/contract";

export { TALK_SETTINGS } from "./shared/contract";

/** A capturing client heartbeats every 20s; after 2 minutes it is gone. */
const STALE_AFTER_MS = 120_000;
/** Enough transcript to say what a recording is about. */
const TITLE_MIN_CHARS = 280;
/** A cleanup that takes longer than this inserts the text as spoken. */
const CLEANUP_TIMEOUT_MS = 30_000;
const DAY_MS = 86_400_000;

/** Available in every agent session. */
export const TALK_TOOLS = ["talk_list", "talk_read", "talk_search", "talk_make_notes"];

export const RECORDINGS_USAGE = [
  "Usage:",
  "  bb studio recordings list [--query <text>] [--json]",
  "  bb studio recordings show <recording-id> [--json]",
  "  bb studio recordings transcript <recording-id> [--cleaned] [--offset <chars>] [--limit <chars>]",
  "  bb studio recordings notes <recording-id> [--json]",
].join("\n");

export type TalkSettingsHandle = PluginSettingsHandle<typeof TALK_SETTINGS>;

export interface BuiltinRecordings {
  store: TalkStore;
  /** Studio's provider methods, which the hub calls in-process. */
  provider: StudioProviderHandlers;
  /** Its section of a Studio backup, still named `talk`. */
  backup: BackupHandlers;
  /** `bb studio recordings …` */
  cli(argv: string[]): Promise<{ exitCode: number; stdout?: string; stderr?: string }>;
  dispose(): void;
}

/** Registers recordings' RPC, HTTP routes, background work, agent tools and mention provider on Studio. Studio has run the migrations. */
export async function registerTalk(bb: BbPluginApi, db: Database.Database, settings: TalkSettingsHandle, pages: PagesClient, notify: StudioChanged): Promise<BuiltinRecordings> {
  let config = await settings.get();
  settings.onChange((next) => {
    config = next;
  });

  db.pragma("foreign_keys = ON");
  const store = new TalkStore(db);
  // Beside Studio's database; the Talk plugin kept it beside its own.
  const talkDirectory = join(pluginDataDirectory(db), "talk");
  const files = new AudioFiles(talkDirectory);

  const lifetime = new AbortController();
  const studio = studioSchemas(z);
  // Transcription touches a recording every few seconds; Studio only needs to hear about it now and then.
  const changeBus = createChangeBus({ bb, notify, channel: RECORDING_CHANGED, pluginId: PLUGIN_ID, schemas: studio, event: (id) => ({ id }), delayMs: 1500 });

  const changed = (id: string) => changeBus.changed(id);
  const models = talkModels(bb);

  // Empty recordings are never kept: one that finishes without a word
  // (a mic tapped by accident, silence, noise) is deleted with its audio.
  async function discardEmpty(id?: string): Promise<void> {
    for (const emptyId of store.emptyRecordings(id)) {
      store.delete(emptyId);
      await files.removeRecording(emptyId);
      changed(emptyId);
    }
  }
  await discardEmpty();
  function discardEmptyLater(id: string): void {
    void discardEmpty(id).catch((error) => bb.log.warn(`Talk could not discard empty recording ${id}: ${String(error)}`));
  }

  // ── Auto-titling ────────────────────────────────────────────────────────
  const titling = new Set<string>();
  function maybeTitle(id: string): void {
    if (!config.autoTitle || titling.has(id)) return;
    const due = store.titleDue(id, TITLE_MIN_CHARS);
    if (!due) return;
    titling.add(id);
    void models.get("title").then((modelSelection) => generateTitle(
      bb,
      {
        transcript: store.transcript(id),
        recordingId: id,
        createdAt: store.recording(id)!.createdAt,
        modelSelection,
      },
      lifetime.signal,
    ))
      .then((title) => {
        if (store.rename(id, title, "auto", due.chars)) changed(id);
      })
      .catch((error) => {
        if (!lifetime.signal.aborted) bb.log.warn(`Talk could not title ${id}: ${String(error)}`);
      })
      .finally(() => titling.delete(id));
  }

  const summaries = new Summaries({
    store,
    summarize: async (id, transcript) => generateRecordingSummary(bb, id, withCallContext(id, transcript), lifetime.signal, await models.get("summary")),
    changed,
  });
  const meetingNotes = (id: string, regenerate = false) => summaries.run(id, regenerate);
  function maybeSummarize(id: string): void {
    if (!config.autoMeetingNotes) return;
    void meetingNotes(id).catch((error) => {
      if (!lifetime.signal.aborted) bb.log.warn(`Talk could not summarize ${id}: ${String(error)}`);
    });
  }

  function withCallContext(id: string, transcript: string): string {
    const call = store.call(id);
    return call ? callContext(call.app) + transcript : transcript;
  }

  // ── Notes pages ────────────────────────────────────────────────────────
  const notes = new NotesMaker({
    store,
    pages,
    generate: async (id, transcript) => generateNotes(bb, id, withCallContext(id, transcript), lifetime.signal, await models.get("summary")),
    changed,
  });

  // A crash between a segment's update and its settle leaves a recording
  // finishing with nothing left to transcribe; finish it now.
  for (const id of store.settleFinishing()) {
    changed(id);
    maybeTitle(id);
    maybeSummarize(id);
    discardEmptyLater(id);
  }

  // ── Transcription ───────────────────────────────────────────────────────
  const transcriber = new Transcriber({
    store,
    files,
    async transcribe(audio, hint, signal, segment) {
      // A call set to the home server; a local (WhisperKit) piece retried by hand goes to the voice service.
      if (store.call(segment.recordingId)?.stt === "red4") {
        return transcribeOnServer({ url: config.callServerUrl ?? "", model: config.callServerModel, audio, prompt: hint || undefined, signal });
      }
      const result = await bb.sdk.system.transcribeVoice({
        file: audio,
        ...(hint ? { prompt: hint } : {}),
        signal,
      });
      return result.text;
    },
    onSegment(id) {
      dedupeEcho(id);
      changed(id);
      maybeTitle(id);
      discardEmptyLater(id);
      maybeSummarize(id);
      callFinisher.maybeRun(id);
    },
    warn: (message) => bb.log.warn(message),
  });
  bb.background.service("talk-transcriber", { start: (signal) => transcriber.run(signal) });

  // ── Calls ───────────────────────────────────────────────────────────────
  // The mic heard the call through the speakers: hide "me" pieces that only repeat "them".
  function dedupeEcho(id: string): void {
    if (!store.call(id)?.mic) return;
    const echoes = echoSegments(store.segments(id));
    if (echoes.length && store.markEcho(id, echoes)) changed(id);
  }
  const callFinisher = new CallFinisher({
    store,
    title: (id) => maybeTitle(id),
    summarize: (id) => meetingNotes(id),
    makeNotes: (id) => notes.run(id),
    clean: async (id, transcript, segmentId) =>
      cleanTranscript(bb, { recordingId: id, transcript, segmentId, modelSelection: await models.get("cleanup") }, lifetime.signal),
    changed,
    warn: (message) => bb.log.warn(message),
  });
  const publishCall = (live: CallLive | null) => {
    try {
      bb.realtime.publish(CALL_LIVE, { live });
    } catch {
      // The bar asks again when it reconnects.
    }
  };
  // Tests and staged captures replay two WAV files (them.wav, me.wav) instead of tapping.
  const fakeDir = process.env.BB_STUDIO_TALK_TAP_FAKE;
  const calls = new CallCaptures({
    store,
    files,
    helper: new TapHelper({
      path: process.env.BB_STUDIO_TALK_TAP || undefined,
      fake: fakeDir ? { them: join(fakeDir, "them.wav"), me: join(fakeDir, "me.wav") } : null,
      log: (message) => bb.log.info(message),
    }),
    incomingRoot: join(talkDirectory, "incoming"),
    modelDir: join(talkDirectory, "whisperkit"),
    settings: () => ({ stt: callSttFor(config.callTranscription), localModel: config.callLocalModel?.trim() || "large-v3-v20240930_turbo" }),
    kv: bb.storage.kv,
    changed,
    publish: publishCall,
    wake: () => transcriber.wake(),
    onText: (id) => {
      dedupeEcho(id);
      maybeTitle(id);
    },
    onEnded: (id) => {
      changed(id);
      maybeTitle(id);
      discardEmptyLater(id);
      callFinisher.maybeRun(id);
    },
    log: (message) => bb.log.warn(message),
  });
  await calls.recover();

  // Dictations are a safety net: after a while their audio goes, their text stays.
  async function expireDictationAudio(): Promise<void> {
    const days = config.dictationAudioDays;
    const expired = typeof days === "number" && days > 0 ? store.audioExpired(Date.now() - days * DAY_MS) : [];
    // Calls keep their audio 7 or 30 days, or forever; their transcript and notes stay.
    const callDays = callRetentionDays(config.callAudioRetention);
    if (callDays !== null) expired.push(...store.callAudioExpired(Date.now() - callDays * DAY_MS));
    for (const id of expired) {
      await files.removeRecording(id);
      store.markAudioRemoved(id);
      changed(id);
    }
  }
  bb.background.service("talk-audio-expiry", {
    async start(signal) {
      while (!signal.aborted) {
        await expireDictationAudio().catch((error) => bb.log.warn(`Talk could not expire dictation audio: ${String(error)}`));
        await abortableWait(6 * 60 * 60_000, signal);
      }
    },
  });

  bb.background.service("talk-watchdog", {
    async start(signal) {
      while (!signal.aborted) {
        for (const id of store.interruptStale(STALE_AFTER_MS)) changed(id);
        await abortableWait(30_000, signal);
      }
    },
  });

  // ── RPC for the frontend ────────────────────────────────────────────────
  function mustGet(id: string) {
    const recording = store.recording(id);
    if (!recording) throw new Error(`No recording ${id}.`);
    return recording;
  }

  bb.rpc.register(rpcContract, {
    ...models.handlers,
    "recordings.recordings_list": ({ query, limit }) => ({ recordings: store.list({ query, limit }) }),
    "recordings.recording_get": ({ id }) => ({ recording: mustGet(id), segments: store.segments(id) }),
    "recordings.recording_create": async ({ kind, projectId, threadId }) => {
      if (threadId) projectId = (await bb.sdk.threads.get({ threadId })).projectId;
      const recording = store.create({ id: newId("rec_"), kind, projectId, threadId });
      changed(recording.id);
      return recording;
    },
    "recordings.recording_rename": ({ id, title }) => {
      const recording = store.rename(id, title, "user") ?? mustGet(id);
      changed(id);
      return recording;
    },
    "recordings.recording_state": ({ id, status }) => {
      const recording = store.setStatus(id, status);
      if (!recording) throw new Error(`No recording ${id}.`);
      changed(id);
      if (recording.status === "done") {
        maybeTitle(id);
        maybeSummarize(id);
      }
      // The caller gets the final state; isEmptyRecording tells it why the
      // recording is about to disappear.
      discardEmptyLater(id);
      return recording;
    },
    "recordings.recording_heartbeat": ({ id }) => {
      const before = store.recording(id)?.status;
      const status = store.heartbeat(id);
      if (status !== before) changed(id);
      return { status };
    },
    "recordings.segment_put": async (input) => {
      const recording = mustGet(input.recordingId);
      const bytes = Buffer.from(input.audioBase64, "base64");
      if (bytes.length === 0) throw new Error("Empty audio segment.");
      const segmentId = `${input.sessionId}-${input.index}`;
      if (store.hasSegment(recording.id, segmentId)) return { stored: false };
      // Permanent: the client sets the piece aside instead of retrying.
      if (recording.audioRemoved) throw Object.assign(new Error("This recording's audio was deleted."), { code: "invalid_input" });
      const file = await files.write(recording.id, segmentId, input.mimeType, bytes, () => store.recording(recording.id) !== null);
      let stored: boolean;
      try {
        stored = store.addSegment({
          recordingId: recording.id,
          sessionId: input.sessionId,
          index: input.index,
          startedAt: input.startedAt,
          durationMs: input.durationMs,
          mimeType: input.mimeType,
          bytes: bytes.length,
          file,
        });
      } catch (error) {
        // The recording was deleted while the audio was being written.
        await files.remove(file).catch(() => {});
        await files.removeEmptyDirectory(recording.id);
        throw error;
      }
      // A straggler from an outbox that drained after the user stopped.
      if (stored && recording.status === "done") store.setStatus(recording.id, "finishing");
      transcriber.wake();
      changed(recording.id);
      return { stored };
    },
    "recordings.recording_retry": ({ id }) => {
      mustGet(id);
      store.retryFailed(id);
      transcriber.wake();
      changed(id);
      return mustGet(id);
    },
    "recordings.meeting_regenerate": async ({ id }) => {
      const recording = mustGet(id);
      if (recording.kind !== "recording" || recording.status !== "done" || recording.failedCount || !recording.wordCount) {
        throw new Error("Finish transcribing the recording before generating a summary.");
      }
      await meetingNotes(id, true);
      return { recording: mustGet(id) };
    },
    "recordings.notes_status": async () => ({ pagesAvailable: true }),
    "recordings.notes_make": async ({ id }) => {
      const result = await notes.run(id);
      return { ...result, recording: mustGet(id) };
    },
    "recordings.dictation_cleanup": async ({ id }) => {
      const recording = mustGet(id);
      if (recording.kind !== "dictation") return { text: null };
      const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(CLEANUP_TIMEOUT_MS)]);
      return { text: await cleanTranscript(bb, { recordingId: id, transcript: store.transcript(id), modelSelection: await models.get("cleanup") }, signal) };
    },
    "recordings.recording_cleanup": async ({ id, segmentId }) => {
      const recording = mustGet(id);
      if (recording.status !== "done" || recording.pendingCount || recording.failedCount) throw new Error("Finish transcription before cleaning up the recording.");
      const segment = store.segments(id).find((item) => item.id === segmentId);
      if (!segment || segment.status !== "done" || !segment.text) throw new Error("This section has no finished transcript.");
      if (segment.cleanedText != null) return { text: segment.cleanedText };
      const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(CLEANUP_TIMEOUT_MS)]);
      const text = await cleanTranscript(bb, { recordingId: id, transcript: segment.text, segmentId, modelSelection: await models.get("cleanup") }, signal);
      if (text === null) throw new Error("Cleanup could not finish this section. Check Talk's cleanup model and Studio Decisions, then try again; your original transcript is saved.");
      if (!store.saveCleanup(id, segmentId, segment.text, text)) throw new Error("The recording changed during cleanup. Try again after it finishes.");
      changed(id);
      return { text };
    },
    "recordings.recording_keep": ({ id }) => {
      mustGet(id);
      if (store.setKind(id, "recording")) {
        changed(id);
        maybeTitle(id);
        maybeSummarize(id);
      }
      return mustGet(id);
    },
    "recordings.recording_delete": async ({ id }) => {
      return { deleted: await deleteRecording({ store, removeAudio: (recordingId) => files.removeRecording(recordingId), changed }, id) };
    },
    "recordings.call_sources": () => calls.sources(),
    "recordings.call_status": async () => ({ active: calls.live(), consented: await calls.consented() }),
    "recordings.call_consent": async () => {
      await calls.consent();
      return { consented: true };
    },
    "recordings.call_start": (input) => calls.start(input),
    "recordings.call_stop": ({ id }) => calls.stop(id),
  });

  function resolveMention(id: string): string {
    const recording = mustGet(id);
    const cleaned = store.cleanedTranscript(id);
    return mentionContext(recording, cleaned ?? store.transcript(id), cleaned !== null);
  }

  // Segment audio for the recording page's player. Same-origin GET only.
  bb.http.route("GET", `/${PANEL_PATH}/audio`, async (context) => {
    const recordingId = context.req.query("recording") ?? "";
    const segmentId = context.req.query("segment") ?? "";
    const entry = store.segmentFile(recordingId, segmentId);
    if (!entry) return context.text("Not found", 404);
    const bytes = await files.read(entry.file);
    const downloadName = context.req.query("download") === "1"
      ? `${segmentId.replace(/[^a-zA-Z0-9_-]/g, "")}.${extensionFor(entry.mimeType)}`
      : undefined;
    return audioResponse(new Uint8Array(bytes), entry.mimeType, context.req.header("range"), downloadName);
  });
  bb.http.route("GET", `/${PANEL_PATH}/transcript`, (context) => {
    const id = context.req.query("recording") ?? "";
    const recording = store.recording(id);
    if (!recording || recording.status !== "done") return context.text("Not found", 404);
    const markdown = context.req.query("format") === "markdown";
    const cleaned = context.req.query("version") === "cleaned";
    const transcript = cleaned ? store.cleanedTranscript(id) : store.transcript(id);
    if (transcript === null) return context.text("No complete cleaned transcript yet", 404);
    const content = markdown ? `# ${recording.title}\n\n${transcript}\n` : `${transcript}\n`;
    const ext = markdown ? "md" : "txt";
    return serveBytes(new TextEncoder().encode(content), {
      "cache-control": "private, no-store",
      "content-type": markdown ? "text/markdown; charset=utf-8" : "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="${id}.${ext}"`,
    });
  });
  bb.http.route("GET", `/${PANEL_PATH}/audio-export`, async (context) => {
    const id = context.req.query("recording") ?? "";
    const recording = store.recording(id);
    // Recovery can download the durable prefix before a recording finishes.
    // Taking a segment snapshot excludes any segment still being uploaded.
    if (!recording) return context.text("Not found", 404);
    if (recording.audioRemoved) return context.text("This dictation's audio was deleted", 404);
    const segments = store.segments(id);
    const filesToArchive = await Promise.all(segments.map(async (segment, index) => {
      const entry = store.segmentFile(id, segment.id)!;
      const extension = extensionFor(entry.mimeType);
      return { name: `${String(index + 1).padStart(4, "0")}.${extension}`, bytes: await files.read(entry.file) };
    }));
    return serveBytes(new Uint8Array(audioArchive(filesToArchive)), {
      "content-type": "application/x-tar",
      "content-disposition": `attachment; filename="${id}-audio.tar"`,
    });
  });

  // ── @ mentions ──────────────────────────────────────────────────────────
  bb.ui.registerMentionProvider(defineItemMention({
    id: "recordings",
    label: "Talk recordings",
    search: ({ query }) =>
      store.list({ query, limit: 8 }).map((recording) => ({
        id: recording.id,
        title: recording.title,
        subtitle: mentionSubtitle(recording),
        icon: "Mic",
      })),
    resolve: (id) => ({ context: resolveMention(id) }),
  }));

  // Studio calls bb.agents.configure once, with TALK_TOOLS (BB allows one configuration per plugin).
  bb.agents.registerTool({
    name: "talk_list",
    description: "List recent Talk recordings and dictations. Search titles and transcripts with `query`.",
    parameters: z.object({ query: z.string().max(200).optional(), limit: z.number().int().min(1).max(100).optional() }),
    execute({ query, limit }) {
      const rows = store.list({ query, limit: limit ?? 30 });
      return rows.length ? rows.map((r) => `- ${r.title} (${r.id}), ${r.kind}, ${r.status}, ${r.wordCount} words: ${recordingHref(r.id)}`).join("\n") : "No recordings match.";
    },
  });
  bb.agents.registerTool({
    name: "talk_read",
    description: "Read a Talk recording's saved cleaned transcript when available, otherwise its original, plus an optional summary. Set version to original to read the raw text. For long transcripts, use offset and limit.",
    parameters: z.object({ id: z.string().min(1).max(100), version: z.enum(["original", "cleaned"]).optional(), offset: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(20_000).optional() }),
    execute({ id, version, offset = 0, limit = 12_000 }) {
      const recording = store.recording(id);
      if (!recording) return { content: [{ type: "text", text: `Recording ${id} not found.` }], isError: true };
      const cleaned = store.cleanedTranscript(id);
      if (version === "cleaned" && cleaned === null) return { content: [{ type: "text", text: "No complete cleaned transcript yet." }], isError: true };
      const useCleaned = version !== "original" && cleaned !== null;
      const transcript = useCleaned ? cleaned! : store.transcript(id);
      const notes = recording.meetingNotes;
      return [`${recording.title} (${id})`, `Status: ${recording.status}`, `Link: ${recordingHref(id)}`,
        notes ? `Summary: ${notes.summary}` : "",
        recording.notesPageId ? `Notes page: ${notesPagePath(recording.notesPageId)}` : "",
        `Transcript (${useCleaned ? "cleaned; original retained" : "original"}, ${offset}–${Math.min(offset + limit, transcript.length)} of ${transcript.length} characters):\n${transcript.slice(offset, offset + limit) || "(No transcript.)"}`].filter(Boolean).join("\n\n");
    },
  });
  bb.agents.registerTool({
    name: "talk_search",
    description: "Search Talk recording titles and transcripts. Returns matching recordings with a short transcript excerpt.",
    parameters: z.object({ query: z.string().trim().min(1).max(200) }),
    execute({ query }) {
      const rows = store.list({ query, limit: 30 });
      return rows.length ? rows.map((r) => {
        const transcript = store.transcript(r.id);
        const at = transcript.toLowerCase().indexOf(query.toLowerCase());
        const excerpt = at < 0 ? r.preview : transcript.slice(Math.max(0, at - 80), at + query.length + 120);
        return `- ${r.title} (${r.id}): ${excerpt.replace(/\s+/g, " ")}`;
      }).join("\n") : "No recordings match.";
    },
  });
  bb.agents.registerTool({
    name: "talk_make_notes",
    description: "Write a finished Talk recording's notes to a Studio Page: a short summary, decisions, and action items as a checklist the user can hand to agents. Running it again updates the same page. Needs Studio Pages.",
    parameters: z.object({ id: z.string().min(1).max(100) }),
    async execute({ id }) {
      try {
        const { pageId, created } = await notes.run(id);
        return `${created ? "Made" : "Updated"} the notes page for ${mustGet(id).title} (page id ${pageId}): ${notesPagePath(pageId)}\nPut this line on its own in your reply so the user can open the page:\n::page{id="${pageId}"}`;
      } catch (error) {
        return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
      }
    },
  });

  // ── `bb studio recordings` ──────────────────────────────────────────────
  async function cli(argv: string[]): Promise<{ exitCode: number; stdout?: string; stderr?: string }> {
    const json = argv.includes("--json");
    const cleaned = argv.includes("--cleaned");
    const args = argv.filter((arg) => arg !== "--json" && arg !== "--cleaned");
    const option = (name: string) => takeOption(args, name);
    const query = option("--query");
    const offset = Number(option("--offset") ?? 0);
    const limit = Math.min(Number(option("--limit") ?? 20_000), MENTION_TRANSCRIPT_CHARS);
    const { command, rest } = subcommand(args);
    const id = rest[0];
    const missing = (value: string) => ({
      exitCode: 1,
      stderr: `No recording ${value}. Run "bb studio recordings list" to see ids.`,
    });
    switch (command) {
      case undefined:
      case "help":
      case "--help":
        return { exitCode: 0, stdout: RECORDINGS_USAGE };
      case "list": {
        const recordings = store.list({ query, limit: 50 });
        if (json) return { exitCode: 0, stdout: JSON.stringify(recordings) };
        return {
          exitCode: 0,
          stdout:
            recordings.length === 0
              ? "No recordings."
              : recordings
                  .map((r) => `${r.id}  ${r.title}  (${mentionSubtitle(r)}, ${r.wordCount} words)`)
                  .join("\n"),
        };
      }
      case "show": {
        if (!id) break;
        const recording = store.recording(id);
        if (!recording) return missing(id);
        if (json) return { exitCode: 0, stdout: JSON.stringify(recording) };
        return {
          exitCode: 0,
          stdout: [
            `${recording.title} (${recording.id})`,
            `Status: ${recording.status}; ${formatLength(recording.durationMs)}; ${recording.wordCount} words`,
            `Segments: ${recording.segmentCount} (${recording.pendingCount} pending, ${recording.failedCount} failed)`,
            `Link: ${recordingHref(recording.id)}`,
            ...(recording.notesPageId ? [`Notes: ${notesPagePath(recording.notesPageId)}`] : []),
          ].join("\n"),
        };
      }
      case "transcript": {
        if (!id || !Number.isFinite(offset) || !Number.isFinite(limit) || offset < 0 || limit < 1) break;
        if (!store.recording(id)) return missing(id);
        const text = cleaned ? store.cleanedTranscript(id) : store.transcript(id);
        if (text === null) return { exitCode: 1, stderr: "No complete cleaned transcript yet." };
        const page = text.slice(offset, offset + limit);
        const more =
          offset + limit < text.length
            ? `\n\n[${text.length - offset - limit} more characters: bb studio recordings transcript ${id}${cleaned ? " --cleaned" : ""} --offset ${offset + limit}]`
            : "";
        return { exitCode: 0, stdout: page === "" ? "(No transcript.)" : page + more };
      }
      case "notes": {
        if (!id) break;
        if (!store.recording(id)) return missing(id);
        try {
          const { pageId, created } = await notes.run(id);
          if (json) return { exitCode: 0, stdout: JSON.stringify({ pageId, created, path: notesPagePath(pageId) }) };
          return { exitCode: 0, stdout: `${created ? "Made" : "Updated"} notes page ${pageId}: ${notesPagePath(pageId)}` };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { exitCode: 1, stderr: message };
        }
      }
    }
    return { exitCode: 1, stderr: RECORDINGS_USAGE };
  }

  return {
    store,
    provider: recordingProvider({ store, removeAudio: (id) => files.removeRecording(id), readAudio: (file) => files.read(file), changed }),
    // `bb studio backup` / `bb studio restore` (src/talk/server/backup.ts).
    backup: talkBackupHandlers({ db, files, changed }),
    cli,
    dispose: () => {
      calls.dispose();
      lifetime.abort();
      changeBus.dispose();
    },
  };
}
