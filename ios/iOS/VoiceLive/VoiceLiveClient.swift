import Foundation

/// Studio's hands-free voice RPCs (`voiceLive.*`, packages/bb-studio/src/voice/live/contract.ts).
typealias VoiceLiveState = Studio.VoiceLiveStateOutput
typealias VoiceLiveStart = Studio.VoiceLiveStartOutput
typealias VoiceLiveReply = Studio.VoiceLivePollOutputRepliesItem
typealias VoiceLiveToolResult = Studio.VoiceLiveToolOutput
typealias VoiceLiveIdentity = Studio.VoiceLiveStartOutputIdentity

extension BBClient {
    func voiceLiveState() async throws -> VoiceLiveState {
        try await rpc("studio", Studio.Method.voiceLive_state, .object([:]))
    }

    /// gpt-live-1 takes the SDP offer and answers with Studio's SDP answer; Realtime answers with a client secret.
    /// `threadId`: the launching thread, which the session speaks as; nil means the Chief of Staff.
    func voiceLiveStart(model: String?, sdp: String?, threadId: String?) async throws -> VoiceLiveStart {
        try await rpc("studio", Studio.Method.voiceLive_start, .object(omittingNil: ["model": model.map(JSONValue.string), "sdp": sdp.map(JSONValue.string), "threadId": threadId.map(JSONValue.string)]))
    }

    func voiceLiveTool(sessionId: String, name: String, arguments: String, reports: [LiveReport]) async throws -> VoiceLiveToolResult {
        try await rpc("studio", Studio.Method.voiceLive_tool, .object([
            "sessionId": .string(sessionId), "name": .string(name), "args": .string(arguments), "events": Self.json(reports),
        ]))
    }

    func voiceLiveEvent(sessionId: String, reports: [LiveReport]) async throws -> Studio.VoiceLiveEventOutput {
        try await rpc("studio", Studio.Method.voiceLive_event, .object(["sessionId": .string(sessionId), "events": Self.json(reports)]))
    }

    func voiceLivePoll(sessionId: String) async throws -> [VoiceLiveReply] {
        let result: Studio.VoiceLivePollOutput = try await rpc("studio", Studio.Method.voiceLive_poll, .object(["sessionId": .string(sessionId)]))
        return result.replies ?? []
    }

    func voiceLiveEnd(sessionId: String, reports: [LiveReport]) async throws {
        let _: JSONValue = try await rpc("studio", Studio.Method.voiceLive_end, .object(["sessionId": .string(sessionId), "events": Self.json(reports)]))
    }

    private static func json(_ reports: [LiveReport]) -> JSONValue {
        let objects = reports.map(\.object)
        guard let data = try? JSONSerialization.data(withJSONObject: objects),
              let value = try? JSONDecoder().decode(JSONValue.self, from: data) else { return .array([]) }
        return value
    }
}
