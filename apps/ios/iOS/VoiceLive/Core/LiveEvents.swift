import Foundation

// Hands-free voice's wire events, both ways, for GPT-Live, the Realtime API
// and the scripted mock (which speaks GPT-Live's events plus its own audio).
// No app imports: this folder builds on its own in Swift 6
// (scripts/check-voice-live-swift6.sh).

/// Which protocol the data channel speaks.
enum LiveProtocol: String, Sendable {
    /// gpt-live-1: session.* events; tools arrive from its Responses backend inside response.event.
    case live
    /// gpt-realtime-2.1: conversation and response events, server VAD.
    case realtime
}

/// What the phone hears from the voice model, the same for every protocol.
enum LiveSignal: Equatable, Sendable {
    case started
    /// Realtime's server VAD heard speech start (or the mock says so); Live has no such event.
    case userSpeechStarted
    case userText(String)
    /// A finished user line (Realtime's transcription); Live's lines end on a pause.
    case userLine(String)
    case agentText(String)
    case agentLineDone
    case agentAudioStarted
    case agentAudioStopped
    case toolCall(callId: String, name: String, arguments: String)
    case liveUsage(seconds: Double)
    case backendUsage(input: Int, cached: Int, output: Int)
    /// Realtime usage, as OpenAI's JSON (Studio prices it).
    case realtimeUsage(json: String)
    case transcriptionUsage(json: String)
    case closed(reason: String)
    case error(String)
}

/// Turns one data-channel message into signals.
enum LiveEventParser {
    static func parse(_ data: Data) -> [LiveSignal] {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = object["type"] as? String else { return [] }
        return parse(type: type, object)
    }

    private static func string(_ value: Any?) -> String { value as? String ?? "" }
    private static func int(_ value: Any?) -> Int { (value as? NSNumber)?.intValue ?? 0 }
    private static func json(_ value: Any?) -> String {
        guard let value, JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) else { return "{}" }
        return String(decoding: data, as: UTF8.self)
    }

    private static func toolCall(_ item: [String: Any]?) -> [LiveSignal] {
        guard let item, string(item["type"]) == "function_call" else { return [] }
        return [.toolCall(callId: string(item["call_id"]), name: string(item["name"]), arguments: string(item["arguments"]))]
    }

    private static func parse(type: String, _ object: [String: Any]) -> [LiveSignal] {
        switch type {
        // GPT-Live (and the mock)
        case "session.started", "session.created": return [.started]
        case "session.input_transcript.delta": return [.userText(string(object["delta"]))]
        case "session.output_transcript.delta": return [.agentText(string(object["delta"]))]
        case "session.usage.updated":
            let usage = object["usage"] as? [String: Any]
            return [.liveUsage(seconds: (usage?["seconds"] as? NSNumber)?.doubleValue ?? 0)]
        case "session.closed":
            let usage = object["usage"] as? [String: Any]
            let seconds = (usage?["seconds"] as? NSNumber)?.doubleValue
            return (seconds.map { [LiveSignal.liveUsage(seconds: $0)] } ?? []) + [.closed(reason: string(object["reason"]))]
        case "response.event":
            // Live's backend: nested Responses events.
            guard let event = object["event"] as? [String: Any] else { return [] }
            switch string(event["type"]) {
            case "response.output_item.done": return toolCall(event["item"] as? [String: Any])
            case "response.completed":
                let usage = (event["response"] as? [String: Any])?["usage"] as? [String: Any]
                let cached = (usage?["input_tokens_details"] as? [String: Any])?["cached_tokens"]
                return usage == nil ? [] : [.backendUsage(input: int(usage?["input_tokens"]), cached: int(cached), output: int(usage?["output_tokens"]))]
            default: return []
            }
        // Realtime
        case "input_audio_buffer.speech_started", "mock.user_speech_started": return [.userSpeechStarted]
        case "conversation.item.input_audio_transcription.delta": return [.userText(string(object["delta"]))]
        case "conversation.item.input_audio_transcription.completed":
            var signals: [LiveSignal] = [.userLine(string(object["transcript"]))]
            if let usage = object["usage"] { signals.append(.transcriptionUsage(json: json(usage))) }
            return signals
        case "response.output_audio_transcript.delta": return [.agentText(string(object["delta"]))]
        case "response.output_audio_transcript.done", "mock.agent_line_done": return [.agentLineDone]
        case "output_audio_buffer.started", "mock.audio.started": return [.agentAudioStarted]
        case "output_audio_buffer.stopped", "output_audio_buffer.cleared", "mock.audio.done": return [.agentAudioStopped]
        case "response.output_item.done": return toolCall(object["item"] as? [String: Any])
        case "response.done":
            guard let usage = (object["response"] as? [String: Any])?["usage"] else { return [] }
            return [.realtimeUsage(json: json(usage))]
        case "error":
            let error = object["error"] as? [String: Any]
            return [.error(string(error?["message"]).isEmpty ? "The voice service sent an error." : string(error?["message"]))]
        default: return []
        }
    }
}

/// What the phone sends the voice model.
enum LiveOutgoing: Equatable, Sendable {
    /// A tool's result, then carry on.
    case toolResult(callId: String, output: String)
    /// Context from Studio. Spoken: a reply to say now. Not spoken: something to know (the interruption note).
    case note(String, spoken: Bool)
    /// Graceful hang-up (Live waits for session.closed with final usage).
    case close

    /// The data-channel messages, in order.
    func messages(_ protocol: LiveProtocol) -> [[String: Any]] {
        switch (self, `protocol`) {
        case (.toolResult(let callId, let output), .live):
            return [["type": "response.item.create", "item": ["type": "function_call_output", "call_id": callId, "output": output]],
                    ["type": "response.create"]]
        case (.toolResult(let callId, let output), .realtime):
            return [["type": "conversation.item.create", "item": ["type": "function_call_output", "call_id": callId, "output": output]],
                    ["type": "response.create"]]
        case (.note(let text, let spoken), .live):
            return [["type": spoken ? "session.commentary.append" : "session.thinking.append", "delegation_id": NSNull(), "content": text]]
        case (.note(let text, let spoken), .realtime):
            let item: [String: Any] = ["type": "conversation.item.create", "item": ["type": "message", "role": "system", "content": [["type": "input_text", "text": text]]]]
            return spoken ? [item, ["type": "response.create"]] : [item]
        case (.close, .live): return [["type": "session.close"]]
        case (.close, .realtime): return []
        }
    }

    func encoded(_ protocol: LiveProtocol) -> [Data] {
        messages(`protocol`).compactMap { try? JSONSerialization.data(withJSONObject: $0, options: [.sortedKeys]) }
    }
}
