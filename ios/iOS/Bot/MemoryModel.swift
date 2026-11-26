import Foundation

// Memory in three layers, as the desktop's Memory page has them (Studio's
// src/memory/ui/MemoryView.tsx):
//
// 1. Core: the Bot's always-on skills (`bot_core`), in every prompt. The core
//    skill's `## ` sections (Preferences, Right now, Check-in, then any others)
//    are edited one at a time; one character budget covers them all.
// 2. Skills: the on-demand skills (`bot_skills`), each with its version
//    history, and Auto-learn (`bot_learning`), daily and on archive.
// 3. History: the archived conversations' summaries (`bot_summaries`), or
//    every conversation (`bot_conversations_all`) with full-text search.
//
// Everything here is plain values and functions, tested in MemoryModelTests.

/// A skill body's `## ` sections, as Studio's src/core-skill.ts reads them.
enum CoreText {
    /// The core skill's sections, in order.
    static let sections = ["Preferences", "Right now", "Check-in"]
    /// Bullets a capped section may hold (advisory, like every skill note).
    static let caps = ["Preferences": 25, "Right now": 10]

    struct Section: Equatable, Identifiable {
        var heading: String
        var text: String
        /// A default section the skill doesn't have yet: saving makes it.
        var missing = false
        var id: String { heading }
    }

    /// The heading a `## ` line names, else nil.
    static func heading(_ line: Substring) -> String? {
        guard line.hasPrefix("##"), let first = line.dropFirst(2).first, first == " " || first == "\t" else { return nil }
        var rest = line.dropFirst(2).trimmingCharacters(in: .whitespaces)
        while rest.hasSuffix("#") { rest.removeLast() }
        rest = rest.trimmingCharacters(in: .whitespaces)
        return rest.isEmpty ? nil : rest
    }

    /// Headings match case-insensitively, ignoring hyphens, spaces and a plural "s" ("Check-ins" is "Check-in").
    static func normalized(_ name: String) -> String {
        var text = name.lowercased().filter { !$0.isWhitespace && $0 != "-" }
        if text.hasSuffix("s") { text.removeLast() }
        return text
    }

    /// The core section a heading names, or nil for another heading.
    static func canonical(_ name: String) -> String? {
        sections.first { normalized($0) == normalized(name) }
    }

    static func cap(for name: String) -> Int? {
        canonical(name).flatMap { caps[$0] }
    }

    /// Bullets in a section: lines starting with -, *, + or a number.
    static func bulletCount(_ text: String) -> Int {
        text.split(separator: "\n", omittingEmptySubsequences: false).filter(isBullet).count
    }

    private static func isBullet(_ line: Substring) -> Bool {
        let indent = line.prefix { $0 == " " }.count
        guard indent <= 3 else { return false }
        var rest = line.dropFirst(indent)
        if let mark = rest.first, "-*+".contains(mark) {
            rest = rest.dropFirst()
        } else {
            let digits = rest.prefix(while: \.isNumber)
            guard !digits.isEmpty, let mark = rest.dropFirst(digits.count).first, mark == "." || mark == ")" else { return false }
            rest = rest.dropFirst(digits.count + 1)
        }
        guard rest.first?.isWhitespace == true else { return false }
        return rest.contains { !$0.isWhitespace }
    }

    private static func lines(_ body: String) -> [Substring] {
        body.split(separator: "\n", omittingEmptySubsequences: false)
    }

    private static func range(of name: String, in lines: [Substring]) -> Range<Int>? {
        guard let start = lines.firstIndex(where: { heading($0).map { normalized($0) == normalized(name) } ?? false }) else { return nil }
        var end = start + 1
        while end < lines.count, !lines[end].hasPrefix("## ") && !lines[end].hasPrefix("##\t") { end += 1 }
        return start..<end
    }

