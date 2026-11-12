// The RPCs behind meeting mode (src/voice/meeting/meeting.ts). The same flow
// as hands-free voice's (src/voice/live/contract.ts): start with the window's
// SDP offer, tools come back through meeting.tool, meeting.event reports
// transcripts and usage, meeting.poll picks up lookup answers, meeting.end
// hangs up. meeting.view is the stage's lookups and notes.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { liveEventSchema } from "../live/contract";
import { ADDRESSING, NOTE_KINDS } from "./shared";

const sessionId = z.string().regex(/^mt_[a-f0-9]{16}$/);

export const meetingViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  addressing: z.enum(ADDRESSING),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  durationMs: z.number(),
  costUsd: z.number().nullable(),
  transcript: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string(), at: z.number() })),
  lookups: z.array(z.object({ id: z.string(), question: z.string(), threadId: z.string().nullable(), status: z.enum(["running", "answered", "failed"]), answer: z.string().nullable(), at: z.number() })),
  notes: z.array(z.object({ id: z.number(), kind: z.enum(NOTE_KINDS), text: z.string(), owner: z.string().nullable(), at: z.number() })),
});

export const meetingContract = defineRpcContract({
  "meeting.state": {
    experimental_description: "Whether the meeting agent can start (an OpenAI key, under the monthly voice cap), her name and when she answers.",
    input: z.object({}).strict(),
    output: z.object({ ready: z.boolean(), problem: z.string().nullable(), model: z.string(), name: z.string(), addressing: z.enum(ADDRESSING), cosName: z.string() }),
  },
  "meeting.start": {
    experimental_description: "Start a meeting agent session: pass the WebRTC SDP offer; Studio creates the gpt-live-1 session and returns the answer.",
    input: z.object({ model: z.string().optional(), sdp: z.string().min(1).max(100_000).optional(), threadId: z.string().max(200).optional() }).strict(),
    output: z.object({
      sessionId: z.string(), model: z.string(), transport: z.enum(["live-webrtc", "mock"]),
      answerSdp: z.string().nullable(), clientSecret: z.null(), expiresAt: z.null(), callsUrl: z.null(),
      mockUrl: z.string().nullable(), voiceThreadId: z.null(), cosName: z.string(),
      name: z.string(), addressing: z.enum(ADDRESSING),
      identity: z.object({ kind: z.string(), label: z.string(), name: z.string(), threadId: z.null() }),
    }),
  },
  "meeting.tool": {
    experimental_description: "Run one of the meeting agent's tools (look_up, take_note, read_lookups). Saves `events` first. Returns the function_call_output text.",
    input: z.object({ sessionId, name: z.string().min(1).max(64), args: z.string().max(20_000).optional(), events: z.array(liveEventSchema).max(200).optional() }).strict(),
    output: z.object({ output: z.string() }),
  },
  "meeting.event": {
    experimental_description: "Report finished transcript lines, interruptions and usage. Returns the running cost, how many lookup answers wait for meeting.poll, and whether to stop (the monthly cap).",
    input: z.object({ sessionId, events: z.array(liveEventSchema).max(200) }).strict(),
    output: z.object({ costUsd: z.number().nullable(), replies: z.number().int(), stop: z.string().nullable(), voiceThreadId: z.null() }),
  },
  "meeting.poll": {
    experimental_description: "Lookup answers not yet picked up; each has the note that has her say it.",
    input: z.object({ sessionId }).strict(),
    output: z.object({ replies: z.array(z.object({ id: z.number().int(), title: z.string(), summary: z.string(), note: z.string() })) }),
  },
  "meeting.view": {
    experimental_description: "A meeting's transcript, lookups (running and answered) and notes, for the stage.",
    input: z.object({ sessionId }).strict(),
    output: meetingViewSchema,
  },
  "meeting.end": {
    experimental_description: "End the meeting: saves the last events and returns the whole meeting.",
    input: z.object({ sessionId, events: z.array(liveEventSchema).max(200).optional() }).strict(),
    output: meetingViewSchema,
  },
});
