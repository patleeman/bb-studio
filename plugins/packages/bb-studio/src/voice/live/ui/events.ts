// Hands-free voice's wire events, both ways, on the desktop: GPT-Live, the
// Realtime API and the scripted mock (GPT-Live's events plus its own audio).
// The same shapes as the iPhone's (ios/iOS/VoiceLive/Core/LiveEvents.swift).

export type LiveProtocol = "live" | "realtime";

/** What the client hears from the voice model, the same for every protocol. */
export type LiveSignal =
  | { type: "started" }
  | { type: "userSpeechStarted" }
  | { type: "userText"; text: string }
  | { type: "userLine"; text: string }
  | { type: "agentText"; text: string }
  | { type: "agentLineDone" }
  | { type: "agentAudioStarted" }
  | { type: "agentAudioStopped" }
  | { type: "toolCall"; callId: string; name: string; arguments: string }
  | { type: "liveUsage"; seconds: number }
  | { type: "backendUsage"; input: number; cached: number; output: number }
  | { type: "realtimeUsage"; usage: unknown }
  | { type: "transcriptionUsage"; usage: unknown }
  | { type: "closed"; reason: string }
  | { type: "error"; message: string };

type Json = Record<string, unknown>;
const str = (value: unknown) => (typeof value === "string" ? value : "");
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

function toolCall(item: unknown): LiveSignal[] {
  const object = item as Json | undefined;
  if (!object || object.type !== "function_call") return [];
  return [{ type: "toolCall", callId: str(object.call_id), name: str(object.name), arguments: str(object.arguments) }];
}

/** One data-channel (or socket) message as signals. */
export function parseEvent(message: string | Json): LiveSignal[] {
  let event: Json;
  try { event = typeof message === "string" ? (JSON.parse(message) as Json) : message; } catch { return []; }
  switch (event.type) {
    // GPT-Live (and the mock)
    case "session.started": case "session.created": return [{ type: "started" }];
    case "session.input_transcript.delta": return [{ type: "userText", text: str(event.delta) }];
    case "session.output_transcript.delta": return [{ type: "agentText", text: str(event.delta) }];
    case "session.usage.updated": return [{ type: "liveUsage", seconds: num((event.usage as Json | undefined)?.seconds) }];
    case "session.closed": {
      const seconds = (event.usage as Json | undefined)?.seconds;
      return [...(typeof seconds === "number" ? [{ type: "liveUsage" as const, seconds }] : []), { type: "closed", reason: str(event.reason) }];
    }
    case "response.event": {
      const inner = event.event as Json | undefined;
      if (inner?.type === "response.output_item.done") return toolCall(inner.item);
      if (inner?.type === "response.completed") {
        const usage = (inner.response as Json | undefined)?.usage as Json | undefined;
        if (!usage) return [];
        return [{ type: "backendUsage", input: num(usage.input_tokens), cached: num((usage.input_tokens_details as Json | undefined)?.cached_tokens), output: num(usage.output_tokens) }];
      }
      return [];
    }
    // Realtime
    case "input_audio_buffer.speech_started": case "mock.user_speech_started": return [{ type: "userSpeechStarted" }];
    case "conversation.item.input_audio_transcription.delta": return [{ type: "userText", text: str(event.delta) }];
    case "conversation.item.input_audio_transcription.completed":
      return [{ type: "userLine", text: str(event.transcript) }, ...(event.usage ? [{ type: "transcriptionUsage" as const, usage: event.usage }] : [])];
    case "response.output_audio_transcript.delta": return [{ type: "agentText", text: str(event.delta) }];
    case "response.output_audio_transcript.done": case "mock.agent_line_done": return [{ type: "agentLineDone" }];
    case "output_audio_buffer.started": case "mock.audio.started": return [{ type: "agentAudioStarted" }];
    case "output_audio_buffer.stopped": case "output_audio_buffer.cleared": case "mock.audio.done": return [{ type: "agentAudioStopped" }];
    case "response.output_item.done": return toolCall(event.item);
    case "response.done": {
      const usage = (event.response as Json | undefined)?.usage;
      return usage ? [{ type: "realtimeUsage", usage }] : [];
    }
    case "error": return [{ type: "error", message: str((event.error as Json | undefined)?.message) || "The voice service sent an error." }];
    default: return [];
  }
}

/** What the client sends the voice model. */
export type LiveOutgoing =
  | { type: "toolResult"; callId: string; output: string }
  /** Spoken: a reply to say now. Not spoken: something to know (the interruption note). */
  | { type: "note"; text: string; spoken: boolean }
  | { type: "close" };

export function encodeOutgoing(outgoing: LiveOutgoing, protocol: LiveProtocol): Json[] {
  switch (outgoing.type) {
    case "toolResult": {
      const item = { type: "function_call_output", call_id: outgoing.callId, output: outgoing.output };
      return protocol === "live"
        ? [{ type: "response.item.create", item }, { type: "response.create" }]
        : [{ type: "conversation.item.create", item }, { type: "response.create" }];
    }
    case "note":
      if (protocol === "live") return [{ type: outgoing.spoken ? "session.commentary.append" : "session.thinking.append", delegation_id: null, content: outgoing.text }];
      return [
        { type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text: outgoing.text }] } },
        ...(outgoing.spoken ? [{ type: "response.create" }] : []),
      ];
    case "close": return protocol === "live" ? [{ type: "session.close" }] : [];
  }
}
