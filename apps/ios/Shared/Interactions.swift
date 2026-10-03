import Foundation

// Pending interactions: approvals (commands, file edits, permissions, plans,
// tools) and ask-user questions. Mirrors `packages/domain/src/pending-interactions.ts`.

public struct PendingInteraction: Codable, Identifiable, Hashable, Sendable {
    public var id: String
    public var threadId: String
    public var status: String
    public var createdAt: Double?
    public var payload: InteractionPayload
    public var origin: Origin?

    public struct Origin: Codable, Hashable, Sendable {
        public var kind: String
        public var pluginId: String?
        public var rendererId: String?
    }

    /// Approvals, questions, and the ask-user-question and secrets plugin
    /// forms are answered natively; other plugin forms need the web app.
    public var isNative: Bool {
        payload.kind == "approval" || payload.kind == "user_question" || pluginQuestions != nil || secretRequest != nil
    }

    /// Core questions, or the ask-user-question plugin's.
    public var allQuestions: [InteractionQuestion]? { payload.questions ?? pluginQuestions }

    /// Which plugin form this is, for `kind: plugin` requests.
    public var rendererId: String? { payload.kind == "plugin" ? origin?.rendererId : nil }

    /// The ask-user-question plugin's questions, which share the core shape.
    public var pluginQuestions: [InteractionQuestion]? {
        guard rendererId == "ask-user-question", let questions = payload.data?["questions"] else { return nil }
        return questions.decoded()
    }

    /// The secrets plugin asking for credentials to write to a dotenv file.
    public var secretRequest: SecretRequest? {
        guard rendererId == "secret-request" else { return nil }
        return payload.data?.decoded()
    }
}

public struct SecretRequest: Decodable, Hashable, Sendable {
    public struct Destination: Decodable, Hashable, Sendable {
        public var kind: String
        public var path: String
    }

    public struct Field: Decodable, Hashable, Sendable {
        public var name: String
        public var description: String?
    }

    public var purpose: String?
    public var destination: Destination
    public var fields: [Field]
}

public struct InteractionPayload: Codable, Hashable, Sendable {
    public var kind: String
    // approval
    public var subject: ApprovalSubject?
    public var reason: String?
    public var availableDecisions: [String]?
    // user_question
    public var questions: [InteractionQuestion]?
    // plugin and extension kinds
    public var title: String?
    public var data: JSONValue?
}

public struct ApprovalSubject: Codable, Hashable, Sendable {
    public var kind: String
    public var command: String?
    public var cwd: String?
    public var writeScope: String?
    public var toolName: String?
    public var tool: String?
    public var plan: String?
    public var planFilePath: String?
    public var permissions: JSONValue?
    public var sessionGrant: JSONValue?
}

public struct InteractionQuestion: Codable, Hashable, Identifiable, Sendable {
    public struct Option: Codable, Hashable, Sendable {
        public var value: String
        public var label: String
        public var description: String?
    }

    public var id: String
    public var prompt: String
    public var shortLabel: String?
    public var multiSelect: Bool
    public var options: [Option]?
    public var allowFreeText: Bool
}

public struct InteractionAnswer: Hashable, Sendable {
    public var selected: [String] = []
    public var freeText = ""

    public init(selected: [String] = [], freeText: String = "") {
        self.selected = selected
        self.freeText = freeText
    }

    public var isEmpty: Bool { selected.isEmpty && freeText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
}

extension PendingInteraction {
    /// A one-line description for notifications, the watch, and the inbox.
    public var summary: String {
        switch payload.kind {
        case "approval":
            guard let subject = payload.subject else { return "Approval needed" }
            switch subject.kind {
            case "command": return "Run `\(subject.command ?? "command")`?"
            case "file_change": return "Edit files\(subject.writeScope.map { " in \($0)" } ?? "")?"
            case "permission_grant": return "Grant \(subject.toolName ?? "extra") permissions?"
            case "plan": return "Approve the plan?"
            case "tool_use": return "Use \(subject.tool ?? "a tool")?"
            default: return "Approval needed"
            }
        case "user_question":
            return payload.questions?.first?.prompt ?? "BB has a question"
        case "plugin" where pluginQuestions != nil:
            return pluginQuestions?.first?.prompt ?? payload.title ?? "BB has a question"
        default:
            return payload.title ?? "BB needs input"
        }
    }

    public var decisions: [String] { payload.availableDecisions ?? [] }

