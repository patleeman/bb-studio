import XCTest
@testable import BBStudio

final class MemoryModelTests: XCTestCase {
    private let body = """
        Intro line.

        ## Preferences

        - Short answers.
        - Ask before publishing.

        ## right-nows

        - Lisbon trip.

        ### Not a section
        still Right now

        ## Extra
        Free text.
        """

    // MARK: Core sections (Studio's src/core-skill.ts)

    func testSectionsAreFoundByLooseHeadingsAndSubheadingsStayInside() {
        XCTAssertEqual(CoreText.sectionText(body, "Preferences"), "- Short answers.\n- Ask before publishing.")
        XCTAssertEqual(CoreText.sectionText(body, "Right now"), "- Lisbon trip.\n\n### Not a section\nstill Right now", "case, hyphens and a plural s don't matter")
        XCTAssertNil(CoreText.sectionText(body, "Check-in"))
        XCTAssertEqual(CoreText.canonical("check-ins"), "Check-in")
        XCTAssertNil(CoreText.canonical("Extra"))
        XCTAssertEqual(CoreText.cap(for: "preferences"), 25)
        XCTAssertEqual(CoreText.cap(for: "Right now"), 10)
        XCTAssertNil(CoreText.cap(for: "Check-in"))
    }

    func testCoreShowsTheDefaultsFirstThenTheRest() {
        let sections = CoreText.coreSections(body)
        XCTAssertEqual(sections.map(\.heading), ["Preferences", "right-nows", "Check-in", "Extra"])
        XCTAssertEqual(sections.map(\.missing), [false, false, true, false])
        XCTAssertEqual(sections[3].text, "Free text.")
    }

    func testWithSectionReplacesOnlyItsSectionOrAddsItAtTheEnd() {
        let replaced = CoreText.withSection(body, "Preferences", "- One rule.")
        XCTAssertEqual(CoreText.sectionText(replaced, "Preferences"), "- One rule.")
        XCTAssertEqual(CoreText.sectionText(replaced, "Right now"), CoreText.sectionText(body, "Right now"), "other sections are kept")
        XCTAssertTrue(replaced.hasPrefix("Intro line.\n\n## Preferences\n\n- One rule.\n\n## right-nows"))
        XCTAssertTrue(replaced.hasSuffix("Free text.\n"))
        let added = CoreText.withSection(body, "Check-in", "- Anything stuck?")
        XCTAssertTrue(added.hasSuffix("## Extra\nFree text.\n\n## Check-in\n\n- Anything stuck?\n"), added)
        let emptied = CoreText.withSection("## Preferences\n\n- A\n\n## Check-in\n\n- B\n", "Preferences", "  ")
        XCTAssertEqual(emptied, "## Preferences\n\n## Check-in\n\n- B\n")
        XCTAssertEqual(CoreText.withSection("", "Preferences", "- A"), "## Preferences\n\n- A\n")
    }

    func testBulletsCountAndTheBudgetReads() {
        XCTAssertEqual(CoreText.bulletCount("- a\n* b\n+ c\n1. d\n2) e\n    - too deep\n-nospace\n- \nplain"), 5)
        XCTAssertEqual(MemoryBudget.label(chars: 1420, cap: 2000), "1,420 / 2,000 chars")
        XCTAssertEqual(MemoryBudget.level(chars: 1420, cap: 2000), .fine)
        XCTAssertEqual(MemoryBudget.level(chars: 1800, cap: 2000), .near, "90% is near the limit")
        XCTAssertEqual(MemoryBudget.level(chars: 2001, cap: 2000), .over)
        XCTAssertEqual(MemoryBudget.fraction(chars: 3000, cap: 2000), 1)
        XCTAssertEqual(MemoryBudget.lines("- a\n- b", cap: 25), "2 / 25 lines")
    }

    func testTheCoreSkillIsTheMarkedOne() {
        let skill = { (name: String, core: Bool, warnings: [String]) in
            MemoryCore.Skill(name: name, description: "", body: "", updatedAt: 0, warnings: warnings, core: core)
        }
        let core = MemoryCore(skills: [skill("house-rules", false, ["Over budget"]), skill("mine", true, ["Over budget", "Too many lines"])], chars: 10, cap: 2000, over: false)
        XCTAssertEqual(core.coreSkill?.name, "mine")
        XCTAssertEqual(core.otherSkills.map(\.name), ["house-rules"])
        XCTAssertEqual(core.warnings, ["Over budget", "Too many lines"], "each note once")
        XCTAssertEqual(MemoryCore(skills: [skill("only", false, [])], chars: 0, cap: 2000, over: false).coreSkill?.name, "only")
    }

