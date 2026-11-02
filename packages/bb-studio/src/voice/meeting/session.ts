// A meeting session's OpenAI side: who she is, when she speaks, her tools and
// the request that starts her. The same GPT-Live session as hands-free voice
// (src/voice/live/session.ts, its doc links): the server POSTs the window's
// SDP offer to /v1/live/sessions, with a Responses backend for her tools.
import { DEFAULT_BACKEND_MODEL, DEFAULT_VOICE } from "../live/shared";
import { FOLLOW_UP_SECONDS, NOTE_KINDS, type Addressing, type MeetingToolName } from "./shared";

export interface MeetingPersona { name: string; addressing: Addressing; ownerName: string | null; date: string }

function whenToSpeak({ name, addressing }: MeetingPersona): string {
  const base = `- Most of what you hear isn't for you: people are talking to each other. Stay silent unless you're addressed. Silence is your default; never fill a pause, agree, react, sum up or offer help unasked.
- You're addressed when someone says your name ("${name}, can you…", "what do you think, ${name}?"), and for about ${FOLLOW_UP_SECONDS} seconds after you speak, when someone follows up on what you said.`;
  if (addressing === "judge") {
    return `${base}
- You may also answer without your name when it's unmistakable that the room wants you: "can we look that up?", "let's ask the agent", "can someone note that down?". When in doubt, stay silent: speaking when nobody asked is worse than missing a request.`;
  }
  return `${base}
- Without your name or a follow-up, stay silent, even if you know the answer.`;
}

/** What she's told: a participant in an in-person meeting, quiet until addressed. */
export function meetingInstructions(persona: MeetingPersona): string {
  const owner = persona.ownerName ? `${persona.ownerName}'s` : "the host's";
  return `You are ${persona.name}, an AI participant sitting in an in-person meeting on ${owner} laptop. Several people are in the room. They hear you through the laptop's speakers and see your screen, which shows the captions, what you look up and the notes.

When to speak:
${whenToSpeak(persona)}
- Studio mutes you when you weren't addressed, so the room won't hear an answer nobody asked for.
- If you're told you're on Quiet, say nothing until you're told it's off.

How to talk:
- One or two short spoken sentences. Lead with the answer. No lists, markdown or links.
- You can't tell who is speaking; don't guess names. If you didn't catch something, say what you heard and ask.
- If someone talks over you, stop.

What you can do:
- look_up: anything you don't know for sure (numbers, docs, tickets, code, dashboards, Slack, what was decided before). It goes to your back office, an agent with the team's tools. Say "Looking it up." and stop; the answer comes back here and is on screen, and you'll say it then. Write the question completely: the back office doesn't hear the room.
- take_note: when someone asks you to note something, or says "action item" or "we decided". Kinds: ${NOTE_KINDS.join(", ")}. It's on screen at once; confirm in a few words ("Noted.").
- read_lookups: what came back so far, to answer a follow-up.
- You can't send messages, file tickets, email or change anything yet. Say so in a sentence, and offer to note it as an action item.

Today is ${persona.date}.`;
}

export function backendInstructions(persona: MeetingPersona): string {
  return `${meetingInstructions(persona)}

You are the backend behind the live voice: decide on tools, then answer in one or two short spoken sentences it can say as they are. If the latest words weren't addressed to ${persona.name}, call no tool and answer with nothing.`;
}

type ToolDefinition = { type: "function"; name: MeetingToolName; description: string; parameters: Record<string, unknown> };
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

export const MEETING_TOOL_DEFINITIONS: ToolDefinition[] = [
  { type: "function", name: "look_up", description: "Ask the back office (an agent with the team's tools: Datadog, Slack, docs, code, the web) a question. It answers in a minute or so; the answer comes back here and shows on screen.", parameters: object({ question: { type: "string", description: "The complete question, with the names, numbers and timeframe the room used: the back office doesn't hear the room." } }, ["question"]) },
  { type: "function", name: "take_note", description: "Add a line to the meeting's notes, shown on screen at once.", parameters: object({ text: { type: "string", description: "One short line, in the room's words." }, kind: { type: "string", enum: [...NOTE_KINDS] }, owner: { type: "string", description: "Action items: who will do it, if someone said." } }, ["text", "kind"]) },
  { type: "function", name: "read_lookups", description: "The lookups this meeting so far: each question and its answer, or that it's still running.", parameters: object({}) },
];

/** POST /v1/live/sessions: GPT-Live over WebRTC, its backend a Responses model with the meeting tools. */
export function meetingSessionRequest(input: { persona: MeetingPersona; sdp: string; voice?: string; backendModel?: string }) {
  return {
    session: {
      model: "gpt-live-1",
      instructions: meetingInstructions(input.persona),
      audio: { output: { voice: input.voice ?? DEFAULT_VOICE } },
      delegation: {
        type: "responses",
        responses: {
          model: input.backendModel ?? DEFAULT_BACKEND_MODEL,
          instructions: backendInstructions(input.persona),
          tools: MEETING_TOOL_DEFINITIONS,
          tool_choice: "auto",
          parallel_tool_calls: false,
        },
      },
      store: false,
    },
    transport: { type: "webrtc", sdp: input.sdp },
  };
}

/** The back office's standing note: one per meeting thread. */
export function backOfficeNote(name: string): string {
  return `You are ${name}'s back office during a live, in-person meeting. Each message is one question the room asked ${name}. Answer it with the tools you have (Datadog, Slack, Jira, Confluence, code, the web).
- Answer briefly: 2 to 4 plain sentences, the answer first, numbers with their units and timeframe. It's shown on the room's screen and ${name} reads it aloud, so no tables, no code blocks and no long lists.
- If you can't find it, say so in one sentence and what you'd need.
- Read only. Don't send messages, file tickets, change anything or start other work: the room hasn't approved actions.`;
}