    /// Same rule as the web app's `buildPendingInteractionApprovalResolution`.
    public func approvalResolution(_ decision: String) -> JSONValue {
        guard decision != "deny" else { return ["decision": "deny"] }
        var granted: JSONValue = nil
        if let subject = payload.subject {
            if subject.kind == "permission_grant", let permissions = subject.permissions {
                let networkOn = permissions["network"]?["enabled"] == .bool(true)
                granted = [
                    "network": networkOn ? ["enabled": true] : nil,
                    "fileSystem": permissions["fileSystem"] ?? nil,
                ]
            } else if decision == "allow_for_session", subject.kind == "command" || subject.kind == "file_change" {
                granted = subject.sessionGrant ?? nil
            }
        }
        return ["decision": .string(decision), "grantedPermissions": granted]
    }

    /// Core questions resolve with `kind: user_answer`; the plugin's form
    /// responds with just the answers.
    public func answer(_ answers: [String: InteractionAnswer]) -> JSONValue {
        let resolution = Self.answerResolution(answers)
        return pluginQuestions != nil ? ["answers": resolution["answers"] ?? [:]] : resolution
    }

    public static func answerResolution(_ answers: [String: InteractionAnswer]) -> JSONValue {
        var object: [String: JSONValue] = [:]
        for (id, answer) in answers {
            var entry: [String: JSONValue] = ["selected": .array(answer.selected.map(JSONValue.string))]
            let text = answer.freeText.trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty { entry["freeText"] = .string(text) }
            object[id] = .object(entry)
        }
        return ["kind": "user_answer", "answers": .object(object)]
    }

    /// A free-text reply to every question, for the notification and watch reply box.
    public func textAnswer(_ text: String) -> JSONValue? {
        guard let questions = allQuestions, !questions.isEmpty else { return nil }
        var answers: [String: InteractionAnswer] = [:]
        for question in questions {
            if question.allowFreeText {
                answers[question.id] = InteractionAnswer(freeText: text)
            } else if let option = question.options?.first(where: {
                $0.label.localizedCaseInsensitiveCompare(text) == .orderedSame
                    || $0.value.localizedCaseInsensitiveCompare(text) == .orderedSame
            }) {
                answers[question.id] = InteractionAnswer(selected: [option.value])
            } else {
                return nil
            }
        }
        return answer(answers)
    }
}

public func approvalLabel(_ decision: String, subjectKind: String?) -> String {
    switch (decision, subjectKind) {
    case ("allow_once", "plan"): "Approve plan"
    case ("deny", "plan"): "Keep planning"
    case ("allow_once", _): "Allow"
    case ("allow_for_session", _): "Allow for session"
    case ("deny", _): "Deny"
    default: decision
    }
}

extension BBClient {
    public func interactions(_ threadId: String) async throws -> [PendingInteraction] {
        try await get("/api/v1/threads/\(threadId)/interactions")
    }

    @discardableResult
    public func resolve(_ interaction: PendingInteraction, _ resolution: JSONValue) async throws -> PendingInteraction {
        try await post("/api/v1/threads/\(interaction.threadId)/interactions/\(interaction.id)/resolve", resolution)
    }

    /// Plugin forms take the plugin's own response; everything else resolves.
    public func settle(_ interaction: PendingInteraction, _ value: JSONValue) async throws {
        if interaction.payload.kind == "plugin" {
            let _: JSONValue = try await post(
                "/api/v1/threads/\(interaction.threadId)/interactions/\(interaction.id)/respond", ["value": value])
        } else {
            _ = try await resolve(interaction, value)
        }
    }

    /// Declines a plugin form; the plugin sees it as cancelled.
    public func cancel(_ interaction: PendingInteraction) async throws {
        let _: JSONValue = try await post("/api/v1/threads/\(interaction.threadId)/interactions/\(interaction.id)/cancel")
    }

    /// Resolves by ids only, for notification actions that have no payload at hand.
    public func resolve(threadId: String, interactionId: String, decision: String) async throws {
        let interaction = try await pendingInteraction(threadId: threadId, interactionId: interactionId)
        guard interaction.payload.kind == "approval", interaction.decisions.contains(decision) else {
            throw BBError(status: 400, message: "That decision is not available for this request.")
        }
        try await resolve(interaction, interaction.approvalResolution(decision))
    }

    /// Never redirect an old notification's action onto a newer interaction.
    public func pendingInteraction(threadId: String, interactionId: String) async throws -> PendingInteraction {
        let pending = try await interactions(threadId)
        guard let interaction = pending.first(where: { $0.id == interactionId && $0.status == "pending" }) else {
            throw BBError(status: 404, message: "That request is no longer waiting in this thread.")
        }
        return interaction
    }
}
