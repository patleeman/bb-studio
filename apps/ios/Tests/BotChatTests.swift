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
            case .child(let id, _): "child:\(id)"
            }
        }
        XCTAssertEqual(shape, ["day", "u1F", "u2L", "work", "a1F", "work", "a2L", "day", "a3FL"])
    }

    func testThreadsTheBotStartsBecomeCards() throws {
        let timeline = try rows("""
        [
          {"id":"a1","kind":"conversation","role":"assistant","text":"On it.","createdAt":\(day1)},
          {"id":"w1","kind":"work","workKind":"tool","toolName":"bb_thread_start","output":"{\\"threadId\\":\\"thr_abc12345\\"}","status":"completed","createdAt":\(day1 + 1)},
          {"id":"w2","kind":"work","workKind":"tool","toolName":"bb_thread_start","output":"thr_abc12345 again, and the bot thr_self0001","status":"completed","createdAt":\(day1 + 2)},
          {"id":"w3","kind":"work","workKind":"tool","toolName":"pages_read","output":"mentions thr_zzzzzzzz","status":"completed","createdAt":\(day1 + 3)}
        ]
        """)
        let children = BotChatEntry.build(timeline, botThreadId: "thr_self0001").compactMap { entry -> String? in
            if case .child(let id, _) = entry { id } else { nil }
        }
        XCTAssertEqual(children, ["thr_abc12345"])
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
