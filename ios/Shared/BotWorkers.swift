import Foundation

public struct WorkerInfo: Equatable, Sendable {
    public enum WaitingOn: Equatable, Sendable { case approval, question }

    public struct Owner: Equatable, Sendable {
        public var threadId: String
        public var title: String
    }

    public var threadId: String
    public var title: String
    public var status: BotWorker.Status
    public var waitingOn: WaitingOn?
    public var botName: String
    public var owner: Owner?
    public var branch: String?
    public var updatedAt: Double?

    public init(threadId: String, title: String, status: BotWorker.Status, waitingOn: WaitingOn? = nil, botName: String,
                owner: Owner?, branch: String? = nil, updatedAt: Double? = nil) {
        self.threadId = threadId
        self.title = title
        self.status = status
        self.waitingOn = waitingOn
        self.botName = botName
        self.owner = owner
        self.branch = branch
        self.updatedAt = updatedAt
    }

    public init(_ worker: BotWorker, botName: String, mainThreadId: String?) {
        let owner: Owner? = if let id = worker.ownerConversationId, !id.isEmpty {
            Owner(threadId: id, title: worker.ownerTitle.flatMap { $0.isEmpty ? nil : $0 } ?? "Main")
        } else {
            mainThreadId.map { Owner(threadId: $0, title: "Main") }
        }
        self.init(threadId: worker.threadId, title: worker.title, status: worker.status, botName: botName, owner: owner,
                  branch: worker.branch.flatMap { $0.isEmpty ? nil : $0 }, updatedAt: worker.updatedAt > 0 ? worker.updatedAt : nil)
    }

    init?(_ wire: Studio.BotThreadInfoOutputInfo, mainThreadId: String?) {
        guard case .worker? = wire.kind, let threadId = wire.threadId, !threadId.isEmpty else { return nil }
        let status: BotWorker.Status = switch wire.status {
        case .running: .running
        case .needs_you: .needsYou
        case .failed: .failed
        case .done, nil: .done
        case .unknown(let value): .other(value)
        }
        let waitingOn: WaitingOn? = switch wire.waitingOn {
        case .approval: .approval
        case .question: .question
        case .unknown, nil: nil
        }
        let owner: Owner? = if let id = wire.owner?.threadId, !id.isEmpty {
            Owner(threadId: id, title: wire.owner?.title.flatMap { $0.isEmpty ? nil : $0 } ?? "Main")
        } else {
            mainThreadId.map { Owner(threadId: $0, title: "Main") }
        }
        self.init(threadId: threadId, title: wire.title ?? "", status: status, waitingOn: waitingOn,
                  botName: wire.botName.flatMap { $0.isEmpty ? nil : $0 } ?? BotInfo.defaultName, owner: owner,
                  branch: wire.branch.flatMap { $0.isEmpty ? nil : $0 })
    }

    public static func merged(seed: WorkerInfo?, fetched: WorkerInfo?) -> WorkerInfo? {
        guard var out = seed ?? fetched else { return nil }
        guard let seed, let fetched else { return out }
        out.waitingOn = seed.status == .needsYou ? fetched.waitingOn : nil
        if out.title.isEmpty { out.title = fetched.title }
        if out.branch == nil { out.branch = fetched.branch }
        if out.owner == nil { out.owner = fetched.owner }
        return out
    }

    public var displayTitle: String { title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Worker" : title }

    public var stateLabel: String {
        switch status {
        case .running: "Running"
        case .failed: "Failed"
        case .needsYou:
            switch waitingOn {
            case .approval: "Waiting for your approval"
            case .question: "Waiting on an answer"
            case nil: "Waiting for you"
            }
        case .done: "Done"
        case .other: "Worker"
        }
    }

    public func headerLabel(now: Date = .now) -> String {
        guard let updatedAt, status != .done else { return stateLabel }
        return stateLabel + " · " + WorkerInfo.age(updatedAt, now: now)
    }

    public var askTarget: String { "Sends to \(botName) in \(owner?.title ?? "Main")" }

    public var canAnswerHere: Bool { status == .needsYou && waitingOn == .question }

    public static let askPlaceholder = "Ask the Bot about this worker…"

    public static func canAsk(_ text: String, busy: Bool) -> Bool {
        !busy && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    public static func shownInteractions(_ interactions: [PendingInteraction], worker: WorkerInfo?, answering: Bool) -> [PendingInteraction] {
        guard let worker else { return interactions }
        guard answering, worker.canAnswerHere else { return [] }
        return interactions.filter { $0.payload.kind != "approval" }
    }

    static func age(_ at: Double, now: Date) -> String {
        let minutes = max(0, now.timeIntervalSince1970 * 1000 - at) / 60_000
        if minutes < 1 { return "now" }
        if minutes < 60 { return "\(Int(minutes))m" }
        if minutes < 1440 { return "\(Int(minutes / 60))h" }
        if minutes < 10_080 { return "\(Int(minutes / 1440))d" }
        return "\(Int(minutes / 10_080))w"
    }
}

public struct WorkerAsked: Equatable, Sendable {
    public var conversationId: String
    public var projectId: String?
}

extension BBClient {
    public func workerInfo(threadId: String, mainThreadId: String?) async throws -> WorkerInfo? {
        let output: Studio.BotThreadInfoOutput = try await rpc("studio", Studio.Method.bot_thread_info, ["threadId": .string(threadId)])
        return output.info.flatMap { WorkerInfo($0, mainThreadId: mainThreadId) }
    }

    public func askAboutWorker(threadId: String, text: String) async throws -> WorkerAsked {
        let message = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty else { throw BBError(status: 0, message: "Type a question first.") }
        let output: Studio.BotWorkerAskOutput = try await rpc("studio", Studio.Method.bot_worker_ask,
                                                              ["threadId": .string(threadId), "text": .string(message)])
        guard let id = output.conversationId, !id.isEmpty else { throw BBError(status: 200, message: "Studio didn't say where it asked.") }
        return WorkerAsked(conversationId: id, projectId: output.projectId)
    }
}
