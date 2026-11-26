#if DEBUG
import Foundation

/// The offline demo Bot's Memory (`-qaBotDemo`): its always-on core skill,
/// on-demand skills with versions, Auto-learn, and History from the demo's
/// conversations. Writes keep Studio's compare-and-swap (`ifBody`).
///
/// `-qaMemoryBotEdit <section>` has the Bot edit that core section (or
/// "Check-in") right after the page first loads, to test that a save never
/// overwrites the Bot's edit: the same section comes back as a conflict,
/// another section is kept.
final class MemoryDemo: @unchecked Sendable {
    static let shared = MemoryDemo()
    static let methods: Set<String> = [
        "bot_core", "bot_skills", "bot_skill_write", "bot_skill_history", "bot_skill_revert",
        "bot_learning", "bot_learning_set", "bot_learning_review",
        "bot_summaries", "bot_conversations_all", "bot_conversations_search",
    ]
    static let coreName = "core-profile"
    static let botEditLine = "- Kitchen quotes: pick one by Friday."

    struct Conversation {
        var id: String
        var title: String
        var main: Bool
        var at: Double
        var latest: String
        var archivedAt: Double?
        var summary: String?
        var messages: [String]
    }

    private struct Skill {
        var description: String
        var body: String
        var updatedAt: Double
        var usedAt: Double?
        var alwaysOn = false
        var state = "active"
    }

    private let lock = NSLock()
    private var skills: [String: Skill] = [:]
    private var versions: [[String: Any]] = []
    private var learningEnabled = true
    private var lastReview: (at: Double, result: String)
    private var coreReads = 0
    private let botEdit: String?

    private static var now: Double { Date().timeIntervalSince1970 * 1000 }

    init(arguments: [String] = ProcessInfo.processInfo.arguments) {
        botEdit = arguments.firstIndex(of: "-qaMemoryBotEdit").flatMap { arguments.indices.contains($0 + 1) ? arguments[$0 + 1] : nil }
        let now = Self.now
        lastReview = (now - 7_200_000, "Saved 1 skill")
        let day = 86_400_000.0
        write(Self.coreName, "Always on: how to work with the user, what is true right now, and the check-in list.", """
            ## Preferences

            - Short, plain answers. Lead with the result.
            - Ask before anything that publishes or deletes.
            - Metric units, 24-hour time.

            ## Right now

            - Lisbon trip 14–18 Nov: keep the evenings free.
            - Launch prep: mock interview on Friday.

            ## Check-in

            - Anything waiting on me, or work that finished, failed or stalled?
            - Any worker stuck for more than an hour?
            """, at: now - 3 * day, alwaysOn: true)
        write("weekly-review", "Gathers the week's open items into a page.", "1. Read the week's conversations.\n2. List what is still open.", at: now - 20 * day)
        write("weekly-review", "Gathers the week's open items into a page.", "1. Read the week's conversations.\n2. List what is still open.\n3. Write it to a page called Weekly review.",
              at: now - 2 * day, used: now - 3_600_000)
        write("trip-planning", "Day-by-day plan with bookings and costs.", "1. One section per day.\n2. Bookings with their codes.", at: now - 9 * day, used: now - 2 * day)
        write("release-notes", "Writes notes from merged changes.", "1. Read the merged changes.\n2. Group them by area.", at: now - 40 * day, state: "stale")
        write("code-review", "The checklist used on every change.", "- Tests pass.\n- No personal data in fixtures.", at: now - 5 * day, used: now - day)
    }

    func respond(_ name: String, _ input: [String: Any], history: [Conversation]) -> (Int, Data) {
        lock.withLock {
            switch name {
            case "bot_core":
                return core()
            case "bot_skills":
                return ok(["skills": skills.keys.sorted().map(view)])
            case "bot_skill_write":
                return skillWrite(input)
            case "bot_skill_history":
                return ok(["versions": Array(versions.filter { input["name"] == nil || $0["name"] as? String == input["name"] as? String }.reversed())])
            case "bot_skill_revert":
                return revert(input["versionId"] as? Int ?? 0)
            case "bot_learning":
                return ok(learning())
            case "bot_learning_set":
                learningEnabled = input["enabled"] as? Bool ?? learningEnabled
                return ok(learning())
            case "bot_learning_review":
                lastReview = (Self.now, "No new skills")
                return ok(["started": true])
            case "bot_summaries":
                return ok(["botId": "bot_juniper", "summaries": summaries(history)])
            case "bot_conversations_all":
                return ok(["botId": "bot_juniper", "workers": [Any](), "conversations": Self.ordered(history).map(Self.conversation)])
            case "bot_conversations_search":
                return search(input["query"] as? String ?? "", history)
            default:
                return failure("Not in the demo")
            }
        }
    }

    /// Active first (Main, then by activity), then the archived ones.
    private static func ordered(_ history: [Conversation]) -> [Conversation] {
        history.sorted { a, b in
            if (a.archivedAt == nil) != (b.archivedAt == nil) { return a.archivedAt == nil }
            if a.main != b.main { return a.main }
            return (a.archivedAt ?? a.at) > (b.archivedAt ?? b.at)
        }
    }

    private func summaries(_ history: [Conversation]) -> [[String: Any]] {
        history.compactMap { row -> (Double, [String: Any])? in
            guard let at = row.archivedAt, let summary = row.summary, !summary.isEmpty else { return nil }
            return (at, ["threadId": row.id, "title": row.title, "archivedAt": at, "summary": summary])
        }
        .sorted { $0.0 > $1.0 }
        .map(\.1)
    }

