import { subcommand, takeOption } from "@bb-studio/kit/cli";
import { defineItemMention, serveBytes } from "@bb-studio/kit/server";
// bb-studio-talk — durable long-form dictation.
//
// The browser captures audio in short segments and uploads each one over RPC
// as soon as it closes (see src/client/). This server writes every segment to
// disk before acknowledging it, then a background queue transcribes segments
// in order through BB's configured voice service (Settings → AI services —
// the user's ChatGPT subscription through Codex by default). Each recording is
// a durable object: a page at /plugins/talk/recordings/<id>, a mention in the
// composer's @ menu, and `bb talk` on the command line.
import { newId } from "@bb-studio/kit/ids";
import { studioSchemas } from "@bb-studio/kit/contract";
import { createChangeBus } from "@bb-studio/kit/server";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { rpcContract } from "./src/shared/contract";
import { RECORDING_CHANGED, formatLength } from "./src/shared/format";
import { AudioFiles, extensionFor, pluginDataDirectory } from "./src/server/audio-files";
import { audioResponse } from "./src/server/audio-response";
import { audioArchive } from "./src/server/audio-archive";
import { MENTION_TRANSCRIPT_CHARS, mentionContext, mentionSubtitle } from "./src/server/mentions";
import { MIGRATIONS, TalkStore } from "./src/server/store";
import { refuseWhileCapturing, registerStudio } from "./src/server/studio";
import { generateTitle } from "./src/server/titles";
import { Transcriber } from "./src/server/transcriber";
import { generateRecordingSummary } from "./src/server/meetings";
import { cleanTranscript } from "./src/server/cleanup";
import { talkModels } from "./src/server/models";
import { HOLD_KEY_OPTIONS } from "./src/shared/format";

export type { TalkRpcContract } from "./src/shared/contract";

