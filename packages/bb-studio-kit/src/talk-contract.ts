// Studio's recording RPC methods (Talk is built into Studio). They are the
// old Studio Talk plugin's (`talk`) client methods with a `recordings.`
// prefix, so Studio's app, the iOS app and the Talk upgrade bridge
// (packages/bb-studio-talk) share one set of shapes. The kit holds them
// because the bridge is a separate package and can't import Studio.
import type { defineRpcContract as sdkDefineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { modelSelectionSchema } from "./decisions-contract";

// Studio's frontend imports this file, and a plugin's frontend bundle can't
// resolve the root SDK. The SDK's helper only returns its argument.
const defineRpcContract: typeof sdkDefineRpcContract = (contract) => contract;

export const modelPurposeSchema = z.enum(["cleanup", "title", "summary"]);
export type ModelPurpose = z.infer<typeof modelPurposeSchema>;
export const modelPreferencesSchema = z.object({
  cleanup: modelSelectionSchema.nullable(),
  title: modelSelectionSchema.nullable(),
  summary: modelSelectionSchema.nullable(),
});
export type ModelPreferences = z.infer<typeof modelPreferencesSchema>;

export const recordingStatusSchema = z.enum([
  // A client is capturing audio into this recording.
  "recording",
  // The user paused; the microphone is released.
  "paused",
  // The capturing client stopped heartbeating (closed tab, crash, lost
  // network). The recording can be resumed.
  "interrupted",
  // Capture stopped; waiting for the remaining segments to transcribe.
  "finishing",
  "done",
]);
export type RecordingStatus = z.infer<typeof recordingStatusSchema>;

export const recordingKindSchema = z.enum(["recording", "dictation"]);
export type RecordingKind = z.infer<typeof recordingKindSchema>;

export const meetingNotesSchema = z.object({
  summary: z.string(),
});
export type MeetingNotes = z.infer<typeof meetingNotesSchema>;

export const recordingSchema = z.object({
  id: z.string(),
  title: z.string(),
  titleSource: z.enum(["pending", "auto", "user"]),
  kind: recordingKindSchema,
  status: recordingStatusSchema,
  projectId: z.string().nullable(),
  threadId: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  endedAt: z.number().nullable(),
  durationMs: z.number(),
  segmentCount: z.number(),
  pendingCount: z.number(),
  failedCount: z.number(),
  wordCount: z.number(),
  /** The last few hundred characters of transcript, for list rows. */
  preview: z.string(),
  archived: z.boolean(),
  /** A dictation's audio was deleted after the retention period; the transcript stays. */
  audioRemoved: z.boolean(),
  meetingNotes: meetingNotesSchema.nullable().optional(),
  /** The Studio Page "Make notes" wrote for this recording. */
  notesPageId: z.string().nullable().optional(),
});
export type Recording = z.infer<typeof recordingSchema>;

export const segmentStatusSchema = z.enum(["pending", "done", "empty", "failed"]);
export type SegmentStatus = z.infer<typeof segmentStatusSchema>;

export const segmentSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  startedAt: z.number(),
  /** Position in recorded time: the sum of every earlier segment's duration. */
  offsetMs: z.number(),
  durationMs: z.number(),
  mimeType: z.string(),
  bytes: z.number(),
  status: segmentStatusSchema,
  text: z.string().nullable(),
  /** A saved cleanup; the original text and audio stay intact. */
  cleanedText: z.string().nullable().optional(),
  error: z.string().nullable(),
  attempts: z.number(),
});
export type Segment = z.infer<typeof segmentSchema>;

const recordingId = z.string().regex(/^rec_[a-z0-9]{8,32}$/);
const clientId = z.string().regex(/^[a-z0-9]{6,32}$/);

/** Base64 of 12 MB. A 40s speech segment at 32 kbps is about 160 KB. */
export const MAX_SEGMENT_BASE64 = 16 * 1024 * 1024;

