import Foundation
import Observation

/// One Bot's Memory as the page shows it: what each layer loaded, and the
/// edits. One store backs every view of the page, so the unfolded Duo's two
/// screens (Core, and Skills | History) show the same state.
@MainActor @Observable
final class MemoryStore {
    let botId: String?
    @ObservationIgnored let client: BBClient
    let core = PageLoad<MemoryCore>()
    let skills = PageLoad<[MemorySkill]>()
    let learning = PageLoad<SkillLearning>()
    let summaries = PageLoad<[HistorySummary]>()
    let conversations = PageLoad<[PastConversation]>()
    /// An action's failure (Auto-learn, Run now, a revert), shown once.
    var notice: String?
    var busy = false

    init(botId: String?, client: BBClient) {
        self.botId = botId
        self.client = client
        let describe: (Error) -> String = { BBClient.describe($0, server: client.baseURL) }
        core.describe = describe
        skills.describe = describe
        learning.describe = describe
        summaries.describe = describe
        conversations.describe = describe
    }

    private var scope: String { "\(client.baseURL.absoluteString)|\(botId ?? "")" }

    func loadCore(force: Bool = false) {
        let (client, botId) = (client, botId)
        if force, core.key == scope { return core.retry() }
        core.run(key: scope) { try await client.memoryCore(botId: botId) }
    }

    func loadSkills(force: Bool = false) {
        let (client, botId) = (client, botId)
        if force, skills.key == scope { skills.retry(); learning.retry(); return }
        skills.run(key: scope) { try await client.memorySkills(botId: botId) }
        learning.run(key: scope) { try await client.memoryLearning(botId: botId) }
    }

    func loadHistory(force: Bool = false) {
        let (client, botId) = (client, botId)
        if force, summaries.key == scope { summaries.retry(); conversations.retry(); return }
        summaries.run(key: scope) { try await client.memorySummaries(botId: botId) }
        conversations.run(key: scope) { try await client.memoryConversations(botId: botId) }
    }

    func refresh(_ layer: MemoryLayer) async {
        switch layer {
        case .core:
            loadCore(force: true)
            await core.settle()
        case .skills:
            loadSkills(force: true)
            await skills.settle()
            await learning.settle()
        case .history:
            loadHistory(force: true)
            await summaries.settle()
            await conversations.settle()
        }
    }

    // MARK: Core

    /// Saves one core section (or a whole other always-on skill, `section` nil) without overwriting the Bot's edit.
    func saveCore(skill: String, section: String?, base: String, text: String) async -> SaveResult {
        let (client, botId) = (client, botId)
        let result = await Self.attempt {
            try await MemorySave.save(section: section, base: base, text: text, read: {
                try await client.memoryCore(botId: botId).skills.first { $0.name == skill }.map { .init(description: $0.description, body: $0.body) }
            }, write: { description, body, ifBody in
                try await client.memoryWriteSkill(botId: botId, name: skill, description: description, body: body, ifBody: .string(ifBody))
            })
        }
        if result == .saved { loadCore(force: true) }
        return result
    }

    // MARK: Skills

    /// Saves a skill's description and text over the text the edit began from.
    func saveSkill(name: String, base: String, description: String, body: String) async -> SaveResult {
        let (client, botId) = (client, botId)
        let result = await Self.attempt {
            try await MemorySave.save(section: nil, base: base, text: body, description: description, read: {
                guard let skill = try await client.memorySkills(botId: botId).first(where: { $0.name == name }) else { return nil }
                let text = try await client.memorySkillHistory(botId: botId, name: name).first { $0.body != nil }?.body ?? ""
                return .init(description: skill.description, body: text)
            }, write: { description, body, ifBody in
                try await client.memoryWriteSkill(botId: botId, name: name, description: description, body: body, ifBody: .string(ifBody))
            })
        }
        if result == .saved { loadSkills(force: true) }
        return result
    }

    /// Adds a skill; never replaces one of the same name (one the Bot just made).
    func addSkill(name: String, description: String, body: String) async -> String? {
        do {
            try await client.memoryWriteSkill(botId: botId, name: name, description: description, body: body, ifBody: .null)
            loadSkills(force: true)
            return nil
        } catch {
            let taken = (try? await client.memorySkills(botId: botId))?.contains { $0.name == name } ?? false
            return taken ? "There's a skill named \(name) already." : BBClient.describe(error, server: client.baseURL)
        }
    }

    func revert(_ version: SkillVersion) async -> Bool {
        await act { try await $0.memoryRevertSkill(botId: $1, versionId: version.id) } != nil
    }

    func setLearning(_ enabled: Bool) async {
        await act { _ = try await $0.memorySetLearning(botId: $1, enabled: enabled) }
    }

    func runLearning() async {
        let started = await act { try await $0.memoryRunLearning(botId: $1) }
        if started == false { notice = "A review is already running, or the Bot is busy. Try again in a few minutes." }
    }

    /// Runs one action, then reloads the skills and Auto-learn; nil when it failed (its error is the notice).
    @discardableResult
    private func act<Value>(_ run: (BBClient, String?) async throws -> Value) async -> Value? {
        busy = true
        notice = nil
        defer { busy = false }
        do {
            let value = try await run(client, botId)
            loadSkills(force: true)
            return value
        } catch {
            notice = BBClient.describe(error, server: client.baseURL)
            return nil
        }
    }

    enum SaveResult: Equatable {
        case saved
        case conflict(String)
        case failed(String)
    }

    private static func attempt(_ save: () async throws -> MemorySave.Outcome) async -> SaveResult {
        do {
            switch try await save() {
            case .saved: return .saved
            case .conflict(let text): return .conflict(text)
            case .gone: return .failed("That skill is gone.")
            }
        } catch {
            return .failed(BBClient.describe(error))
        }
    }
}
