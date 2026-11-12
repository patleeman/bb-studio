import Foundation

public struct WorkerApproval: Equatable, Sendable, Identifiable {
    public enum State: String, Equatable, Sendable {
        case pending, resolving, approved, denied, gone
        case approvedSession = "approved-session"

        public var waiting: Bool { self == .pending || self == .resolving }

        public var settledLabel: String? {
            switch self {
            case .approved: "Approved"
            case .approvedSession: "Approved for this worker"
            case .denied: "Denied"
            case .gone: "No longer waiting"
            case .pending, .resolving: nil
            }
        }
    }

    public enum Decision: String, Equatable, Sendable, CaseIterable {
        case deny
        case allowForSession = "allow_for_session"
        case allowOnce = "allow_once"

        public var label: String {
            switch self {
            case .deny: "Deny"
            case .allowForSession: "Approve for this worker"
            case .allowOnce: "Approve"
            }
        }

        public var decided: State {
            switch self {
            case .deny: .denied
            case .allowForSession: .approvedSession
            case .allowOnce: .approved
            }
        }
    }

    public struct Worker: Equatable, Sendable {
        public var threadId: String
        public var title: String
    }

    public var worker: Worker
    public var interactionId: String
    public var state: State
    public var title: String
    public var short: String
    public var lines: [String]
    public var decisions: [Decision]

    public var id: String { "\(worker.threadId):\(interactionId)" }

    public init(worker: Worker, interactionId: String, state: State = .pending, title: String, short: String = "",
                lines: [String] = [], decisions: [Decision] = [.deny, .allowOnce]) {
        self.worker = worker
        self.interactionId = interactionId
        self.state = state
        self.title = title
        self.short = short
        self.lines = lines
        self.decisions = Decision.allCases.filter(decisions.contains)
    }

    init?(_ wire: Studio.BotConversationApprovalsOutputApprovalsItem) {
        guard let threadId = wire.worker?.threadId, !threadId.isEmpty, let approval = wire.approval,
              let id = approval.id, !id.isEmpty else { return nil }
        let state: State = switch approval.state {
        case .pending, nil: .pending
        case .resolving: .resolving
        case .approved: .approved
        case .approved_session: .approvedSession
        case .denied: .denied
        case .gone, .unknown: .gone
        }
        let decisions: [Decision] = (approval.decisions ?? []).compactMap {
            switch $0 {
            case .allow_once: .allowOnce
            case .allow_for_session: .allowForSession
            case .deny: .deny
            case .unknown: nil
            }
        }
        let title = wire.worker?.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        self.init(worker: Worker(threadId: threadId, title: title.isEmpty ? "Worker" : title), interactionId: id, state: state,
                  title: approval.title.flatMap { $0.isEmpty ? nil : $0 } ?? "Approve an action", short: approval.short ?? "",
                  lines: approval.lines ?? [], decisions: decisions)
    }

    public var askLine: String { state.waiting ? "asks for your approval" : "asked for approval" }

    public var detail: String? { lines.isEmpty ? nil : lines.joined(separator: "\n") }

    public static func failure(_ error: Error, server: URL) -> String {
        let reason = BBClient.describe(error, plugin: "Studio", server: server)
        guard BBClient.neverArrived(error) else { return reason }
        return "Not sent. \(reason) Try again once BB is reachable."
    }
}

extension BBClient {
    public func conversationApprovals(threadId: String) async throws -> [WorkerApproval] {
        let output: Studio.BotConversationApprovalsOutput = try await rpc("studio", Studio.Method.bot_conversation_approvals,
                                                                          ["threadId": .string(threadId)])
        return (output.approvals ?? []).compactMap(WorkerApproval.init)
    }

    public func resolveWorkerApproval(workerThreadId: String, interactionId: String,
                                      decision: WorkerApproval.Decision) async throws -> WorkerApproval.State {
        let output: Studio.BotWorkerApprovalResolveOutput = try await rpc(
            "studio", Studio.Method.bot_worker_approval_resolve,
            ["threadId": .string(workerThreadId), "interactionId": .string(interactionId), "decision": .string(decision.rawValue)])
        let state: WorkerApproval.State? = switch output.approval?.state {
        case .approved: .approved
        case .approved_session: .approvedSession
        case .denied: .denied
        case .gone: .gone
        case .pending, .resolving, .unknown, nil: nil
        }
        return state ?? decision.decided
    }
}
