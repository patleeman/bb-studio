import Foundation

extension BBClient {
    /// Searches every project unless one is given; a null projectId would mean global items only.
    public func studioSearchAll(_ query: String, projectId: String? = nil) async throws -> Studio.SearchAllOutput {
        try await rpc("studio", Studio.Method.searchAll, .object(omittingNil: [
            "query": .string(String(query.prefix(200))),
            "projectId": projectId.map(JSONValue.string),
            "limit": .number(40),
        ]))
    }

    public func recordingNotes(_ id: String) async throws -> Talk.RecordingGetOutputRecordingMeetingNotes? {
        let result: Talk.RecordingGetOutput = try await rpc("talk", Talk.Method.recording_get, ["id": .string(id)])
        return result.recording?.meetingNotes
    }

    public func regenerateRecordingNotes(_ id: String) async throws {
        let _: Talk.MeetingRegenerateOutput = try await rpc("talk", Talk.Method.meeting_regenerate, ["id": .string(id)])
    }

    public func studioLinks(pluginId: String, id: String) async throws -> Studio.LinksOutput {
        try await rpc("studio", Studio.Method.links, ["ref": ["pluginId": .string(pluginId), "id": .string(id)]])
    }

    public func studioItemThreads(pluginId: String, id: String) async throws -> Studio.ItemThreadsOutput {
        try await rpc("studio", Studio.Method.itemThreads, ["ref": ["pluginId": .string(pluginId), "id": .string(id)]])
    }

    public func studioComments(pluginId: String, id: String) async throws -> Studio.CommentsOutput {
        try await rpc("studio", Studio.Method.comments, ["ref": ["pluginId": .string(pluginId), "id": .string(id)]])
    }

    public func replyToStudioComment(pluginId: String, id: String, parentId: String, body: String) async throws {
        let _: Studio.CommentCreateOutput = try await rpc("studio", Studio.Method.commentCreate, [
            "ref": ["pluginId": .string(pluginId), "id": .string(id)],
            "parentId": .string(parentId), "anchor": .null,
            "actor": ["kind": .string("user")], "body": .string(body),
        ])
    }

    public func resolveStudioComment(pluginId: String, id: String, commentId: String, resolved: Bool) async throws {
        let _: Studio.CommentResolveOutput = try await rpc("studio", Studio.Method.commentResolve, [
            "ref": ["pluginId": .string(pluginId), "id": .string(id)],
            "id": .string(commentId), "resolved": .bool(resolved),
        ])
    }
}