    private static func trimmed(_ text: some StringProtocol) -> String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The text under a section's heading, or nil when the body has no such heading.
    static func sectionText(_ body: String, _ name: String) -> String? {
        let lines = lines(body)
        guard let range = range(of: name, in: lines) else { return nil }
        return trimmed(lines[(range.lowerBound + 1)..<range.upperBound].joined(separator: "\n"))
    }

    /// The body with one section's text replaced; a missing section is added at the end.
    static func withSection(_ body: String, _ name: String, _ text: String) -> String {
        var lines = lines(body.replacingOccurrences(of: #"\s+$"#, with: "", options: .regularExpression))
        let block: [Substring] = trimmed(text).isEmpty ? [""] : ["", Substring(trimmed(text)), ""]
        if let range = range(of: name, in: lines) {
            lines.replaceSubrange((range.lowerBound + 1)..<range.upperBound, with: block)
            let joined = lines.joined(separator: "\n").replacingOccurrences(of: #"\n{3,}"#, with: "\n\n", options: .regularExpression)
            return joined.replacingOccurrences(of: #"\s+$"#, with: "", options: .regularExpression) + "\n"
        }
        let joined = (lines + ["", "## \(name)"] + block).joined(separator: "\n")
        return joined.replacingOccurrences(of: #"^\n+"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\s+$"#, with: "", options: .regularExpression) + "\n"
    }

    /// Every `## ` section of a body, in order.
    static func split(_ body: String) -> [Section] {
        var sections: [Section] = []
        var current: (heading: String, lines: [Substring])?
        for line in lines(body) {
            if let name = heading(line) {
                if let current { sections.append(Section(heading: current.heading, text: trimmed(current.lines.joined(separator: "\n")))) }
                current = (name, [])
            } else {
                current?.lines.append(line)
            }
        }
        if let current { sections.append(Section(heading: current.heading, text: trimmed(current.lines.joined(separator: "\n")))) }
        return sections
    }

    /// What Core shows of the core skill: the three default sections first
    /// (empty when the skill lacks one), then any others in the skill's order.
    static func coreSections(_ body: String) -> [Section] {
        let all = split(body)
        let defaults = sections.map { name in
            all.first { canonical($0.heading) == name } ?? Section(heading: name, text: "", missing: true)
        }
        return defaults + all.filter { canonical($0.heading) == nil }
    }
}

/// The always-on skills and their shared budget (`bot_core`).
struct MemoryCore: Equatable {
    struct Skill: Equatable, Identifiable {
        var name: String
        var description: String
        var body: String
        var updatedAt: Double
        var warnings: [String]
        /// The Bot's core skill: its sections are Core's.
        var core: Bool
        var id: String { name }
    }

    var skills: [Skill]
    var chars: Int
    var cap: Int
    var over: Bool

    /// The core skill: the one the server marks, else the only one.
    var coreSkill: Skill? { skills.first(where: \.core) ?? (skills.count == 1 ? skills.first : nil) }
    var otherSkills: [Skill] { skills.filter { $0.name != coreSkill?.name } }
    var warnings: [String] {
        var seen = Set<String>()
        return skills.flatMap(\.warnings).filter { seen.insert($0).inserted }
    }

    init(skills: [Skill], chars: Int, cap: Int, over: Bool) {
        self.skills = skills
        self.chars = chars
        self.cap = cap
        self.over = over
    }

    init(_ wire: Studio.BotCoreOutput) {
        let skills = (wire.skills ?? []).compactMap { skill -> Skill? in
            guard let name = skill.name, !name.isEmpty else { return nil }
            return Skill(name: name, description: skill.description ?? "", body: skill.body ?? "", updatedAt: skill.updatedAt ?? 0,
                         warnings: skill.warnings ?? [], core: skill.core ?? false)
        }
        self.init(skills: skills, chars: Int(wire.chars ?? 0), cap: Int(wire.cap ?? 2000), over: wire.over ?? false)
    }
}

enum MemoryBudget {
    /// Past this share of the cap the count says "Near limit".
    static let nearShare = 0.9

    /// "1,420 / 2,000 chars".
    static func label(chars: Int, cap: Int) -> String {
        "\(chars.formatted()) / \(cap.formatted()) chars"
    }

    static func fraction(chars: Int, cap: Int) -> Double {
        cap > 0 ? min(1, Double(chars) / Double(cap)) : 0
    }

    enum Level: Equatable { case fine, near, over }

    static func level(chars: Int, cap: Int) -> Level {
        if chars > cap { return .over }
        return fraction(chars: chars, cap: cap) >= nearShare ? .near : .fine
    }

    /// "12 / 25 lines" for a capped section.
    static func lines(_ text: String, cap: Int) -> String {
        "\(CoreText.bulletCount(text)) / \(cap) lines"
    }
}

/// How an edit to an always-on or on-demand skill is saved: never over an
/// edit the Bot made while you typed.
///
/// The skill is read again first. If the part being edited (one section, or
/// the whole skill) still reads as it did when the edit began, the edit goes
/// into that latest text, so the Bot's change to another section stays; the
/// write is a compare-and-swap (`ifBody`) on the text just read, and a write
/// that loses that race is merged again. If the edited part itself changed,
/// nothing is written and its newer text comes back as a conflict: saving
/// again from there replaces it.
enum MemorySave {
    enum Outcome: Equatable {
        case saved
        /// The part changed since the edit began; this is its text now.
        case conflict(String)
        /// The skill is gone.
        case gone
    }

    struct Current: Equatable {
        var description: String
        var body: String
    }

    static let attempts = 3

    /// - Parameters:
    ///   - section: the core section edited, or nil for the whole body.
    ///   - base: the part's text when the edit began.
    ///   - description: a new description (whole-skill edits), else nil to keep it.
    static func save(section: String?, base: String, text: String, description: String? = nil,
                     read: () async throws -> Current?,
                     write: (_ description: String, _ body: String, _ ifBody: String) async throws -> Void) async throws -> Outcome {
        var lastError: Error?
        for _ in 0..<attempts {
            guard let latest = try await read() else { return .gone }
            let current = section.map { CoreText.sectionText(latest.body, $0) ?? "" } ?? latest.body
            if trim(current) != trim(base) { return .conflict(current) }
            let body = section.map { CoreText.withSection(latest.body, $0, text) } ?? text
            do {
                try await write(description ?? latest.description, body, latest.body)
                return .saved
            } catch {
                // Lost the race to another edit: merge into the newer text. Any other failure stands.
                guard let again = try await read(), again.body != latest.body else { throw error }
                lastError = error
            }
        }
        throw lastError ?? CancellationError()
    }

    private static func trim(_ text: String) -> String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
}

/// One of the Bot's skills (`bot_skills`).
struct MemorySkill: Decodable, Hashable, Identifiable {
    var name: String
    var description: String
    var updatedAt: Double
    /// "active", "stale" (unused 30 days) or "archived" (hidden from the Bot).
    var state: String?
    var pinned: Bool?
    /// When the Bot last loaded or saved it.
    var usedAt: Double?
    var alwaysOn: Bool?
    var id: String { name }

    /// The Skills layer lists the on-demand skills that aren't archived; always-on ones are Core's.
    var listed: Bool { alwaysOn != true && state != "archived" }
    var stale: Bool { state == "stale" }

    /// "Used 2h ago", else "Edited 3d ago".
    func lastUsed(now: Date = .now) -> String {
        if let usedAt { return "Used \(MemoryFormat.ago(usedAt, now: now))" }
        return "Edited \(MemoryFormat.ago(updatedAt, now: now))"
    }

    static let namePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

    /// Why a new skill's name won't do, or nil when it will (or is still empty).
    static func nameProblem(_ name: String, taken: [String]) -> String? {
        guard !name.isEmpty else { return nil }
        guard name.count <= 64, name.wholeMatch(of: namePattern) != nil else { return "Lowercase words joined by hyphens, like weekly-review." }
        return taken.contains(name) ? "There's a skill named \(name) already." : nil
    }
}

/// One saved version of a skill (`bot_skill_history`), newest first.
struct SkillVersion: Decodable, Hashable, Identifiable {
    var id: Int
    var name: String
    var description: String?
    /// Nil for a delete.
    var body: String?
    var diff: String
    var warnings: [String]
    var at: Double

    /// "+3 −1": lines the version added and removed.
    var change: String {
        let lines = diff.split(separator: "\n")
        let added = lines.filter { $0.hasPrefix("+") && !$0.hasPrefix("+++") }.count
        let removed = lines.filter { $0.hasPrefix("-") && !$0.hasPrefix("---") }.count
        if body == nil { return "Deleted" }
        return added == 0 && removed == 0 ? "No text change" : "+\(added) −\(removed)"
    }
}

/// Auto-learn (`bot_learning`): reviews once a day and when a conversation is archived.
struct SkillLearning: Decodable, Hashable {
    struct Run: Decodable, Hashable { var at: Double; var result: String }
    var enabled: Bool
    var reviewing: Bool
    var lastReview: Run?

    /// "Reviewing now…", "Saved 1 skill, 2h ago" or "Not run yet".
    func status(now: Date = .now) -> String {
        if reviewing { return "Reviewing now…" }
        guard let lastReview else { return "Not run yet" }
        return "\(lastReview.result), \(MemoryFormat.ago(lastReview.at, now: now))"
    }
}

/// An archived conversation's summary (`bot_summaries`).
struct HistorySummary: Equatable, Identifiable {
    var threadId: String
    var title: String
    var archivedAt: Double
    var summary: String
    var id: String { threadId }

    init(threadId: String, title: String, archivedAt: Double, summary: String) {
        self.threadId = threadId
        self.title = title
        self.archivedAt = archivedAt
        self.summary = summary
    }

    init?(_ wire: Studio.BotSummariesOutputSummariesItem) {
        guard let id = wire.threadId, !id.isEmpty else { return nil }
        self.init(threadId: id, title: MemoryFormat.title(wire.title), archivedAt: wire.archivedAt ?? 0, summary: wire.summary ?? "")
    }
}

/// A conversation in Past conversations (`bot_conversations_all`).
struct PastConversation: Equatable, Identifiable {
    var threadId: String
    var title: String
    var updatedAt: Double
    var archivedAt: Double?
    var summary: String?
    var latest: String?
    var id: String { threadId }
    var archived: Bool { archivedAt != nil }

    init(threadId: String, title: String, updatedAt: Double, archivedAt: Double? = nil, summary: String? = nil, latest: String? = nil) {
        self.threadId = threadId
        self.title = title
        self.updatedAt = updatedAt
        self.archivedAt = archivedAt
        self.summary = summary
        self.latest = latest
    }

    init?(_ wire: Studio.BotConversationsAllOutputConversationsItem) {
        guard let id = wire.threadId, !id.isEmpty else { return nil }
        self.init(threadId: id, title: MemoryFormat.title(wire.title), updatedAt: wire.updatedAt ?? 0, archivedAt: wire.archivedAt,
                  summary: wire.summary.flatMap { $0.isEmpty ? nil : $0 }, latest: wire.latest.flatMap { $0.isEmpty ? nil : $0 })
    }
}

/// A full-text search hit (`bot_conversations_search`).
struct ConversationHit: Equatable {
    var threadId: String
    var snippet: String?
}

enum MemoryHistory {
    /// The query's words, lowercased; empty for a blank query.
    static func words(_ query: String) -> [String] {
        query.lowercased().split(whereSeparator: \.isWhitespace).map(String.init)
    }

    static func summaries(_ all: [HistorySummary], words: [String]) -> [HistorySummary] {
        guard !words.isEmpty else { return all }
        return all.filter { each in
            let text = "\(each.title)\n\(each.summary)".lowercased()
            return words.allSatisfy(text.contains)
        }
    }

    /// Conversations the search finds: by a server hit (messages and summaries), or every word in the title.
    static func conversations(_ all: [PastConversation], words: [String], hits: [String: ConversationHit]) -> [PastConversation] {
        guard !words.isEmpty else { return all }
        return all.filter { row in hits[row.threadId] != nil || words.allSatisfy(row.title.lowercased().contains) }
    }

    /// The line under a conversation: the search snippet, else its summary, else its latest message.
    static func detail(_ row: PastConversation, hit: ConversationHit?) -> String? {
        hit?.snippet.flatMap { $0.isEmpty ? nil : $0 } ?? row.summary.map(SummaryText.oneLine) ?? row.latest
    }
}

/// A conversation summary's sections (**Decisions**, **Left open**, **Made**), as Studio's summarySections reads them.
enum SummaryText {
    struct Section: Equatable {
        var heading: String
        var items: [String]
        var list: Bool
    }

    static func sections(_ markdown: String) -> [Section] {
        var sections: [Section] = []
        for raw in markdown.split(separator: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            guard !line.isEmpty else { continue }
            if let heading = heading(line) {
                sections.append(Section(heading: heading, items: [], list: false))
                continue
            }
            if sections.isEmpty { sections.append(Section(heading: "", items: [], list: false)) }
            if let match = line.firstMatch(of: /^(?:[-*+]|\d+[.)])\s+(.*)$/) {
                sections[sections.count - 1].items.append(inline(String(match.1)))
                sections[sections.count - 1].list = true
            } else if let match = line.firstMatch(of: /^>\s?(.*)$/) {
                let text = String(match.1).trimmingCharacters(in: .whitespaces)
                if !text.isEmpty { sections[sections.count - 1].items.append(inline(text)) }
            } else {
                sections[sections.count - 1].items.append(inline(line))
            }
        }
        return sections.filter { !$0.items.isEmpty || !$0.heading.isEmpty }
    }

    /// A summary on one line: its items joined, headings left out.
    static func oneLine(_ markdown: String) -> String {
        sections(markdown).flatMap(\.items).joined(separator: " · ")
    }

    private static func heading(_ line: String) -> String? {
        if let match = line.wholeMatch(of: /#{1,6}\s+(.+?)/) { return inline(String(match.1)) }
        if let match = line.wholeMatch(of: /\*\*([^*]+?)\*\*:?\s*(?:\(.*\))?/) { return inline(String(match.1)) }
        return nil
    }

    /// Markdown emphasis and code marks dropped, links reduced to their text.
    static func inline(_ text: String) -> String {
        text.replacing(/\[([^\]]+)\]\([^)]*\)/) { String($0.1) }
            .replacing(/\*\*|__|`/, with: "")
            .trimmingCharacters(in: .whitespaces)
    }
}

enum MemoryFormat {
    /// "Nov 22", with the year when it isn't this year's.
    static func shortDate(_ at: Double, now: Date = .now) -> String {
        let date = Date(timeIntervalSince1970: at / 1000)
        let calendar = Calendar.current
        let style = Date.FormatStyle.dateTime.month(.abbreviated).day()
        return calendar.component(.year, from: date) == calendar.component(.year, from: now)
            ? date.formatted(style) : date.formatted(style.year())
    }

    /// "now", "5m ago", "2h ago", "3d ago", "2w ago".
    static func ago(_ at: Double, now: Date = .now) -> String {
        let age = BotShell.shortAge(at, now: now)
        return age == "now" ? "just now" : "\(age) ago"
    }

    static func title(_ title: String?) -> String {
        let text = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return text.isEmpty ? "Untitled" : text
    }
}