    // MARK: Saving without overwriting the Bot

    /// A skill on a fake server: reads return its body; writes are compare-and-swap.
    private final class Server: @unchecked Sendable {
        var body: String
        var description = "d"
        var writes: [(body: String, ifBody: String)] = []
        /// Runs before each write lands: the Bot's edit racing the save.
        var beforeWrite: ((Server) -> Void)?

        init(_ body: String) { self.body = body }

        func read() -> MemorySave.Current? { .init(description: description, body: body) }

        func write(_ description: String, _ body: String, _ ifBody: String) throws {
            beforeWrite?(self)
            beforeWrite = nil
            writes.append((body, ifBody))
            guard self.body == ifBody else { throw URLError(.badServerResponse) }
            self.body = body
            self.description = description
        }
    }

    private let core = "## Preferences\n\n- Short answers.\n\n## Right now\n\n- Lisbon trip.\n"

    private func save(_ server: Server, section: String?, base: String, text: String) async throws -> MemorySave.Outcome {
        try await MemorySave.save(section: section, base: base, text: text, read: { server.read() }, write: { try server.write($0, $1, $2) })
    }

    func testASectionSaveKeepsTheBotsEditToAnotherSection() async throws {
        let server = Server(core)
        let base = CoreText.sectionText(core, "Preferences")!
        // The Bot edits Right now while the user edits Preferences.
        server.body = CoreText.withSection(core, "Right now", "- Lisbon trip.\n- Kitchen quotes.")
        let outcome = try await save(server, section: "Preferences", base: base, text: "- Short answers.\n- Metric units.")
        XCTAssertEqual(outcome, .saved)
        XCTAssertEqual(CoreText.sectionText(server.body, "Preferences"), "- Short answers.\n- Metric units.")
        XCTAssertEqual(CoreText.sectionText(server.body, "Right now"), "- Lisbon trip.\n- Kitchen quotes.", "the Bot's edit stays")
    }

    func testTheSameSectionChangedComesBackAsAConflictAndNothingIsWritten() async throws {
        let server = Server(core)
        let base = CoreText.sectionText(core, "Right now")!
        server.body = CoreText.withSection(core, "Right now", "- Kitchen quotes.")
        let outcome = try await save(server, section: "Right now", base: base, text: "- Mine.")
        XCTAssertEqual(outcome, .conflict("- Kitchen quotes."))
        XCTAssertTrue(server.writes.isEmpty)
        // Saving again from the newer text replaces it.
        let again = try await save(server, section: "Right now", base: "- Kitchen quotes.", text: "- Mine.")
        XCTAssertEqual(again, .saved)
        XCTAssertEqual(CoreText.sectionText(server.body, "Right now"), "- Mine.")
    }

    func testAWriteThatLosesTheRaceIsMergedAgainNeverOverTheBot() async throws {
        let server = Server(core)
        // Between the read and the write, the Bot changes Right now.
        server.beforeWrite = { $0.body = CoreText.withSection($0.body, "Right now", "- Bot's line.") }
        let outcome = try await save(server, section: "Preferences", base: "- Short answers.", text: "- Mine.")
        XCTAssertEqual(outcome, .saved)
        XCTAssertEqual(server.writes.count, 2, "the first write was refused, the merge written over the newer text")
        XCTAssertEqual(CoreText.sectionText(server.body, "Right now"), "- Bot's line.")
        XCTAssertEqual(CoreText.sectionText(server.body, "Preferences"), "- Mine.")
    }

    func testARaceOnTheSameSectionBecomesAConflict() async throws {
        let server = Server(core)
        server.beforeWrite = { $0.body = CoreText.withSection($0.body, "Preferences", "- Bot's rule.") }
        let outcome = try await save(server, section: "Preferences", base: "- Short answers.", text: "- Mine.")
        XCTAssertEqual(outcome, .conflict("- Bot's rule."))
        XCTAssertEqual(CoreText.sectionText(server.body, "Preferences"), "- Bot's rule.")
    }

    func testAWholeSkillSaveAndAGoneSkillAndAPlainFailure() async throws {
        let server = Server("1. Old")
        let outcome = try await MemorySave.save(section: nil, base: "1. Old", text: "1. New", description: "When to use it",
                                                read: { server.read() }, write: { try server.write($0, $1, $2) })
        XCTAssertEqual(outcome, .saved)
        XCTAssertEqual(server.body, "1. New")
        XCTAssertEqual(server.description, "When to use it")
        let gone = try await MemorySave.save(section: nil, base: "x", text: "y", read: { nil }, write: { _, _, _ in XCTFail("no write") })
        XCTAssertEqual(gone, .gone)
        do {
            _ = try await MemorySave.save(section: nil, base: "x", text: "y", read: { .init(description: "", body: "x") },
                                          write: { _, _, _ in throw URLError(.notConnectedToInternet) })
            XCTFail("a failure that isn't a race stands")
        } catch {
            XCTAssertEqual((error as? URLError)?.code, .notConnectedToInternet)
        }
    }

