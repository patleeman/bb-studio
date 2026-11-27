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

    // MARK: Message grouping

    private func rows(_ json: String) throws -> [TimelineRow] {
        try JSONDecoder().decode([TimelineRow].self, from: Data(json.utf8))
    }

    private let day1 = 1_760_000_000_000.0
    private var day2: Double { day1 + 86_400_000 }

    private func thread(_ id: String, at: Double, parent: String? = nil, source: String? = nil, owner: String? = nil) throws -> ThreadEntry {
        let json: [String: Any?] = ["id": id, "projectId": "p", "status": "idle", "createdAt": at, "updatedAt": at,
                                    "parentThreadId": parent, "sourceThreadId": source, "lifecycleOwnerThreadId": owner]
        return try JSONDecoder().decode(ThreadEntry.self, from: JSONSerialization.data(withJSONObject: json.compactMapValues { $0 }))
    }

    func testSystemMessagesAboutThreadsBecomeCards() throws {
        let timeline = try rows("""
        [
          {"id":"a1","kind":"conversation","role":"assistant","text":"On it.","createdAt":\(day1)},
          {"id":"w1","kind":"work","workKind":"tool","toolName":"bb_thread_start","output":"thr_guessed1","status":"completed","createdAt":\(day1 + 10)},
          {"id":"a2","kind":"conversation","role":"assistant","text":"Started.","createdAt":\(day1 + 30)},
          {"id":"s1","kind":"conversation","role":"user","initiator":"system","text":"[bb system] done","systemMessageKind":"child-completed","systemMessageSubject":{"kind":"thread","threadId":"t_run","threadName":"Run"},"createdAt":\(day1 + 40)},
          {"id":"r1","kind":"system","title":"Thought","createdAt":\(day1 + 40)},
          {"id":"s1b","kind":"conversation","role":"user","initiator":"system","text":"[bb system] again","systemMessageKind":"child-failed","systemMessageSubject":{"kind":"thread","threadId":"t_run","threadName":"Run"},"createdAt":\(day1 + 40)},
          {"id":"s2","kind":"conversation","role":"user","initiator":"system","text":"[bb system] plumbing","createdAt":\(day1 + 41)},
          {"id":"a3","kind":"conversation","role":"assistant","text":"✓","createdAt":\(day1 + 42)},
          {"id":"a4","kind":"conversation","role":"assistant","text":" `[PASS]`\\n","createdAt":\(day1 + 43)}
        ]
        """)
        // The room's conversation: BB's word about a thread becomes a card, plumbing and the quiet ✓ and [PASS] go.
        let shown = timeline.filter(BotChatRows.shows)
        XCTAssertEqual(shown.map(\.id), ["a1", "w1", "a2", "s1", "r1", "s1b"])
        let cards = shown.compactMap { row in BotChatRows.childEvent(row).map { "\(row.id):\($0.threadId ?? "-"):\($0.status.rawValue)" } }
        XCTAssertEqual(cards, ["s1:t_run:finished", "s1b:t_run:failed"])
    }

    func testPassRepliesAreSilent() throws {
        for text in ["[PASS]", " [pass]\n", "`[PASS]`", "```\n[PASS]\n```", "**[Pass]**"] { XCTAssertTrue(SilentOutput.isPass(text), text) }
        for text in [nil, "", "PASS", "Tests: [PASS]", "[PASS]\nHere is the report.", "[PASS] done"] { XCTAssertFalse(SilentOutput.isPass(text), text ?? "nil") }
        let timeline = try rows("""
        [{"id":"u1","kind":"conversation","role":"user","text":"[PASS]","createdAt":1},
         {"id":"a1","kind":"conversation","role":"assistant","text":"[PASS]","createdAt":2},
         {"id":"a2","kind":"conversation","role":"assistant","text":"Found one.","createdAt":3}]
        """)
        XCTAssertEqual(timeline.map(\.isPassReply), [false, true, false])
        XCTAssertEqual(timeline.filter(BotChatRows.shows).map(\.id), ["u1", "a2"])
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

    // MARK: Activity

    // MARK: Reply in thread

    func testSideThreadsCompactLabel() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        let side = BotSideThread(messageId: "a1", threadId: "fork1", replies: 2, lastReplyAt: (now.timeIntervalSince1970 - 300) * 1000, working: false)
        XCTAssertEqual(side.compactLabel(now: now), "2 replies · 5m")
        var one = side
        one.replies = 1
        one.lastReplyAt = (now.timeIntervalSince1970 - 10) * 1000
        XCTAssertEqual(one.compactLabel(now: now), "1 reply · just now")
        one.lastReplyAt = (now.timeIntervalSince1970 - 3 * 3600) * 1000
        XCTAssertEqual(one.compactLabel(now: now), "1 reply · 3h")
        one.lastReplyAt = (now.timeIntervalSince1970 - 2 * 86_400) * 1000
        XCTAssertEqual(one.compactLabel(now: now), "1 reply · 2d")
        var working = side
        working.working = true
        XCTAssertEqual(working.compactLabel(now: now), "2 replies · working…")
        var fresh = side
        fresh.replies = 0
        XCTAssertEqual(fresh.compactLabel(now: now), "Thread")
    }
}
