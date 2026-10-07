// The wire contract between the Talk frontend and server. Both schemas run at
// the RPC boundary; the frontend imports only the types.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { modelSelectionSchema } from "@bb-studio/kit/decisions-contract";

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

export const rpcContract = defineRpcContract({
  "models.get": { input: z.null(), output: modelPreferencesSchema },
  "models.set": {
    input: z.object({ purpose: modelPurposeSchema, selection: modelSelectionSchema.nullable() }).strict(),
    output: modelPreferencesSchema,
  },
  "models.suggest": { input: z.null(), output: modelSelectionSchema.nullable() },
  recordings_list: {
    input: z.object({
      query: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    output: z.object({ recordings: z.array(recordingSchema) }),
  },
  recording_get: {
    input: z.object({ id: recordingId }),
    output: z.object({ recording: recordingSchema, segments: z.array(segmentSchema) }),
  },
  recording_create: {
    input: z.object({
      kind: recordingKindSchema,
      projectId: z.string().max(64).nullable(),
      threadId: z.string().max(64).nullable(),
    }),
    output: recordingSchema,
  },
  recording_rename: {
    input: z.object({ id: recordingId, title: z.string().trim().min(1).max(160) }),
    output: recordingSchema,
  },
  /** Capture state transitions reported by the capturing client. */
  recording_state: {
    input: z.object({
      id: recordingId,
      status: z.enum(["recording", "paused", "finishing"]),
    }),
    output: recordingSchema,
  },
  recording_heartbeat: {
    input: z.object({ id: recordingId }),
    output: z.object({ status: recordingStatusSchema.nullable() }),
  },
  segment_put: {
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
  recording_retry: {
    input: z.object({ id: recordingId }),
    output: recordingSchema,
  },
  meeting_regenerate: {
    input: z.object({ id: recordingId }),
    output: z.object({ recording: recordingSchema }),
  },
  /** Whether Studio Pages is there to hold notes. */
  notes_status: {
    input: z.null(),
    output: z.object({ pagesAvailable: z.boolean() }),
  },
  /** Writes the recording's notes page, or updates the one it has. */
  notes_make: {
    input: z.object({ id: recordingId }),
    output: z.object({ recording: recordingSchema, pageId: z.string(), created: z.boolean() }),
  },
  /** A finished dictation's transcript, tidied for inserting; null keeps the raw text. */
  dictation_cleanup: {
    input: z.object({ id: recordingId }),
    output: z.object({ text: z.string().nullable() }),
  },
  /** Cleans one finished segment so long recordings keep their audio alignment. */
  recording_cleanup: {
    input: z.object({ id: recordingId, segmentId: z.string().min(1).max(100) }),
    output: z.object({ text: z.string() }),
  },
  /** Turns a dictation into a recording: out of the background, titled, with optional summarization. */
  recording_keep: {
    input: z.object({ id: recordingId }),
    output: recordingSchema,
  },
  recording_delete: {
    input: z.object({ id: recordingId }),
    output: z.object({ deleted: z.boolean() }),
  },
});
export type TalkRpcContract = typeof rpcContract;