/** A capturing client heartbeats every 20s; after 2 minutes it is gone. */
const STALE_AFTER_MS = 120_000;
/** Enough transcript to say what a recording is about. */
const TITLE_MIN_CHARS = 280;
/** A cleanup that takes longer than this inserts the text as spoken. */
const CLEANUP_TIMEOUT_MS = 30_000;
const DAY_MS = 86_400_000;

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    replaceBuiltInDictation: {
      type: "boolean",
      label: "Replace built-in dictation",
      description:
        "The composer's microphone starts Talk instead of BB's one-shot dictation, so every dictation is saved and can run for hours.",
      default: true,
    },
    segmentSeconds: {
      type: "number",
      label: "Segment length (seconds)",
      description:
        "Audio is uploaded and transcribed in pieces of about this length, cut at a pause. Shorter pieces stream text sooner; 15–40 works well.",
      default: 25,
      experimental_schema: z.number().int().min(8).max(60),
    },
    autoTitle: {
      type: "boolean",
      label: "Auto-title recordings",
      description: "Ask Studio Decisions for a short title once a recording has some text.",
      default: true,
    },
    autoMeetingNotes: {
      type: "boolean",
      label: "Automatically summarize recordings",
      description: "Generate a concise summary when a recording finishes. You can also summarize a recording from its menu.",
      default: false,
    },
    holdToTalkKey: {
      type: "select",
      label: "Hold-to-talk key",
      description:
        "Hold this key to dictate into the focused composer or field, and let go to insert the text. Pressing it with another key does nothing.",
      options: [...HOLD_KEY_OPTIONS],
      default: HOLD_KEY_OPTIONS[0],
    },
    dictationAudioDays: {
      type: "number",
      label: "Keep dictation audio (days)",
      description:
        "Delete a finished dictation's audio after this many days and keep its transcript. Recordings keep their audio. 0 keeps it forever.",
      default: 1,
      experimental_schema: z.number().int().min(0).max(3650),
    },
  });
  let config = await settings.get();
  settings.onChange((next) => {
    config = next;
  });

  const db = bb.storage.database();
  db.pragma("foreign_keys = ON");
  bb.storage.migrate(db, MIGRATIONS);
  const store = new TalkStore(db);
  const files = new AudioFiles(pluginDataDirectory(db));

  const lifetime = new AbortController();
  const studio = studioSchemas(z);
  // Transcription touches a recording every few seconds; Studio only needs to hear about it now and then.
  const changeBus = createChangeBus({ bb, channel: RECORDING_CHANGED, pluginId: "talk", schemas: studio, event: (id) => ({ id }), delayMs: 1500 });
  bb.onDispose(() => {
    lifetime.abort();
    changeBus.dispose();
  });

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

  const summarizing = new Set<string>();
  async function meetingNotes(id: string, regenerate = false): Promise<void> {
    const recording = store.recording(id);
    if (!recording || recording.kind !== "recording" || recording.status !== "done" || recording.failedCount || !recording.wordCount) return;
    if (!regenerate && recording.meetingNotes) return;
    if (summarizing.has(id)) {
      if (regenerate) throw new Error("A summary is already being generated.");
      return;
    }
    summarizing.add(id);
    try {
      const transcript = store.transcript(id);
      const notes = await generateRecordingSummary(bb, id, transcript, lifetime.signal, await models.get("summary"));
      // A resumed recording may gain text while the model is working.
      if (store.transcript(id) === transcript && store.saveMeetingNotes(id, notes)) changed(id);
    } finally {
      summarizing.delete(id);
    }
  }
  function maybeSummarize(id: string): void {
    if (!config.autoMeetingNotes) return;
    void meetingNotes(id).catch((error) => {
      if (!lifetime.signal.aborted) bb.log.warn(`Talk could not summarize ${id}: ${String(error)}`);
    });
  }

  // ── Transcription ───────────────────────────────────────────────────────
  const transcriber = new Transcriber({
    store,
    files,
    async transcribe(audio, hint, signal) {
      const result = await bb.sdk.system.transcribeVoice({
        file: audio,
        ...(hint ? { prompt: hint } : {}),
        signal,
      });
      return result.text;
    },
    onSegment(id) {
      changed(id);
      maybeTitle(id);
      discardEmptyLater(id);
      maybeSummarize(id);
    },
    warn: (message) => bb.log.warn(message),
  });
  bb.background.service("transcriber", { start: (signal) => transcriber.run(signal) });

  // Dictations are a safety net: after a while their audio goes, their text stays.
  async function expireDictationAudio(): Promise<void> {
    const days = config.dictationAudioDays;
    if (typeof days !== "number" || !(days > 0)) return;
    for (const id of store.audioExpired(Date.now() - days * DAY_MS)) {
      await files.removeRecording(id);
      store.markAudioRemoved(id);
      changed(id);
    }
  }
  bb.background.service("audio-expiry", {
    async start(signal) {
      while (!signal.aborted) {
        await expireDictationAudio().catch((error) => bb.log.warn(`Talk could not expire dictation audio: ${String(error)}`));
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 6 * 60 * 60_000);
          signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
        });
      }
    },
  });

  bb.background.service("watchdog", {
    async start(signal) {
      while (!signal.aborted) {
        for (const id of store.interruptStale(STALE_AFTER_MS)) changed(id);
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 30_000);
          signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
        });
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
    recordings_list: ({ query, limit }) => ({ recordings: store.list({ query, limit }) }),
    recording_get: ({ id }) => ({ recording: mustGet(id), segments: store.segments(id) }),
    recording_create: async ({ kind, projectId, threadId }) => {
      if (threadId) projectId = (await bb.sdk.threads.get({ threadId })).projectId;
      const recording = store.create({ id: newId("rec_"), kind, projectId, threadId });
      changed(recording.id);
      return recording;
    },
    recording_rename: ({ id, title }) => {
      const recording = store.rename(id, title, "user") ?? mustGet(id);
      changed(id);
      return recording;
    },
    recording_state: ({ id, status }) => {
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
    recording_heartbeat: ({ id }) => {
      const before = store.recording(id)?.status;
      const status = store.heartbeat(id);
      if (status !== before) changed(id);
      return { status };
    },
    segment_put: async (input) => {
      const recording = mustGet(input.recordingId);
      const bytes = Buffer.from(input.audioBase64, "base64");
      if (bytes.length === 0) throw new Error("Empty audio segment.");
      const segmentId = `${input.sessionId}-${input.index}`;
      if (store.hasSegment(recording.id, segmentId)) return { stored: false };
      // Permanent: the client sets the piece aside instead of retrying.
      if (recording.audioRemoved) throw Object.assign(new Error("This recording's audio was deleted."), { code: "invalid_input" });
      const file = await files.write(recording.id, segmentId, input.mimeType, bytes);
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
        throw error;
      }
      // A straggler from an outbox that drained after the user stopped.
      if (stored && recording.status === "done") store.setStatus(recording.id, "finishing");
      transcriber.wake();
      changed(recording.id);
      return { stored };
    },
    recording_retry: ({ id }) => {
      mustGet(id);
      store.retryFailed(id);
      transcriber.wake();
      changed(id);
      return mustGet(id);
    },
    meeting_regenerate: async ({ id }) => {
      const recording = mustGet(id);
      if (recording.kind !== "recording" || recording.status !== "done" || recording.failedCount || !recording.wordCount) {
        throw new Error("Finish transcribing the recording before generating a summary.");
      }
      await meetingNotes(id, true);
      return { recording: mustGet(id) };
    },
    dictation_cleanup: async ({ id }) => {
      const recording = mustGet(id);
      if (recording.kind !== "dictation") return { text: null };
      const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(CLEANUP_TIMEOUT_MS)]);
      return { text: await cleanTranscript(bb, { recordingId: id, transcript: store.transcript(id), modelSelection: await models.get("cleanup") }, signal) };
    },
    recording_cleanup: async ({ id, segmentId }) => {
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
    recording_keep: ({ id }) => {
      mustGet(id);
      if (store.setKind(id, "recording")) {
        changed(id);
        maybeTitle(id);
        maybeSummarize(id);
      }
      return mustGet(id);
    },
    recording_delete: async ({ id }) => {
      refuseWhileCapturing(store.recording(id));
      const deleted = store.delete(id);
      await files.removeRecording(id);
      if (deleted) changed(id);
      return { deleted };
    },
  });

  registerStudio(bb, studio, { store, removeAudio: (id) => files.removeRecording(id), readAudio: (file) => files.read(file), changed });

  // Segment audio for the recording page's player. Same-origin GET only.
  bb.http.route("GET", "/audio", async (context) => {
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
  bb.http.route("GET", "/transcript", (context) => {
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
  bb.http.route("GET", "/audio-export", async (context) => {
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
    resolve: (id) => {
      const recording = mustGet(id);
      const cleaned = store.cleanedTranscript(id);
      return { context: mentionContext(recording, cleaned ?? store.transcript(id), cleaned !== null) };
    },
  }));

  bb.agents.registerTool({
    name: "talk_list",
    description: "List recent Talk recordings and dictations. Search titles and transcripts with `query`.",
    parameters: z.object({ query: z.string().max(200).optional(), limit: z.number().int().min(1).max(100).optional() }),
    execute({ query, limit }) {
      const rows = store.list({ query, limit: limit ?? 30 });
      return rows.length ? rows.map((r) => `- ${r.title} (${r.id}), ${r.kind}, ${r.status}, ${r.wordCount} words: /plugins/talk/recordings/${r.id}`).join("\n") : "No recordings match.";
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
      return [`${recording.title} (${id})`, `Status: ${recording.status}`, `Link: /plugins/talk/recordings/${id}`,
        notes ? `Summary: ${notes.summary}` : "",
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
  bb.agents.configure(() => ({ tools: ["talk_list", "talk_read", "talk_search"], skills: [] }));

  // ── `bb talk` ───────────────────────────────────────────────────────────
  const usage = [
    "Usage:",
    "  bb talk list [--query <text>] [--json]",
    "  bb talk show <recording-id> [--json]",
    "  bb talk transcript <recording-id> [--cleaned] [--offset <chars>] [--limit <chars>]",
  ].join("\n");
  bb.cli.register({
    name: "talk",
    summary: "Read Talk recordings and their transcripts",
    commands: [
      { name: "list", summary: "List recent recordings", usage: "bb talk list [--query <text>] [--json]" },
      { name: "show", summary: "Show one recording's details", usage: "bb talk show <recording-id> [--json]" },
      {
        name: "transcript",
        summary: "Print a recording's transcript (paged by characters)",
        usage: "bb talk transcript <recording-id> [--cleaned] [--offset <chars>] [--limit <chars>]",
      },
    ],
    async run(argv) {
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
        stderr: `No recording ${value}. Run "bb talk list" to see ids.`,
      });
      switch (command) {
        case undefined:
        case "help":
        case "--help":
          return { exitCode: 0, stdout: usage };
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
              `Link: /plugins/talk/recordings/${recording.id}`,
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
              ? `\n\n[${text.length - offset - limit} more characters: bb talk transcript ${id}${cleaned ? " --cleaned" : ""} --offset ${offset + limit}]`
              : "";
          return { exitCode: 0, stdout: page === "" ? "(No transcript.)" : page + more };
        }
      }
      return { exitCode: 1, stderr: usage };
    },
  });
}
