// Studio's recording RPC methods (Talk is built into Studio). They are the
// old Studio Talk plugin's (`talk`) client methods with a `recordings.`
// prefix, shared by Studio's app and the iOS app's generated contract.
import type { defineRpcContract as sdkDefineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { modelSelectionSchema } from "../decisions/contract";

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

/** Where a call's speech becomes text: WhisperKit inside the helper, the home server, or BB's voice service. */
export const CALL_STT_OPTIONS = ["Local (WhisperKit)", "Home server (red4)", "BB voice service"] as const;
export const callSttSchema = z.enum(["whisperkit", "red4", "voice-service"]);
export type CallStt = z.infer<typeof callSttSchema>;
export const CALL_RETENTION_OPTIONS = ["7 days", "30 days", "Forever"] as const;

/** A recording of a call (Zoom, Meet, FaceTime): the app's audio is "Them", the mic is "Me". */
export const callInfoSchema = z.object({
  /** The app's name, or "All system audio". */
  app: z.string(),
  /** Empty when capturing all system audio. */
  bundleIds: z.array(z.string()),
  mic: z.boolean(),
  stt: callSttSchema,
});
export type CallInfo = z.infer<typeof callInfoSchema>;

export const speakerSchema = z.enum(["me", "them"]);
export type Speaker = z.infer<typeof speakerSchema>;

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
  /** Set on a call recording. */
  call: callInfoSchema.nullable().optional(),
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
  /** A call's side: the mic ("me") or the app ("them"). */
  speaker: speakerSchema.nullable().optional(),
  /** A "me" piece that repeated what "them" said (the mic heard the speakers). */
  echo: z.boolean().optional(),
});
export type Segment = z.infer<typeof segmentSchema>;

const recordingId = z.string().regex(/^rec_[a-z0-9]{8,32}$/);

export const callAppSchema = z.object({
  bundleId: z.string(),
  name: z.string(),
  pid: z.number(),
  playing: z.boolean(),
});
export type CallApp = z.infer<typeof callAppSchema>;

export const callTargetSchema = z.union([
  z.object({ bundleIds: z.array(z.string().min(1).max(200)).min(1).max(20) }).strict(),
  z.object({ all: z.literal(true) }).strict(),
]);
export type CallTarget = z.infer<typeof callTargetSchema>;

/** The call being captured now, as the recording bar and live transcript show it. */
export const callLiveSchema = z.object({
  recordingId: z.string(),
  app: z.string(),
  mic: z.boolean(),
  startedAt: z.number(),
  phase: z.enum(["starting", "recording", "stopping"]),
  /** Text still being transcribed, before its piece's final transcript lands. */
  partials: z.array(z.object({ speaker: speakerSchema, index: z.number(), text: z.string(), startMs: z.number() })),
  levels: z.object({ me: z.number(), them: z.number() }),
  error: z.string().nullable(),
});
export type CallLive = z.infer<typeof callLiveSchema>;
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
  /** What a call capture can tap here: apps playing audio, and whether this Mac can capture at all. */
  "recordings.call_sources": {
    input: z.null(),
    output: z.object({
      supported: z.boolean(),
      /** Why capture isn't possible here, when it isn't. */
      reason: z.string().nullable(),
      /** Null when the helper couldn't say. */
      permission: z.enum(["granted", "denied", "undetermined"]).nullable(),
      apps: z.array(callAppSchema),
    }),
  },
  /** The call being captured, and whether the one-time consent notice was read. */
  "recordings.call_status": {
    input: z.null(),
    output: z.object({ active: callLiveSchema.nullable(), consented: z.boolean() }),
  },
  "recordings.call_consent": {
    input: z.null(),
    output: z.object({ consented: z.boolean() }),
  },
  "recordings.call_start": {
    input: z.object({ target: callTargetSchema, app: z.string().trim().min(1).max(120), mic: z.boolean() }).strict(),
    output: recordingSchema,
  },
  "recordings.call_stop": {
    input: z.object({ id: recordingId }),
    output: recordingSchema,
  },
});
export type TalkRpcContract = typeof rpcContract;

/** A segment's audio file, relative to the audio root: `<recordingId>/<name>.<ext>`. */
export const AUDIO_FILE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}\/[A-Za-z0-9][A-Za-z0-9_-]{0,199}\.[a-z0-9]{1,8}$/;

export const HOLD_KEY_OPTIONS = ["Right Option (Alt)", "Right Command", "Right Control", "Off"] as const;

/**
 * Talk's settings (`bb.settings.define`), on Studio's settings page now.
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
  callTranscription: {
    type: "select" as const,
    label: "Call transcription",
    description:
      "Where a recorded call's speech becomes text. Local runs WhisperKit on this Mac and keeps the audio here; the home server and BB's voice service receive each piece of audio.",
    options: [...CALL_STT_OPTIONS],
    default: CALL_STT_OPTIONS[0],
  },
  callServerUrl: {
    type: "string" as const,
    label: "Call transcription: home server URL",
    description:
      "Your speech-to-text server with an OpenAI-compatible /v1/audio/transcriptions endpoint, such as http://red4:8000. Used when Call transcription is Home server.",
    default: "",
  },
  callServerModel: {
    type: "string" as const,
    label: "Call transcription: home server model",
    description: "The model name the home server expects. Leave empty for whisper-1.",
    default: "",
  },
  callLocalModel: {
    type: "string" as const,
    label: "Call transcription: local model",
    description: "The WhisperKit model the helper runs on this Mac. It is downloaded the first time a call uses it.",
    default: "large-v3-v20240930_turbo",
  },
  callAudioRetention: {
    type: "select" as const,
    label: "Keep call audio",
    description: "Delete a finished call's audio after this long. Its transcript and notes stay until you delete the recording.",
    options: [...CALL_RETENTION_OPTIONS],
    default: CALL_RETENTION_OPTIONS[1],
  },
};

/** The setting's label as the STT kind the capture uses. */
export function callSttFor(setting: unknown): CallStt {
  if (setting === CALL_STT_OPTIONS[1]) return "red4";
  if (setting === CALL_STT_OPTIONS[2]) return "voice-service";
  return "whisperkit";
}

/** Days to keep call audio, or null for forever. */
export function callRetentionDays(setting: unknown): number | null {
  if (setting === "Forever") return null;
  if (setting === "7 days") return 7;
  return 30;
}

/** Talk's settings, which Studio has now. */
export const talkSettingsSchema = z.object({
  replaceBuiltInDictation: z.boolean(),
  segmentSeconds: z.number().int().min(8).max(60),
  autoTitle: z.boolean(),
  autoMeetingNotes: z.boolean(),
  holdToTalkKey: z.string().max(100),
  dictationAudioDays: z.number().int().min(0).max(3650),
  callTranscription: z.string().max(100),
  callServerUrl: z.string().max(500),
  callServerModel: z.string().max(200),
  callLocalModel: z.string().max(200),
  callAudioRetention: z.string().max(100),
}).partial();
export type TalkSettings = z.infer<typeof talkSettingsSchema>;
