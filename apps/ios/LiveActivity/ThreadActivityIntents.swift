import ActivityKit
import AppIntents
import Foundation

// Buttons on a thread's Live Activity. iOS runs them in the app's process, so
// they answer without opening the app.

struct AnswerThreadIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Answer a BB thread"
    static let isDiscoverable = false

    @Parameter(title: "Thread") var threadId: String
    @Parameter(title: "Request") var interactionId: String
    /// A decision (`allow_once`, `deny`) or the index of a choice.
    @Parameter(title: "Answer") var answer: String

    init() {}

    init(threadId: String, interactionId: String, answer: String) {
        self.threadId = threadId
        self.interactionId = interactionId
        self.answer = answer
    }

    func perform() async throws -> some IntentResult {
        let client = BBClient()
        if let index = Int(answer) {
            let pending = try await client.interactions(threadId)
            guard let interaction = pending.first(where: { $0.id == interactionId }),
                let question = interaction.allQuestions?.first,
                let options = question.options, options.indices.contains(index)
            else { return .result() }
            try await client.settle(interaction, interaction.answer([question.id: InteractionAnswer(selected: [options[index].value])]))
        } else {
            try await client.resolve(threadId: threadId, interactionId: interactionId, decision: answer)
        }
        await ThreadActivity.answered(threadId, client: client)
        return .result()
    }
}

struct StopThreadIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Stop a BB thread"
    static let isDiscoverable = false

    @Parameter(title: "Thread") var threadId: String

    init() {}

    init(threadId: String) { self.threadId = threadId }

    func perform() async throws -> some IntentResult {
        try await BBClient().stop(threadId)
        return .result()
    }
}

enum ThreadActivity {
    /// Shows the thread working again until the mobile plugin catches up, and asks it to.
    static func answered(_ threadId: String, client: BBClient) async {
        for activity in Activity<BBThreadAttributes>.activities where activity.attributes.threadId == threadId {
            var state = activity.content.state
            state.ask = nil
            state.phase = "running"
            await activity.update(ActivityContent(state: state, staleDate: nil))
        }
        let _: JSONValue? = try? await client.rpc("mobile", "live_register", ["threadId": .string(threadId)])
    }
}
