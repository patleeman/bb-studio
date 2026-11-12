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
export const CALL_STT_OPTIONS = ["Local (WhisperKit)", "Home server", "BB voice service"] as const;
export const callSttSchema = z.enum(["whisperkit", "home-server", "voice-service"]);
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

export function knownCallInfo<T extends { stt?: unknown }>(info: T): T {
  return callSttSchema.safeParse(info.stt).success ? info : { ...info, stt: "home-server" };
}

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
  /** Local transcription's model while it downloads or loads; null once ready, or without local STT. */
  model: z.object({ stage: z.string(), progress: z.number() }).nullable(),
  /** Local transcription failed; the pieces go to BB's voice service instead. */
  fallback: z.boolean(),
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

/** The setting's label as the STT kind the capture uses. */
export function callSttFor(setting: unknown): CallStt {
  if (setting === CALL_STT_OPTIONS[1]) return "home-server";
  if (setting === CALL_STT_OPTIONS[2]) return "voice-service";
  return "whisperkit";
}

/** Days to keep call audio, or null for forever. */
export function callRetentionDays(setting: unknown): number | null {
  if (setting === "Forever") return null;
  if (setting === "7 days") return 7;
  return 30;
}
