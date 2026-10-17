import Foundation

/// Studio's voice mode (`voice.*`, packages/bb-studio/src/voice/contract.ts) and
/// speech settings (`speech.*`, src/speech/contract.ts).
public typealias VoiceModeState = Studio.VoiceStateOutput
public typealias SpeechSettings = Studio.SpeechStateOutput
public typealias SpeechModel = Studio.SpeechModelsOutputModelsItem

/// The `voice.*` and `speech.*` inputs, from the generated contract, as RPC bodies.
public enum VoiceRequests {
    public static func state(_ threadId: String) -> JSONValue { json(Studio.VoiceStateInput(threadId: threadId)) }

    public static func set(_ threadId: String, on: Bool) -> JSONValue { json(Studio.VoiceSetInput(threadId: threadId, on: on)) }

    public static func conversational(_ threadId: String, on: Bool) -> JSONValue {
        json(Studio.VoiceConversationalInput(threadId: threadId, on: on))
    }

    /// No project starts it in BB's personal project, as on desktop.
    public static func new(projectId: String?) -> JSONValue {
        projectId.map { json(Studio.VoiceNewInput(projectId: $0)) } ?? .object([:])
    }

    public static func prepare(_ text: String) -> JSONValue { json(Studio.SpeechPrepareInput(text: text)) }

    public static func update(engine: String? = nil, model: String? = nil, voice: String? = nil, speed: Double? = nil) -> JSONValue {
        .object(omittingNil: [
            "engine": engine.map(JSONValue.string),
            "model": model.map(JSONValue.string),
            "voice": voice.map(JSONValue.string),
            "speed": speed.map(JSONValue.number),
        ])
    }

    private static func json<T: Encodable>(_ value: T) -> JSONValue {
        (try? JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(value))) ?? .null
    }
}

extension BBClient {
    public func voiceState(_ threadId: String) async throws -> VoiceModeState {
        try await rpc("studio", Studio.Method.voice_state, VoiceRequests.state(threadId))
    }

    public func setVoice(_ threadId: String, on: Bool) async throws -> VoiceModeState {
        try await rpc("studio", Studio.Method.voice_set, VoiceRequests.set(threadId, on: on))
    }

    /// For every voice thread; the thread only names whose state comes back.
    public func setVoiceConversational(_ threadId: String, on: Bool) async throws -> VoiceModeState {
        try await rpc("studio", Studio.Method.voice_conversational, VoiceRequests.conversational(threadId, on: on))
    }

    /// A new voice chat: a thread on a fast model with voice mode on, whose agent greets you.
    public func newVoiceChat(projectId: String?) async throws -> String {
        let result: Studio.VoiceNewOutput = try await rpc("studio", Studio.Method.voice_new, VoiceRequests.new(projectId: projectId))
        guard let threadId = result.threadId else { throw BBError(status: 0, message: "Studio didn't start a voice chat.") }
        return threadId
    }

    public func speechSettings() async throws -> SpeechSettings {
        try await rpc("studio", Studio.Method.speech_state)
    }

    public func updateSpeech(_ input: JSONValue) async throws -> SpeechSettings {
        try await rpc("studio", Studio.Method.speech_update, input)
    }

    public func speechModels() async throws -> [SpeechModel] {
        let result: Studio.SpeechModelsOutput = try await rpc("studio", Studio.Method.speech_models)
        return result.models ?? []
    }

    /// An audio URL for one piece of text (cut it with `SpeechChunks` first). Fetching it makes the audio.
    public func prepareSpeech(_ text: String) async throws -> URL {
        let result: Studio.SpeechPrepareOutput = try await rpc("studio", Studio.Method.speech_prepare, VoiceRequests.prepare(text))
        guard let path = result.url, let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else {
            throw BBError(status: 0, message: "Studio didn't return audio for that text.")
        }
        return url
    }
}
