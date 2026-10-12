import Foundation

/// What `thread_handoff_to_model` did: nothing, a switch on the same thread,
/// or a handoff to a new thread on another provider.
public enum ModelHandoffChange: String, Sendable {
    case unchanged
    case inPlace = "in-place"
    case handoff
}

public struct ModelHandoffResult: Decodable, Sendable {
    public var change: ModelHandoffChange
    /// The thread to follow: the new one after a handoff.
    public var threadId: String?

    enum CodingKeys: String, CodingKey { case change, threadId }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        change = ModelHandoffChange(rawValue: (try? c.decode(String.self, forKey: .change)) ?? "") ?? .unchanged
        threadId = try c.decodeIfPresent(String.self, forKey: .threadId)
    }
}

extension BBClient {
    /// Moves a thread to another provider's model (Studio's
    /// `thread_handoff_to_model`): BB can't change a thread's provider, so
    /// Studio starts a new thread with a handoff summary, carrying permissions
    /// forward (and, for a bot's thread, advancing the bot's chain).
    public func handoffToModel(_ threadId: String, providerId: String, model: String, reasoning: String?) async throws -> ModelHandoffResult {
        try await rpc("studio", "thread_handoff_to_model", .object(omittingNil: [
            "threadId": .string(threadId), "providerId": .string(providerId), "model": .string(model),
            "reasoning": reasoning.map(JSONValue.string),
        ]))
    }
}

/// The pure decisions behind the Model & Permissions sheet's provider choice.
public enum ModelHandoffPlan {
    /// Picking another provider than the thread's needs a handoff.
    public static func isHandoff(current: String?, chosen: String?) -> Bool {
        guard let current, let chosen, !chosen.isEmpty else { return false }
        return current != chosen
    }

    /// Providers to pick from: the available ones, plus the thread's own so it always shows.
    public static func providers(_ all: [ExecutionOptions.Provider], current: String?) -> [ExecutionOptions.Provider] {
        all.filter { $0.available != false || $0.id == current }
    }

    /// The permission modes to offer: the provider's, up to the machine's ceiling.
    public static func permissionModes(_ provider: ExecutionOptions.Provider?, ceiling: String?) -> [String] {
        PermissionMode.allowed(provider?.capabilities?.permissionModes ?? [], ceiling: ceiling)
    }

    /// While handing off: "Handing off to Codex…".
    public static func progressLabel(providerName: String) -> String { "Handing off to \(providerName)…" }

    /// After saving: "Switched to GPT-5", or nil when nothing changed.
    public static func doneLabel(_ change: ModelHandoffChange, modelName: String) -> String? {
        change == .unchanged ? nil : "Switched to \(modelName)"
    }

    /// The save button's title.
    public static func saveTitle(handoff: Bool) -> String { handoff ? "Hand off" : "Save" }

    /// Under the provider picker when it differs from the thread's.
    public static func handoffFooter(providerName: String) -> String {
        "Continues in a new \(providerName) thread with a summary of this one, which can take a minute. Permissions carry over."
    }
}