/** What the app and native clients call: the old Talk plugin's methods with a `recordings.` prefix. */
export const rpcContract = defineRpcContract({
  "recordings.models.get": { input: z.null(), output: modelPreferencesSchema },
  "recordings.models.set": {
    input: z.object({ purpose: modelPurposeSchema, selection: modelSelectionSchema.nullable() }).strict(),
    output: modelPreferencesSchema,
  },
  "recordings.models.suggest": { input: z.null(), output: modelSelectionSchema.nullable() },
  "recordings.recordings_list": {
    input: z.object({
      query: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    output: z.object({ recordings: z.array(recordingSchema) }),
  },
  "recordings.recording_get": {
    input: z.object({ id: recordingId }),
    output: z.object({ recording: recordingSchema, segments: z.array(segmentSchema) }),
  },
  "recordings.recording_create": {
    input: z.object({
      kind: recordingKindSchema,
      projectId: z.string().max(64).nullable(),
      threadId: z.string().max(64).nullable(),
    }),
    output: recordingSchema,
  },
  "recordings.recording_rename": {
    input: z.object({ id: recordingId, title: z.string().trim().min(1).max(160) }),
    output: recordingSchema,
  },
  /** Capture state transitions reported by the capturing client. */
  "recordings.recording_state": {
    input: z.object({
      id: recordingId,
      status: z.enum(["recording", "paused", "finishing"]),
    }),
    output: recordingSchema,
  },
  "recordings.recording_heartbeat": {
    input: z.object({ id: recordingId }),
    output: z.object({ status: recordingStatusSchema.nullable() }),
  },
  "recordings.segment_put": {
    input: z.object({
      recordingId,
      sessionId: clientId,
      index: z.number().int().min(0).max(1_000_000),
      startedAt: z.number().int().min(0),
      durationMs: z.number().int().min(0).max(10 * 60_000),
      mimeType: z.string().regex(/^audio\/[a-z0-9.+-]+(;.*)?$/i).max(100),
      audioBase64: z.string().min(1).max(MAX_SEGMENT_BASE64),
    }),
    output: z.object({ stored: z.boolean() }),
  },
  "recordings.recording_retry": {
    input: z.object({ id: recordingId }),
    output: recordingSchema,
  },
  "recordings.meeting_regenerate": {
    input: z.object({ id: recordingId }),
    output: z.object({ recording: recordingSchema }),
  },
  /** Whether Studio Pages is there to hold notes. */
  "recordings.notes_status": {
    input: z.null(),
    output: z.object({ pagesAvailable: z.boolean() }),
  },
  /** Writes the recording's notes page, or updates the one it has. */
  "recordings.notes_make": {
    input: z.object({ id: recordingId }),
    output: z.object({ recording: recordingSchema, pageId: z.string(), created: z.boolean() }),
  },
  /** A finished dictation's transcript, tidied for inserting; null keeps the raw text. */
  "recordings.dictation_cleanup": {
    input: z.object({ id: recordingId }),
    output: z.object({ text: z.string().nullable() }),
  },
  /** Cleans one finished segment so long recordings keep their audio alignment. */
  "recordings.recording_cleanup": {
    input: z.object({ id: recordingId, segmentId: z.string().min(1).max(100) }),
    output: z.object({ text: z.string() }),
  },
  /** Turns a dictation into a recording: out of the background, titled, with optional summarization. */
  "recordings.recording_keep": {
    input: z.object({ id: recordingId }),
    output: recordingSchema,
  },
  "recordings.recording_delete": {
    input: z.object({ id: recordingId }),
    output: z.object({ deleted: z.boolean() }),
  },
});
export type TalkRpcContract = typeof rpcContract;

const time = z.number().int().min(0);
const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;
/** A segment's audio file, relative to the audio root: `<recordingId>/<name>.<ext>`. */
export const AUDIO_FILE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}\/[A-Za-z0-9][A-Za-z0-9_-]{0,199}\.[a-z0-9]{1,8}$/;

/** A recording as the bridge sends it: the old plugin's rows, unchanged. */
export const importRecordingSchema = z.object({
  id: z.string().regex(ITEM_ID),
  title: z.string().max(2000),
  titleSource: z.enum(["pending", "auto", "user"]),
  titleChars: z.number().int().min(0),
  kind: recordingKindSchema,
  status: recordingStatusSchema,
  projectId: z.string().min(1).max(200).nullable(),
  threadId: z.string().min(1).max(200).nullable(),
  createdAt: time,
  updatedAt: time,
  endedAt: time.nullable(),
  heartbeatAt: time,
  archivedAt: time.nullable(),
  audioRemovedAt: time.nullable(),
  /** The summary, as the old plugin stored it (JSON). */
  meetingNotes: z.string().max(1_000_000).nullable(),
  notesPageId: z.string().min(1).max(200).nullable(),
  /** The action items the last notes run wrote, as stored (JSON). */
  notesItems: z.string().max(1_000_000).nullable(),
  segments: z.array(z.object({
    id: z.string().regex(ITEM_ID),
    sessionId: z.string().min(1).max(200),
    index: z.number().int().min(0),
    startedAt: time,
    durationMs: z.number().int().min(0),
    mimeType: z.string().min(1).max(200),
    bytes: z.number().int().min(0),
    file: z.string().regex(AUDIO_FILE),
    /** The bridge copied this segment's audio into Studio first; false when the old plugin had none (an expired dictation's). */
    audio: z.boolean(),
    status: segmentStatusSchema,
    text: z.string().nullable(),
    cleanedText: z.string().nullable(),
    error: z.string().max(10_000).nullable(),
    attempts: z.number().int().min(0),
    nextAttemptAt: time,
    createdAt: time,
  })).max(100_000),
});
export type ImportRecording = z.infer<typeof importRecordingSchema>;

/** Recordings per `recordings.importRows` call, and the transcript characters a call carries (one larger recording goes alone). */
export const IMPORT_BATCH = 100;
export const IMPORT_BATCH_CHARS = 8 * 1024 * 1024;
/** Audio bytes per `recordings.importAudio` call; a larger file goes in several. */
export const AUDIO_CHUNK_BYTES = 4 * 1024 * 1024;
/** Kept free on Studio's disk while copying audio, so the copy never fills it. */
export const DISK_RESERVE_BYTES = 256 * 1024 * 1024;
/** Audio files per `recordings.missingAudio` call. */
export const AUDIO_CHECK_BATCH = 500;

export const HOLD_KEY_OPTIONS = ["Right Option (Alt)", "Right Command", "Right Control", "Off"] as const;

/**
 * Talk's settings (`bb.settings.define`), on Studio's settings page now. The
 * bridge defines them too, only to read what the user had set and copy it.
 */
export const TALK_SETTINGS = {
  replaceBuiltInDictation: {
    type: "boolean" as const,
    label: "Replace built-in dictation",
    description:
      "The composer's microphone starts Talk instead of BB's one-shot dictation, so every dictation is saved and can run for hours.",
    default: true,
  },
  segmentSeconds: {
    type: "number" as const,
    label: "Segment length (seconds)",
    description:
      "Audio is uploaded and transcribed in pieces of about this length, cut at a pause. Shorter pieces stream text sooner; 15–40 works well.",
    default: 25,
    experimental_schema: z.number().int().min(8).max(60),
  },
  autoTitle: {
    type: "boolean" as const,
    label: "Auto-title recordings",
    description: "Ask Studio Decisions for a short title once a recording has some text.",
    default: true,
  },
  autoMeetingNotes: {
    type: "boolean" as const,
    label: "Automatically summarize recordings",
    description: "Generate a concise summary when a recording finishes. You can also summarize a recording from its menu.",
    default: false,
  },
  holdToTalkKey: {
    type: "select" as const,
    label: "Hold-to-talk key",
    description:
      "Hold this key to dictate into the focused composer or field, and let go to insert the text. Pressing it with another key does nothing.",
    options: [...HOLD_KEY_OPTIONS],
    default: HOLD_KEY_OPTIONS[0],
  },
  dictationAudioDays: {
    type: "number" as const,
    label: "Keep dictation audio (days)",
    description:
      "Delete a finished dictation's audio after this many days and keep its transcript. Recordings keep their audio. 0 keeps it forever.",
    default: 1,
    experimental_schema: z.number().int().min(0).max(3650),
  },
};

/** Talk's settings, which Studio has now. */
export const talkSettingsSchema = z.object({
  replaceBuiltInDictation: z.boolean(),
  segmentSeconds: z.number().int().min(8).max(60),
  autoTitle: z.boolean(),
  autoMeetingNotes: z.boolean(),
  holdToTalkKey: z.string().max(100),
  dictationAudioDays: z.number().int().min(0).max(3650),
}).partial();
export type TalkSettings = z.infer<typeof talkSettingsSchema>;

const importResult = z.object({
  imported: z.array(z.string()),
  existing: z.array(z.string()),
  skipped: z.array(z.object({ id: z.string(), reason: z.string() })),
});
const audioRef = z.object({ recordingId: z.string().regex(ITEM_ID), file: z.string().regex(AUDIO_FILE) });

/**
 * The upgrade bridge's methods: it copies the old plugin's audio, rows and
 * settings into Studio, and forwards old mentions. Not for clients.
 */
export const bridgeContract = defineRpcContract({
  /**
   * Which audio files Studio doesn't have whole yet, with how much of each it
   * has (a copy that stopped part way resumes there), and the free space on
   * Studio's disk (null when unknown).
   */
  "recordings.missingAudio": {
    input: z.object({ files: z.array(audioRef.extend({ bytes: z.number().int().min(0) })).max(AUDIO_CHECK_BATCH) }),
    output: z.object({ missing: z.array(audioRef.extend({ offset: z.number().int().min(0) })), freeBytes: z.number().nullable() }),
  },
  /**
   * One piece of an audio file, written at `offset`. Studio answers with how
   * much it has; when that is the whole file it checks the size and SHA-256
   * and moves it into place. A piece at the wrong offset changes nothing.
   */
  "recordings.importAudio": {
    input: audioRef.extend({
      bytes: z.number().int().min(0),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      offset: z.number().int().min(0),
      data: z.string().max(Math.ceil(AUDIO_CHUNK_BYTES / 3) * 4),
    }),
    output: z.object({ offset: z.number().int().min(0), done: z.boolean() }),
  },
  /**
   * Recordings with their segments. A recording Studio already has (same id)
   * is left as it is, so a rerun changes nothing.
   */
  "recordings.importRows": {
    input: z.object({ recordings: z.array(importRecordingSchema).max(IMPORT_BATCH) }),
    output: importResult,
  },
  /** The old plugin's settings and model choices; Studio takes each one the user hasn't set in Studio. Once. */
  "recordings.importSettings": {
    input: z.object({ settings: talkSettingsSchema, models: modelPreferencesSchema.partial() }),
    output: z.object({ applied: z.array(z.string()) }),
  },
  /** What an old `@recordings` mention pill gives the agent. */
  "recordings.mentionContext": {
    input: z.object({ id: z.string().min(1).max(200) }),
    output: z.object({ context: z.string() }),
  },
});

/** The Studio Talk plugin release that is only the upgrade bridge. */
export const TALK_BRIDGE_VERSION = "0.2.0";

export { bridgeStatusContract, migrationStatusSchema, type MigrationStatus } from "./draw-contract";