    // MARK: Answers (under the lock)

    private func core() -> (Int, Data) {
        coreReads += 1
        // The Bot's edit lands between the page's first read and its save.
        if coreReads == 2, let section = botEdit, var core = skills[Self.coreName] {
            let current = CoreText.sectionText(core.body, section) ?? ""
            core.body = CoreText.withSection(core.body, section, current + "\n" + Self.botEditLine)
            skills[Self.coreName] = core
            record(Self.coreName, core, at: Self.now)
        }
        let always = skills.filter { $0.value.alwaysOn }.sorted { a, b in
            a.key == Self.coreName ? b.key != Self.coreName : b.key == Self.coreName ? false : a.key < b.key
        }
        let chars = always.reduce(0) { $0 + $1.value.body.trimmingCharacters(in: .whitespacesAndNewlines).count }
        return ok(["chars": chars, "cap": 2000, "over": chars > 2000, "skills": always.map { name, skill in
            ["name": name, "description": skill.description, "body": skill.body, "updatedAt": skill.updatedAt, "warnings": [String](), "core": name == Self.coreName] as [String: Any]
        }])
    }

    private func skillWrite(_ input: [String: Any]) -> (Int, Data) {
        guard let name = input["name"] as? String, let body = input["body"] as? String else { return failure("A skill needs a name and a body.") }
        if input.keys.contains("ifBody") {
            let expected = input["ifBody"] as? String
            if skills[name]?.body != expected { return failure("This skill changed since you opened it. Nothing was saved: read it again and redo the edit.") }
        }
        write(name, input["description"] as? String ?? skills[name]?.description ?? name, body, at: Self.now, used: Self.now,
              alwaysOn: skills[name]?.alwaysOn ?? false)
        return ok(view(name))
    }

    private func revert(_ id: Int) -> (Int, Data) {
        guard let version = versions.first(where: { $0["id"] as? Int == id }), let name = version["name"] as? String, let body = version["body"] as? String
        else { return failure("That version is gone.") }
        write(name, version["description"] as? String ?? name, body, at: Self.now, alwaysOn: skills[name]?.alwaysOn ?? false)
        return ok(["reverted": true])
    }

    private func learning() -> [String: Any] {
        ["enabled": learningEnabled, "reviewModel": NSNull(), "defaultModel": NSNull(), "models": [String](), "consolidate": false,
         "cadence": "daily-and-archive", "reviewing": false, "queued": 0, "lastSweepAt": NSNull(),
         "lastReview": ["at": lastReview.at, "result": lastReview.result], "lastCurator": NSNull()]
    }

    private func search(_ query: String, _ history: [Conversation]) -> (Int, Data) {
        let words = query.lowercased().split(whereSeparator: \.isWhitespace).map(String.init)
        let hits = history.compactMap { row -> [String: Any]? in
            let found = ([row.summary ?? ""] + row.messages).first { text in words.allSatisfy(text.lowercased().contains) }
            return found.map { ["threadId": row.id, "kind": "conversation", "field": "message", "snippet": $0] }
        }
        return ok(["hits": hits, "indexing": false])
    }

    // MARK: Store

    private func write(_ name: String, _ description: String, _ body: String, at: Double, used: Double? = nil, alwaysOn: Bool = false, state: String = "active") {
        var skill = skills[name] ?? Skill(description: description, body: body, updatedAt: at, alwaysOn: alwaysOn, state: state)
        skill.description = description
        skill.body = body
        skill.updatedAt = at
        skill.alwaysOn = alwaysOn
        if let used { skill.usedAt = used }
        skills[name] = skill
        record(name, skill, at: at)
    }

    private func record(_ name: String, _ skill: Skill, at: Double) {
        let previous = versions.last { $0["name"] as? String == name }?["body"] as? String
        let removed = (previous ?? "").split(separator: "\n").filter { !skill.body.split(separator: "\n").contains($0) }.map { "-\($0)" }
        let added = skill.body.split(separator: "\n").filter { !(previous ?? "").split(separator: "\n").contains($0) }.map { "+\($0)" }
        versions.append(["id": versions.count + 1, "name": name, "description": skill.description, "body": skill.body,
                         "diff": (removed + added).joined(separator: "\n"), "warnings": [String](), "at": at])
    }

    private func view(_ name: String) -> [String: Any] {
        guard let skill = skills[name] else { return [:] }
        return ["name": name, "description": skill.description, "updatedAt": skill.updatedAt, "state": skill.state, "pinned": skill.alwaysOn,
                "usedAt": skill.usedAt ?? NSNull(), "alwaysOn": skill.alwaysOn]
    }

    private static func conversation(_ row: Conversation) -> [String: Any] {
        ["threadId": row.id, "title": row.title, "isMain": row.main, "forkedFrom": NSNull(), "projectId": "proj_personal",
         "updatedAt": row.archivedAt ?? row.at, "archivedAt": row.archivedAt ?? NSNull(), "summary": row.summary ?? NSNull(),
         "latest": row.latest, "running": false, "needsYou": NSNull(), "failed": false]
    }

    private func ok(_ result: Any) -> (Int, Data) {
        (200, (try? JSONSerialization.data(withJSONObject: ["ok": true, "result": result])) ?? Data())
    }

    private func failure(_ message: String) -> (Int, Data) {
        (400, (try? JSONSerialization.data(withJSONObject: ["ok": false, "error": ["message": message]])) ?? Data())
    }
}
#endif
