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

public enum ConversationFinish {
    public static func can(_ conversation: BotConversation?) -> Bool {
        guard let conversation else { return false }
        return !conversation.isMain
    }
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
                                  attachments: [JSONValue] = []) async throws -> String {
        var request = Self.studioExecutionRequest(projectId: projectId, text: text, mentions: [], choice: choice)
        if !attachments.isEmpty, case .object(var fields) = request {
            fields["input"] = Self.input(text, attachments)
            request = .object(fields)
        }
        let output: Studio.BotConversationStartOutput = try await rpc("studio", Studio.Method.bot_conversation_start,
                                                                      ["botId": .string(botId), "request": request])
        guard let id = output.threadId, !id.isEmpty else { throw BBError(status: 200, message: "Studio didn't start the conversation.") }
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
