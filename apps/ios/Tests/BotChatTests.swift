import SwiftUI
import XCTest
@testable import BBStudio

final class BotChatTests: XCTestCase {
    // MARK: Avatar

    func testEveryDesktopShapeParsesInsideTheBoard() {
        XCTAssertEqual(BotShape.allCases.map(\.rawValue), ["blob", "circle", "triangle", "hexagon", "cloud", "droplet", "square", "star", "pill"])
        for shape in BotShape.allCases {
            let bounds = shape.path.boundingRect
            XCTAssertFalse(bounds.isEmpty, "\(shape)")
            XCTAssertGreaterThan(bounds.width, 20, "\(shape)")
            XCTAssertGreaterThanOrEqual(bounds.minX, 1, "\(shape)")
            XCTAssertLessThanOrEqual(bounds.maxX, 40, "\(shape)")
            XCTAssertLessThanOrEqual(bounds.maxY, 40, "\(shape)")
            // The eyes land on the shape.
            XCTAssertTrue(shape.path.contains(CGPoint(x: 15.5, y: shape.eyesY)), "\(shape)")
            XCTAssertTrue(shape.path.contains(CGPoint(x: 24.5, y: shape.eyesY)), "\(shape)")
        }
    }

    func testCircleArcsDrawAFullCircle() {
        let bounds = BotShape.circle.path.boundingRect
        XCTAssertEqual(bounds.minX, 3, accuracy: 0.05)
        XCTAssertEqual(bounds.maxX, 37, accuracy: 0.05)
        XCTAssertEqual(bounds.minY, 3, accuracy: 0.05)
        XCTAssertEqual(bounds.maxY, 37, accuracy: 0.05)
    }

    func testEyesSitWhereTheDesktopPutsThem() {
        XCTAssertEqual(BotShape.triangle.eyesY, 25)
        XCTAssertEqual(BotShape.droplet.eyesY, 24)
        XCTAssertEqual(BotShape.cloud.eyesY, 24)
        XCTAssertEqual(BotShape.star.eyesY, 21)
        XCTAssertEqual(BotShape.blob.eyesY, 20)
    }

    func testColorForNameMatchesTheDesktop() {
        // JS: hash = (hash * 31 + codePoint) >>> 0 over the trimmed, lowercased name.
        func js(_ name: String) -> String {
            var hash: UInt64 = 0
            for scalar in name.trimmingCharacters(in: .whitespaces).lowercased().unicodeScalars { hash = (hash * 31 + UInt64(scalar.value)) & 0xffff_ffff }
            return BotPalette.hexes[Int(hash % 12)]
        }
        for name in ["Bot", "Dot", "  Penny ", "Chief of Staff", "Zoë", "A very long bot name that overflows thirty-two bits"] {
            XCTAssertEqual(BotPalette.hex(forName: name), js(name), name)
        }
        XCTAssertEqual(BotPalette.hex(forName: "bot"), BotPalette.hex(forName: "BOT "))
    }

    func testLookFallsBackToEmojiForOldBots() {
        XCTAssertNil(BotLook(shape: nil, color: nil, emoji: "🧭").shape)
        XCTAssertNil(BotLook(shape: "octagon", color: nil, emoji: "🧭").shape)
        XCTAssertEqual(BotLook(shape: "star", color: "#46a758", emoji: "🧭").shape, .star)
        XCTAssertNotNil(BotPalette.rgb("#46a758"))
        XCTAssertNil(BotPalette.rgb("green"))
    }

