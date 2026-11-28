import Foundation

public struct BotMessageThread: Hashable, Sendable {
    public var threadId: String
    public var created: Bool
}

public struct ConversationModel: Hashable, Sendable {
    public var providerId: String?
    public var model: String?
    public var reasoningLevel: String?
    public var modelName: String?

    public var chip: String? {
        let name = [modelName, model].compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }.first { !$0.isEmpty }
        return name
    }
}

public enum ConversationReplies {
    public static let replyTitle = "Reply in thread"
    public static let forkTitle = "Fork conversation"

    public static func canThread(_ row: TimelineRow) -> Bool {
        row.isConversation && !row.isUser && !row.isPassReply && !row.id.hasPrefix("pending:")
            && !(row.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    public static func canFork(_ row: TimelineRow) -> Bool {
        guard canThread(row), let seq = row.sourceSeqEnd else { return false }
        return seq.isFinite && seq >= 0
    }

    /// "2 replies · Last reply 4:13 PM", "Replying…" while it works; nothing for an empty or failed thread.
    public static func indicator(_ thread: BotSideThread?, now: Date = .now) -> String? {
        guard let thread, !thread.isFork else { return nil }
        if thread.working { return "Replying…" }
        guard thread.replies > 0 else { return nil }
        let count = thread.replies == 1 ? "1 reply" : "\(thread.replies) replies"
        guard let lastReplyAt = thread.lastReplyAt else { return count }
        let at = Date(timeIntervalSince1970: lastReplyAt / 1000)
        let time = Calendar.current.isDate(at, inSameDayAs: now) ? at.formatted(date: .omitted, time: .shortened)
            : at.formatted(.dateTime.month(.abbreviated).day())
        return "\(count) · Last reply \(time)"
    }

    public enum Replier: Equatable, Sendable { case bot, you }

    public static func replier(_ thread: BotSideThread?) -> Replier? {
        switch thread?.lastReplyRole {
        case "assistant": .bot
        case "user": .you
        default: nil
        }
    }

    /// The message's reply thread; never a fork (Reply in thread doesn't continue a fork).
    public static func existing(_ threads: [String: BotSideThread], messageId: String) -> String? {
        guard let thread = threads[messageId], !thread.isFork else { return nil }
        return thread.threadId
    }

    /// "Forked here · 1 conversation", as desktop's line under the message.
    public static func forkIndicator(_ thread: BotSideThread?) -> String? {
        guard let fork = thread?.fork else { return nil }
        return "Forked here · " + (fork.conversations == 1 ? "1 conversation" : "\(fork.conversations) conversations")
    }
}

public struct WorkersLine: Equatable, Sendable {
    public var workers: [BotWorker]

    public init(conversationId: String, view: BotThreadsView?) {
        let mine = view?.workers(of: conversationId) ?? []
        let needs = mine.filter { $0.status == .needsYou }
        let running = mine.filter { $0.status == .running }
        workers = needs + running
    }

    public var count: Int { workers.count }
    public var isEmpty: Bool { workers.isEmpty }
    public var needsYou: Bool { workers.contains { $0.status == .needsYou } }
    public var running: Bool { workers.contains { $0.status == .running } }

    public var label: String { count == 1 ? "1 worker from here" : "\(count) workers from here" }
}

/// What deleting a conversation does on this server (`BBClient.deletePlan`).
public struct ConversationDeletePlan: Equatable, Sendable {
    /// The threads that go with it; nil when BB couldn't count them.
    public var workers: Int?
    /// Studio keeps it in Recently deleted this long; nil: BB deletes it for good.
    public var keepDays: Int?
    public var soft: Bool { keepDays != nil }

    public init(workers: Int?, keepDays: Int?) {
        self.workers = workers
        self.keepDays = keepDays
    }
}

/// A conversation in Studio's Recently deleted: BB deletes it for good at `purgeAt`.
public struct DeletedConversation: Equatable, Identifiable, Sendable {
    public var id: String { threadId }
    public var threadId: String
    public var title: String
    public var deletedAt: Double
    public var purgeAt: Double

    public init(threadId: String, title: String, deletedAt: Double, purgeAt: Double) {
        self.threadId = threadId
        self.title = title
        self.deletedAt = deletedAt
        self.purgeAt = purgeAt
    }

    init?(_ wire: Studio.BotDeletedOutputConversationsItem) {
        guard let threadId = wire.threadId, !threadId.isEmpty else { return nil }
        self.init(threadId: threadId, title: wire.title?.isEmpty == false ? wire.title! : "Untitled", deletedAt: wire.deletedAt ?? 0, purgeAt: wire.purgeAt ?? 0)
    }

    /// How long until BB deletes it for good, in whole days.
    public func left(now: Date = Date()) -> String {
        let days = Int(((purgeAt / 1000) - now.timeIntervalSince1970) / 86_400)
        switch days {
        case ..<1: return "Less than a day left"
        case 1: return "1 day left"
        default: return "\(days) days left"
        }
    }
}

public enum ConversationFinish {
    public static func can(_ conversation: BotConversation?) -> Bool {
        guard let conversation else { return false }
        return !conversation.isMain
    }

    public static func canRemove(_ conversation: BotConversation?, running: Bool = false) -> Bool {
        guard let conversation, can(conversation) else { return false }
        return !conversation.running && !running
    }

    public static func deleteTitle(_ title: String) -> String {
        "Delete “\(named(title))”?"
    }

    /// What the delete confirm says goes, and for how long. `workers` is nil
    /// when BB couldn't count them; `keepDays` is Studio's Recently deleted
    /// (nil: BB's own delete, for good).
    public static func deleteMessage(_ title: String, workers: Int?, keepDays: Int? = nil) -> String {
        let after = keepDays.map { "You can restore it from Archive for \($0) days." } ?? "This can't be undone."
        return "Deletes “\(named(title))”\(withWorkers(workers)). \(after)"
    }

    /// The pause before the confirm's Delete works: one tap can't delete.
    public static let deleteArmSeconds = 2

    private static func named(_ title: String) -> String { title.isEmpty ? "Untitled" : title }

    private static func withWorkers(_ workers: Int?) -> String {
        switch workers {
        case nil: " and any workers it started"
        case 0: ""
        case 1: " and its 1 worker"
        case let count?: " and its \(count) workers"
        }
    }

    public static let archiveHint = "Saves a summary to memory first"
}

extension BBClient {
    public func threadReply(threadId: String, messageId: String, sourceSeqEnd: Double?) async throws -> BotMessageThread {
        var input: [String: JSONValue?] = ["threadId": .string(threadId), "messageId": .string(messageId), "turnId": .null]
        if let sourceSeqEnd, sourceSeqEnd.isFinite, sourceSeqEnd >= 0 { input["sourceSeqEnd"] = .number(sourceSeqEnd.rounded()) }
        let output: Studio.BotThreadReplyOutput = try await rpc("studio", Studio.Method.bot_thread_reply, .object(omittingNil: input))
        guard let id = output.threadId, !id.isEmpty else { throw BBError(status: 200, message: "Studio didn't open a thread.") }
        return BotMessageThread(threadId: id, created: output.created ?? false)
    }

    public func forkConversation(threadId: String, messageId: String, sourceSeqEnd: Double) async throws -> String {
        let input: JSONValue = ["threadId": .string(threadId), "messageId": .string(messageId), "turnId": .null,
                                "sourceSeqEnd": .number(sourceSeqEnd.rounded())]
        let output: Studio.BotForkConversationOutput = try await rpc("studio", Studio.Method.bot_fork_conversation, input)
        guard let id = output.threadId, !id.isEmpty else { throw BBError(status: 200, message: "Studio didn't fork the conversation.") }
        return id
    }

    public func conversationModel(threadId: String) async throws -> ConversationModel? {
        struct Output: Decodable {
            struct Model: Decodable { var providerId: String?; var model: String?; var reasoningLevel: String?; var modelName: String? }
            var model: Model?
        }
        let output: Output = try await rpc("studio", Studio.Method.thread_model, ["threadId": .string(threadId)])
        return output.model.map { ConversationModel(providerId: $0.providerId, model: $0.model, reasoningLevel: $0.reasoningLevel, modelName: $0.modelName) }
    }

    /// How deleting the conversation goes here: Studio's soft delete when it
    /// has Recently deleted, else (an older Studio, or none: a 404) BB's own,
    /// for good. Studio not running (503) or refusing throws: a restart must
    /// never turn a recoverable delete into a permanent one.
    public func deletePlan(_ threadId: String) async throws -> ConversationDeletePlan {
        do {
            let output: Studio.BotDeletePreviewOutput = try await rpc("studio", Studio.Method.bot_delete_preview, ["threadId": .string(threadId)])
            return ConversationDeletePlan(workers: output.workers, keepDays: output.keepDays ?? 30)
        } catch where BBClient.isUnknownRPC(error) {
            return ConversationDeletePlan(workers: try? await deleteCascadeCount(threadId), keepDays: nil)
        }
    }

    /// Deletes the conversation as `plan` says: into Recently deleted, or for good with its child threads.
    public func deleteConversation(_ threadId: String, plan: ConversationDeletePlan) async throws {
        guard plan.soft else { return try await delete(threadId, withChildren: true) }
        let _: Studio.BotDeleteOutput = try await rpc("studio", Studio.Method.bot_delete, ["threadId": .string(threadId)])
    }

    /// The Bot's Recently deleted, newest first; nil when Studio has none (an older Studio).
    public func recentlyDeleted(botId: String?) async throws -> [DeletedConversation]? {
        do {
            let output: Studio.BotDeletedOutput = try await rpc("studio", Studio.Method.bot_deleted, .object(omittingNil: ["botId": botId.map(JSONValue.string)]))
            return (output.conversations ?? []).compactMap(DeletedConversation.init)
        } catch where BBClient.isUnknownRPC(error) {
            return nil
        }
    }

    public func restoreDeleted(threadId: String) async throws {
        let output: Studio.BotRestoreOutput = try await rpc("studio", Studio.Method.bot_restore, ["threadId": .string(threadId)])
        guard output.ok != false else { throw BBError(status: 200, message: "It didn't restore.") }
    }

    /// The threads BB's delete takes with the conversation: every visible
    /// thread below it (workers, their workers, side threads), archived too.
    public func deleteCascadeCount(_ threadId: String) async throws -> Int {
        struct Output: Decodable {
            struct Thread: Decodable { var threadId: String; var cascadeThreadIds: [String] }
            var threads: [Thread]
        }
        let output: Output = try await post("/api/v1/threads/cascade", ["threadIds": .array([.string(threadId)]), "action": "delete"])
        return output.threads.first { $0.threadId == threadId }?.cascadeThreadIds.count ?? 0
    }

    @discardableResult
    public func finishConversation(threadId: String) async throws -> String {
        struct Output: Decodable { var state: String? }
        let output: Output = try await rpc("studio", Studio.Method.bot_finish, ["threadId": .string(threadId)])
        return output.state ?? "finished"
    }

    public func botDefaultModel(botId: String) async throws -> ExecutionChoice? {
        struct Output: Decodable {
            struct Bot: Decodable {
                struct Model: Decodable { var providerId: String?; var model: String?; var reasoningLevel: String? }
                var defaultModel: Model?
            }
            var bot: Bot?
        }
        let output: Output = try await rpc("studio", Studio.Method.bot_get, ["botId": .string(botId)])
        return output.bot?.defaultModel.map { ExecutionChoice(providerId: $0.providerId, model: $0.model, reasoningLevel: $0.reasoningLevel) }
    }

    public func startConversation(botId: String, projectId: String, text: String, choice: ExecutionChoice,
                                  attachments: [JSONValue] = [], workspace: NewThreadWorkspace = .projectDefault) async throws -> String {
        var request = Self.studioExecutionRequest(projectId: projectId, text: text, mentions: [], choice: choice)
        if case .object(var fields) = request {
            if !attachments.isEmpty { fields["input"] = Self.input(text, attachments) }
            fields["environment"] = workspace.request
            request = .object(fields)
        }
        let output: Studio.BotConversationStartOutput = try await rpc("studio", Studio.Method.bot_conversation_start,
                                                                      ["botId": .string(botId), "request": request])
        guard let id = output.threadId, !id.isEmpty else { throw BBError(status: 200, message: "Studio didn't start the conversation.") }
        PhoneTurns.record(id, serverURL: baseURL)
        return id
    }

    public func startConversation(botId: String, projectId: String, text: String, attachments: [JSONValue] = []) async throws -> String {
        let preset = try? await botDefaultModel(botId: botId)
        let defaults = preset == nil ? (try? await projectDefaults(projectId)) ?? nil : nil
        var choice = preset ?? defaults ?? ExecutionChoice()
        if choice.permissionMode == nil { choice.permissionMode = defaults?.permissionMode }
        return try await startConversation(botId: botId, projectId: projectId, text: text, choice: choice, attachments: attachments)
    }
}
