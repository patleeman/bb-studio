import Foundation

extension BBClient {
    public func studioHome(projectId: String? = nil) async throws -> Studio.HomeOutput {
        try await rpc("studio", Studio.Method.home, ["projectId": projectId.map(JSONValue.string) ?? .null])
    }

    public func respondToStudioNeed(threadId: String, interactionId: String, action: String, answer: String? = nil) async throws {
        let _: Studio.HomeRespondOutput = try await rpc("studio", Studio.Method.homeRespond, [
            "threadId": .string(threadId), "interactionId": .string(interactionId),
            "action": .string(action), "answer": answer.map(JSONValue.string) ?? .null,
        ])
    }

    public func studioSearchAll(_ query: String, projectId: String? = nil) async throws -> Studio.SearchAllOutput {
        try await rpc("studio", Studio.Method.searchAll, [
            "query": .string(String(query.prefix(200))),
            "projectId": projectId.map(JSONValue.string) ?? .null,
            "limit": .number(40),
        ])
    }

    public func taskStatuses(projectId: String?) async throws -> [Tasks.StatusesOutputColumnsItem] {
        let result: Tasks.StatusesOutput = try await rpc("studio-tasks", Tasks.Method.statuses, [
            "projectId": projectId.map(JSONValue.string) ?? .null,
        ])
        return result.columns ?? []
    }

    public func taskGenerated(_ id: String) async throws -> Tasks.GetOutput {
        try await rpc("studio-tasks", Tasks.Method.get, ["id": .string(id)])
    }

    public func taskSubtasks(_ id: String) async throws -> [Tasks.BoardOutputTasksItem] {
        let result: Tasks.BoardOutput = try await rpc("studio-tasks", Tasks.Method.board, ["includeArchived": .bool(false)])
        return (result.tasks ?? []).filter { $0.parentId == id }
    }

    public func updateTaskFields(_ id: String, priority: String, labels: [String], recurrence: String?, reminderAt: Date?) async throws {
        let _: Tasks.UpdateOutput = try await rpc("studio-tasks", Tasks.Method.update, [
            "id": .string(id), "priority": .string(priority),
            "labels": .array(labels.map(JSONValue.string)),
            "recurrence": recurrence.map(JSONValue.string) ?? .null,
            "reminderAt": reminderAt.map { .number($0.timeIntervalSince1970 * 1000) } ?? .null,
        ])
    }

    public func createSubtask(_ title: String, parentId: String, projectId: String?) async throws {
        let _: Tasks.CreateOutput = try await rpc("studio-tasks", Tasks.Method.create, [
            "title": .string(title), "parentId": .string(parentId),
            "projectId": projectId.map(JSONValue.string) ?? .null,
        ])
    }

    public func sendTaskToBot(_ id: String) async throws -> String {
        let result: Tasks.HandOffBotOutput = try await rpc("studio-tasks", Tasks.Method.handOffBot, [
            "id": .string(id), "note": .null,
        ])
        return result.roomId ?? ""
    }

    public func recordingNotes(_ id: String) async throws -> Talk.RecordingGetOutputRecordingMeetingNotes? {
        let result: Talk.RecordingGetOutput = try await rpc("talk", Talk.Method.recording_get, ["id": .string(id)])
        return result.recording?.meetingNotes
    }

    public func regenerateRecordingNotes(_ id: String) async throws {
        let _: Talk.MeetingRegenerateOutput = try await rpc("talk", Talk.Method.meeting_regenerate, ["id": .string(id)])
    }

    public func createTaskFromRecording(_ id: String, index: Int) async throws -> String {
        let result: Talk.MeetingCreateTaskOutput = try await rpc("talk", Talk.Method.meeting_create_task, [
            "id": .string(id), "index": .number(Double(index)),
        ])
        return result.taskId ?? ""
    }

    public func studioTable(_ id: String) async throws -> Tables.GetOutputTable? {
        let result: Tables.GetOutput = try await rpc("studio-tables", Tables.Method.get, ["id": .string(id)])
        return result.table
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
            "actor": ["kind": .string("user"), "id": .null, "name": .null], "body": .string(body),
        ])
    }

    public func resolveStudioComment(pluginId: String, id: String, commentId: String, resolved: Bool) async throws {
        let _: Studio.CommentResolveOutput = try await rpc("studio", Studio.Method.commentResolve, [
            "ref": ["pluginId": .string(pluginId), "id": .string(id)],
            "id": .string(commentId), "resolved": .bool(resolved),
        ])
    }
}
