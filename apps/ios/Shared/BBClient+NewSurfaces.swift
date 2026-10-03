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

    public func taskStatuses(projectId: String?) async throws -> [Studio.TasksStatusesOutputColumnsItem] {
        let result: Studio.TasksStatusesOutput = try await rpc("studio", Studio.Method.tasks_statuses, [
            "projectId": projectId.map(JSONValue.string) ?? .null,
        ])
        return result.columns ?? []
    }

    public func taskGenerated(_ id: String) async throws -> Studio.TasksGetOutput {
        try await rpc("studio", Studio.Method.tasks_get, ["id": .string(id)])
    }

    public func taskSubtasks(_ id: String) async throws -> [Studio.TasksBoardOutputTasksItem] {
        let result: Studio.TasksBoardOutput = try await rpc("studio", Studio.Method.tasks_board, ["includeArchived": .bool(false)])
        return (result.tasks ?? []).filter { $0.parentId == id }
    }

    public func updateTaskFields(_ id: String, priority: String, labels: [String], recurrence: String?, reminderAt: Date?) async throws {
        let _: Studio.TasksUpdateOutput = try await rpc("studio", Studio.Method.tasks_update, [
            "id": .string(id), "priority": .string(priority),
            "labels": .array(labels.map(JSONValue.string)),
            "recurrence": recurrence.map(JSONValue.string) ?? .null,
            "reminderAt": reminderAt.map { .number(($0.timeIntervalSince1970 * 1000).rounded()) } ?? .null,
        ])
    }

    public func createSubtask(_ title: String, parentId: String, projectId: String?) async throws {
        let _: Studio.TasksCreateOutput = try await rpc("studio", Studio.Method.tasks_create, [
            "title": .string(title), "parentId": .string(parentId),
            "projectId": projectId.map(JSONValue.string) ?? .null,
        ])
    }

    public func sendTaskToBot(_ id: String) async throws -> String {
        let result: Studio.TasksHandOffBotOutput = try await rpc("studio", Studio.Method.tasks_handOffBot, [
            "id": .string(id), "note": .null,
        ])
        return result.threadId ?? ""
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

    public func studioTable(_ id: String) async throws -> Studio.TablesGetOutputTable? {
        let result: Studio.TablesGetOutput = try await rpc("studio", Studio.Method.tables_get, ["id": .string(id)])
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
