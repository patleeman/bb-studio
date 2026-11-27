import Foundation

/// Memory's calls: the same Studio RPCs the desktop's Memory page makes.
extension BBClient {
    func memoryCore(botId: String?) async throws -> MemoryCore {
        let output: Studio.BotCoreOutput = try await rpc("studio", Studio.Method.bot_core, Self.scoped(botId))
        return MemoryCore(output)
    }

    func memorySkills(botId: String?) async throws -> [MemorySkill] {
        struct Output: Decodable { var skills: [MemorySkill] }
        let output: Output = try await rpc("studio", Studio.Method.bot_skills, Self.scoped(botId))
        return output.skills
    }

    /// Writes a skill. `ifBody` makes it a compare-and-swap: written only while
    /// the skill's body is still that text; `.null` only while there is no such
    /// skill; nil writes whatever is there.
    func memoryWriteSkill(botId: String?, name: String, description: String, body: String, ifBody: JSONValue?) async throws {
        struct Output: Decodable { var name: String }
        let _: Output = try await rpc("studio", Studio.Method.bot_skill_write, Self.scoped(botId, [
            "name": .string(name), "description": .string(description), "body": .string(body), "ifBody": ifBody,
        ]))
    }

    /// A skill's versions, newest first; the first with a body is its text now.
    func memorySkillHistory(botId: String?, name: String) async throws -> [SkillVersion] {
        struct Output: Decodable { var versions: [SkillVersion] }
        let output: Output = try await rpc("studio", Studio.Method.bot_skill_history, Self.scoped(botId, ["name": .string(name)]))
        return output.versions.filter { $0.name == name }
    }

    func memoryRevertSkill(botId: String?, versionId: Int) async throws {
        struct Output: Decodable { var reverted: Bool }
        let _: Output = try await rpc("studio", Studio.Method.bot_skill_revert, Self.scoped(botId, ["versionId": .number(Double(versionId))]))
    }

    func memoryLearning(botId: String?) async throws -> SkillLearning {
        try await rpc("studio", Studio.Method.bot_learning, Self.scoped(botId))
    }

    func memorySetLearning(botId: String?, enabled: Bool) async throws -> SkillLearning {
        try await rpc("studio", Studio.Method.bot_learning_set, Self.scoped(botId, ["enabled": .bool(enabled)]))
    }

    /// Starts a skill review now; false when one is running or the Bot is busy.
    func memoryRunLearning(botId: String?) async throws -> Bool {
        struct Output: Decodable { var started: Bool }
        let output: Output = try await rpc("studio", Studio.Method.bot_learning_review, Self.scoped(botId))
        return output.started
    }

    func memorySummaries(botId: String?) async throws -> [HistorySummary] {
        let output: Studio.BotSummariesOutput = try await rpc("studio", Studio.Method.bot_summaries, Self.scoped(botId))
        return (output.summaries ?? []).compactMap(HistorySummary.init)
    }

    func memoryConversations(botId: String?) async throws -> [PastConversation] {
        let output: Studio.BotConversationsAllOutput = try await rpc("studio", Studio.Method.bot_conversations_all, Self.scoped(botId))
        return (output.conversations ?? []).compactMap(PastConversation.init)
    }

    /// Full-text search over the Bot's conversations; `indexing` while older messages are still being read.
    func memorySearchConversations(botId: String?, query: String) async throws -> (hits: [String: ConversationHit], indexing: Bool) {
        let output: Studio.BotConversationsSearchOutput = try await rpc("studio", Studio.Method.bot_conversations_search,
                                                                         Self.scoped(botId, ["query": .string(String(query.prefix(200)))]))
        var hits: [String: ConversationHit] = [:]
        for hit in output.hits ?? [] where hit.kind != .worker {
            guard let id = hit.threadId, hits[id] == nil else { continue }
            hits[id] = ConversationHit(threadId: id, snippet: hit.snippet)
        }
        return (hits, output.indexing ?? false)
    }
}