    func testBotDecodesItsLook() async throws {
        let client = BBClient(baseURL: URL(string: "https://bot-look.invalid")!)
        client.transport = { _, _, _ in
            (200, Data(##"{"ok":true,"result":{"bot":{"id":"bot_main","name":"Pip","avatar":"🤖","state":"paused","threadId":"thr_pip","shape":"cloud","color":"#2ba59a","role":"Keeps me honest.","createdAt":1,"updatedAt":1},"run":{"enabled":true,"cadence":"weekdays","time":"08:00"}}}"##.utf8))
        }
        let bot = try await client.bot()
        XCTAssertEqual(bot?.look.shape, .cloud)
        XCTAssertEqual(bot?.color, "#2ba59a")
        XCTAssertEqual(bot?.role, "Keeps me honest.")
        XCTAssertEqual(client.cachedBotLook.shape, .cloud)
        XCTAssertEqual(BotStatus.line(state: bot?.state, running: true, thinking: nil, needsYou: 0, lead: bot?.lead), "Paused")
        XCTAssertEqual(BotStatus.line(state: .active, running: false, thinking: nil, needsYou: 0, lead: bot?.lead), "Checks in weekdays 8:00")
        XCTAssertEqual(BotStatus.line(state: .active, running: true, thinking: nil, needsYou: 0, lead: bot?.lead), "Thinking…")
        XCTAssertEqual(BotStatus.line(state: .active, running: true, thinking: nil, needsYou: 2, lead: bot?.lead), "2 things need you")
    }

    // MARK: Message grouping

    private func rows(_ json: String) throws -> [TimelineRow] {
        try JSONDecoder().decode([TimelineRow].self, from: Data(json.utf8))
    }

    private let day1 = 1_760_000_000_000.0
    private var day2: Double { day1 + 86_400_000 }

    func testRunsShowTheAvatarOnceAndDaysSeparate() throws {
        let timeline = try rows("""
        [
          {"id":"u1","kind":"conversation","role":"user","text":"Hi","createdAt":\(day1)},
          {"id":"u2","kind":"conversation","role":"user","text":"You there?","createdAt":\(day1 + 1000)},
          {"id":"w1","kind":"work","workKind":"tool","toolName":"pages_read","status":"completed","createdAt":\(day1 + 2000)},
          {"id":"a1","kind":"conversation","role":"assistant","text":"Yes.","createdAt":\(day1 + 3000)},
          {"id":"w2","kind":"work","workKind":"tool","toolName":"search","status":"completed","createdAt":\(day1 + 4000)},
          {"id":"a2","kind":"conversation","role":"assistant","text":"Found it.","createdAt":\(day1 + 5000)},
          {"id":"a3","kind":"conversation","role":"assistant","text":"Next day","createdAt":\(day2)}
        ]
        """)
        let entries = BotChatEntry.build(timeline)
        let shape: [String] = entries.map {
            switch $0 {
            case .day: "day"
            case .message(let row, let first, let last): "\(row.id)\(first ? "F" : "")\(last ? "L" : "")"
            case .work: "work"
            case .child(_, let id): "child:\(id)"
            }
        }
        XCTAssertEqual(shape, ["day", "u1F", "u2L", "work", "a1F", "work", "a2L", "day", "a3FL"])
    }

    private func thread(_ id: String, at: Double, parent: String? = nil, source: String? = nil, owner: String? = nil) throws -> ThreadEntry {
        let json: [String: Any?] = ["id": id, "projectId": "p", "status": "idle", "createdAt": at, "updatedAt": at,
                                    "parentThreadId": parent, "sourceThreadId": source, "lifecycleOwnerThreadId": owner]
        return try JSONDecoder().decode(ThreadEntry.self, from: JSONSerialization.data(withJSONObject: json.compactMapValues { $0 }))
    }

    func testStartedThreadsComeFromMetadataWithLiveStatus() throws {
        let activity = try JSONDecoder().decode(BotActivity.self, from: Data("""
        {"needsYou":[{"id":"t_ask","title":"Ask","status":"active","relation":"started","needsYou":true,"updatedAt":1}],
         "inProgress":[{"id":"t_run","title":"Run","status":"active","relation":"started","needsYou":false,"updatedAt":1},
                       {"id":"thr_self","title":"Bot","status":"active","relation":"self","needsYou":false,"updatedAt":1}],
         "scheduled":[],
         "completed":[{"id":"t_done","title":"Done","status":"idle","relation":"started","needsYou":false,"updatedAt":1},
                      {"id":"t_bad","title":"Bad","status":"error","relation":"started","needsYou":false,"updatedAt":1},
                      {"id":"t_other","title":"Someone else's","status":"idle","relation":"started","needsYou":false,"updatedAt":1}],
         "latest":null}
        """.utf8))
        let threads = Dictionary(uniqueKeysWithValues: try [
            thread("t_ask", at: 4, source: "thr_old"), thread("t_run", at: 3, parent: "thr_self"),
            thread("t_done", at: 1, owner: "thr_self"), thread("t_bad", at: 2, parent: "thr_self"),
            thread("t_other", at: 5, parent: "thr_elsewhere"),
        ].map { ($0.id, $0) })
        let started = BotStartedThread.list(activity: activity, threads: threads, chain: ["thr_old", "thr_self"])
        XCTAssertEqual(started.map(\.id), ["t_done", "t_bad", "t_run", "t_ask"])
        XCTAssertEqual(started.map(\.status), [.finished, .failed, .running, .needsYou])
    }

    func testStartedCardsGoWhereTheyWereMadeAndSystemMessagesBecomeCards() throws {
        let timeline = try rows("""
        [
          {"id":"a1","kind":"conversation","role":"assistant","text":"On it.","createdAt":\(day1)},
          {"id":"w1","kind":"work","workKind":"tool","toolName":"bb_thread_start","output":"thr_guessed1","status":"completed","createdAt":\(day1 + 10)},
          {"id":"a2","kind":"conversation","role":"assistant","text":"Started.","createdAt":\(day1 + 30)},
          {"id":"s1","kind":"conversation","role":"user","initiator":"system","text":"[bb system] done","systemMessageKind":"child-completed","systemMessageSubject":{"kind":"thread","threadId":"t_run","threadName":"Run"},"createdAt":\(day1 + 40)},
          {"id":"r1","kind":"system","title":"Thought","createdAt":\(day1 + 40)},
          {"id":"s1b","kind":"conversation","role":"user","initiator":"system","text":"[bb system] again","systemMessageKind":"child-failed","systemMessageSubject":{"kind":"thread","threadId":"t_run","threadName":"Run"},"createdAt":\(day1 + 40)},
          {"id":"s2","kind":"conversation","role":"user","initiator":"system","text":"[bb system] plumbing","createdAt":\(day1 + 41)},
          {"id":"a3","kind":"conversation","role":"assistant","text":"✓","createdAt":\(day1 + 42)}
        ]
        """)
        let started = [BotStartedThread(id: "t_run", title: "Run", createdAt: day1 + 20, status: .running),
                       BotStartedThread(id: "t_old", title: "Before", createdAt: day1 - 5, status: .finished)]
        let shape: [String] = BotChatEntry.build(timeline, started: started).map {
            switch $0 {
            case .day: "day"
            case .message(let row, _, _): row.id
            case .work: "work"
            case .child(let event, _): "\(event.verb == .started ? "started" : "update"):\(event.threadId ?? "-"):\(event.status.rawValue)"
            }
        }
        XCTAssertEqual(shape, ["day", "a1", "work", "started:t_run:running", "a2", "update:t_run:failed"])
    }

    func testChainMergeHidesHandoffRequests() throws {
        let old = try rows("""
        [{"id":"o1","kind":"conversation","role":"user","text":"Hi","createdAt":1},
         {"id":"o2","kind":"conversation","role":"assistant","text":"Hello","createdAt":2}]
        """)
        let new = try rows("""
        [{"id":"n1","kind":"conversation","role":"user","text":"Continue from thr_old: summary…","createdAt":3},
         {"id":"n2","kind":"conversation","role":"assistant","text":"Back","createdAt":4},
         {"id":"n3","kind":"conversation","role":"user","text":"Thanks","createdAt":5}]
        """)
        let merged = BotChain.merge([.init(threadId: "thr_old", rows: old, continuation: false),
                                     .init(threadId: "thr_new", rows: new, continuation: true)])
        XCTAssertEqual(merged.map(\.id), ["o1", "o2", "n2", "n3"])
        // Until a thread's start is loaded, its first user message is real.
        let partial = BotChain.merge([.init(threadId: "thr_new", rows: Array(new.dropFirst()), continuation: false)])
        XCTAssertEqual(partial.map(\.id), ["n2", "n3"])
        // The same row twice (a page refetched) shows once.
        let twice = BotChain.merge([.init(threadId: "thr_old", rows: old + old, continuation: false)])
        XCTAssertEqual(twice.map(\.id), ["o1", "o2"])
    }

    func testQuickRepliesComeFromTheLastReplyOnly() throws {
        let answered = try rows("""
        [{"id":"a1","kind":"conversation","role":"assistant","text":"Ready?\\n\\n::next{reply=\\"👍 Ship it|✋ Wait\\" do=\\"📄 Write it up\\"}"},
         {"id":"u1","kind":"conversation","role":"user","text":"Ship it"}]
        """)
        XCTAssertEqual(BotQuickReplies.items(in: answered), [])
        XCTAssertEqual(BotQuickReplies.items(in: Array(answered.prefix(1))), ["👍 Ship it", "✋ Wait", "📄 Write it up"])
    }

    func testDayLabels() {
        let now = Date()
        XCTAssertEqual(BotChatEntry.dayLabel(now, now: now), "Today")
        XCTAssertEqual(BotChatEntry.dayLabel(now.addingTimeInterval(-86_400), now: now), "Yesterday")
        XCTAssertEqual(BotChatEntry.date(1_760_000_000), Date(timeIntervalSince1970: 1_760_000_000))
        XCTAssertEqual(BotChatEntry.date(1_760_000_000_000), Date(timeIntervalSince1970: 1_760_000_000))
    }

    // MARK: Activity sections

    func testActivityShowsOnlyNonEmptySectionsInOrder() throws {
        let activity = try JSONDecoder().decode(BotActivity.self, from: Data("""
        {"needsYou":[{"id":"t1","title":"Deploy","status":"running","relation":"started","needsYou":true,"updatedAt":1}],
         "waiting":[],
         "inProgress":[{"id":"t2","title":"Research","status":"running","relation":"started","needsYou":false,"updatedAt":2}],
         "scheduled":[{"id":"h","kind":"heartbeat","name":"Check-in","enabled":true,"nextRunAt":3},
                      {"id":"a","kind":"automation","name":"Off one","enabled":false}],
         "completed":[]}
        """.utf8))
        let sections = BotActivitySection.sections(activity)
        XCTAssertEqual(sections.map(\.kind), [.needsYou, .running, .scheduled])
        XCTAssertEqual(sections[2].rows.count, 1)
        XCTAssertEqual(BotActivitySection.sections(nil), [])
    }

    func testOlderStudioWithoutWaitingStillDecodes() throws {
        let activity = try JSONDecoder().decode(BotActivity.self, from: Data(#"{"needsYou":[],"inProgress":[],"scheduled":[],"completed":[{"id":"t","title":"Done","status":"idle","relation":"started","needsYou":false,"updatedAt":1}]}"#.utf8))
        XCTAssertNil(activity.waiting)
        XCTAssertEqual(BotActivitySection.sections(activity).map(\.title), ["Recent"])
    }
}