    // MARK: Skills

    func testNewSkillNamesAndVersionsAndLastUsed() {
        XCTAssertNil(MemorySkill.nameProblem("", taken: []))
        XCTAssertNil(MemorySkill.nameProblem("weekly-review", taken: ["inbox"]))
        XCTAssertEqual(MemorySkill.nameProblem("Weekly Review", taken: []), "Lowercase words joined by hyphens, like weekly-review.")
        XCTAssertEqual(MemorySkill.nameProblem("a--b", taken: []), "Lowercase words joined by hyphens, like weekly-review.")
        XCTAssertEqual(MemorySkill.nameProblem("inbox", taken: ["inbox"]), "There's a skill named inbox already.")
        let version = SkillVersion(id: 2, name: "x", description: nil, body: "b", diff: "--- a\n+++ b\n-old\n+new\n+more", warnings: [], at: 0)
        XCTAssertEqual(version.change, "+2 −1")
        XCTAssertEqual(SkillVersion(id: 3, name: "x", description: nil, body: nil, diff: "", warnings: [], at: 0).change, "Deleted")
        let now = Date(timeIntervalSince1970: 100_000)
        let skill = MemorySkill(name: "x", description: "d", updatedAt: now.timeIntervalSince1970 * 1000 - 3 * 86_400_000, usedAt: nil)
        XCTAssertEqual(skill.lastUsed(now: now), "Edited 3d ago")
        var used = skill
        used.usedAt = now.timeIntervalSince1970 * 1000 - 7_200_000
        XCTAssertEqual(used.lastUsed(now: now), "Used 2h ago")
        XCTAssertEqual(SkillLearning(enabled: true, reviewing: true, lastReview: nil).status(), "Reviewing now…")
        XCTAssertEqual(SkillLearning(enabled: true, reviewing: false, lastReview: nil).status(), "Not run yet")
    }

    // MARK: History

    func testSummariesSplitIntoSectionsAndSearchByEveryWord() {
        let summary = """
            **Decisions**
            - Booked the **Alfama** flat.
            - Took the [09:40 flight](https://example.invalid).
            ## Left open
            > Dinner on the last night.
            """
        let sections = SummaryText.sections(summary)
        XCTAssertEqual(sections.map(\.heading), ["Decisions", "Left open"])
        XCTAssertEqual(sections[0].items, ["Booked the Alfama flat.", "Took the 09:40 flight."])
        XCTAssertTrue(sections[0].list)
        XCTAssertEqual(sections[1].items, ["Dinner on the last night."])
        XCTAssertEqual(SummaryText.oneLine(summary), "Booked the Alfama flat. · Took the 09:40 flight. · Dinner on the last night.")
        let rows = [HistorySummary(threadId: "a", title: "Lisbon", archivedAt: 1, summary: summary),
                    HistorySummary(threadId: "b", title: "Taxes", archivedAt: 2, summary: "Filed.")]
        XCTAssertEqual(MemoryHistory.summaries(rows, words: MemoryHistory.words("  alfama  DINNER ")).map(\.id), ["a"])
        XCTAssertEqual(MemoryHistory.summaries(rows, words: []).count, 2)
    }

    func testPastConversationsMatchByTitleOrByAServerHit() {
        let rows = [PastConversation(threadId: "a", title: "Kitchen quotes", updatedAt: 1, latest: "Three in"),
                    PastConversation(threadId: "b", title: "Main", updatedAt: 2, archivedAt: 2, summary: "**Made**\n- A page")]
        let hits = ["b": ConversationHit(threadId: "b", snippet: "…the kitchen tiles…")]
        XCTAssertEqual(MemoryHistory.conversations(rows, words: ["kitchen"], hits: hits).map(\.id), ["a", "b"])
        XCTAssertEqual(MemoryHistory.conversations(rows, words: ["quotes"], hits: [:]).map(\.id), ["a"])
        XCTAssertEqual(MemoryHistory.detail(rows[1], hit: hits["b"]), "…the kitchen tiles…", "a hit's snippet first")
        XCTAssertEqual(MemoryHistory.detail(rows[1], hit: nil), "A page", "then the summary")
        XCTAssertEqual(MemoryHistory.detail(rows[0], hit: nil), "Three in", "then the latest message")
    }
}
