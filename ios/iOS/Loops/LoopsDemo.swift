#if DEBUG
import Foundation

/// Debug builds: `-qaLoopsDemo` is the old to-do fixtures the presence
/// screen, In flight and old read-only cards read (`TasksDemo` answers
/// `tasks.*` from these), and old loop cards and a morning card in the
/// `-qaBotDemo` chat. `-qaLoopsEmpty`: no to-dos at all. `-qaLoopsMissing
/// <id>`: that one can't load. Nothing leaves the simulator.
enum LoopsDemo {
    static var mode: String? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: "-qaLoopsDemo") else { return nil }
        return arguments.indices.contains(index + 1) && !arguments[index + 1].hasPrefix("-") ? arguments[index + 1] : "on"
    }

    static var enabled: Bool { mode != nil && mode != "off" }
    /// The lead working on the Larkspur to-do.
    static let leadId = "thr_larkspur01"
    /// `-qaLoopsEmpty`: no to-dos at all.
    static var empty: Bool { ProcessInfo.processInfo.arguments.contains("-qaLoopsEmpty") }
    static var missing: String? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let at = arguments.firstIndex(of: "-qaLoopsMissing"), arguments.indices.contains(at + 1) else { return nil }
        return arguments[at + 1]
    }

    nonisolated(unsafe) private static var installed = false

    /// Answers Studio's settings before anything asks; other requests go where they went before.
    @MainActor static func installIfNeeded() {
        guard mode != nil, !installed else { return }
        installed = true
        ThreadTitles.set(leadId, "Larkspur lead")
        let previous = BBClient.demoTransport
        BBClient.demoTransport = { method, path, body in
            if method == "POST", path == "/api/v1/plugins/studio/rpc/settings.get" {
                let answer: [String: Any] = ["ok": true, "result": ["values": [String: Any](), "changed": [String](), "timeZone": "America/New_York"]]
                return (200, (try? JSONSerialization.data(withJSONObject: answer)) ?? Data())
            }
            if let previous { return try await previous(method, path, body) }
            throw URLError(.cannotConnectToHost)
        }
    }

    /// The chat's messages with loops: the morning card, then cards of each kind.
    static func messages() -> [(role: String, text: String)] {
        guard mode != nil else { return [] }
        return [
            ("user", "What's on today?"),
            ("assistant", morningText),
            ("assistant", "::loop{id=\"loop_deck\"}"),
            ("assistant", "::loop{id=\"loop_sam\"}"),
            ("assistant", "::loop{id=\"loop_vendor\"}"),
            ("assistant", "::loop{id=\"loop_lease\"}"),
            ("assistant", "::loop{id=\"loop_options\"}"),
            ("assistant", "::loop{id=\"loop_larkspur\"}"),
            ("user", "done with the hosting thing"),
            ("assistant", "Closed it.\n\n::loop{id=\"loop_hosting\"}"),
        ]
    }

    static let morningText = """
    ## Monday, Nov 2
    **Calendar**
    - 9:30 AM · Standup · Zoom
    - 12:30 PM · Lunch with Sam
    - 4:00 PM · Dentist · Dr. Patel
    **On today's list**
    ::loop{id="loop_tax" row="1"}
    ::loop{id="loop_deck" row="1"}
    ::loop{id="loop_sam" row="1"}
    ::loop{id="loop_flights" row="1"}
    ::loop{id="loop_vendor" row="1"}
    ::loops{more="3"}
    **Good to know**
    - Rain from 3 PM. Take an umbrella.
    - Mom's birthday is Saturday.
    """

    static var now: Double { (Date().timeIntervalSince1970 * 1000).rounded() }

    /// A to-do in `loops.*`'s shape, which `TasksDemo` turns into a task.
    static func loop(_ id: String, _ title: String, why: String = "", kind: String = "do", options: [String] = [], owner: String = "patrick",
                     trigger: [String: Any] = ["type": "none"], status: String = "surfaced", due: Double? = nil, area: String? = nil,
                     source: String? = nil, created: Double? = nil, closed: Double? = nil) -> [String: Any] {
        let created = created ?? now - 3_600_000
        return ["id": id, "title": title, "why": why,
                "source": source.map { ["kind": $0, "ref": "demo"] as [String: Any] } ?? NSNull(),
                "kind": kind, "options": options, "owner": owner, "trigger": trigger, "priority": "normal", "push": false,
                "status": status, "due": due ?? NSNull(), "area": area ?? NSNull(), "createdAt": created, "updatedAt": closed ?? created,
                "closedAt": closed ?? NSNull(), "closedBy": closed == nil ? NSNull() : "patrick"]
    }

    /// The mockups' loops (docs/attention-router/mockups), dated from today.
    static func seed() -> [[String: Any]] {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: .now)
        func day(_ days: Int, _ hour: Int = 17) -> Double {
            let date = calendar.date(byAdding: .day, value: days, to: today).flatMap { calendar.date(bySettingHour: hour, minute: 0, second: 0, of: $0) }
            return ((date ?? .now).timeIntervalSince1970 * 1000).rounded()
        }
        let friday = (6 - calendar.component(.weekday, from: .now) + 7) % 7
        let fri = friday == 0 ? 7 : friday
        let loop = Self.loop
        return [
            loop("loop_deck", "Choose the deck contractor", "Bayside starts sooner; Hudson is cheaper with better reviews.", "decide",
                 ["Bayside Decks · $4,200 · starts Nov 9", "Hudson Carpentry · $3,650 · starts Dec 1"], "patrick", ["type": "none"], "surfaced", day(fri), "Home", "email", nil, nil),
            loop("loop_sam", "Reply to Sam about the Q3 planning doc", "He asked for your input; the doc locks Friday.", "do",
                 [], "patrick", ["type": "none"], "surfaced", day(fri), "Job", "email", nil, nil),
            loop("loop_tax", "Pay the property tax installment", "$2,140 · county portal", "do", [], "patrick", ["type": "none"], "surfaced", day(0), "Home", nil, nil, nil),
            loop("loop_flights", "Book Thanksgiving flights", "Fares are up 8% since Friday.", "do", [], "patrick", ["type": "none"], "surfaced", day(1), "Home", nil, nil, nil),
            loop("loop_vendor", "Vendor demo moved to Thu 2:00 PM", "Same Zoom link. Nothing else changed.", "read", [], "patrick", ["type": "none"], "surfaced", nil, "Job", "calendar", nil, nil),
            loop("loop_options", "Pick the offsite venue", "Four places can host 12 people on the 14th.", "decide",
                 ["Lisbon · Hotel Lumen · €180/night", "Porto · Torel Palace · €210/night", "Madeira · Savoy · €160/night", "Sintra · Tivoli · €230/night"],
                 "patrick", ["type": "none"], "surfaced", day(3), "Job", nil, nil, nil),
            loop("loop_lease", "Signed lease addendum", "She said by Friday. Nothing yet.", "waiting", [], "patrick", ["type": "none"], "surfaced", nil, "Home", nil, day(-3, 11), nil),
            loop("loop_larkspur", "Draft the Larkspur Q4 lead summary", "", "do", [], "thread:thr_larkspur01", ["type": "none"], "in_progress", nil, "Larkspur", nil, now - 720_000, nil),
            loop("loop_hosting", "Cancel the hosting Pro trial", "", "do", [], "patrick", ["type": "none"], "done", nil, "Systems", nil, now - 7_200_000, now - 60_000),
            loop("loop_plumber", "Call the plumber about the slow drain", "", "do", [], "patrick", ["type": "place", "place": "home", "direction": "arrive"], "queued", nil, "Home", nil, nil, nil),
            loop("loop_expense", "Send the October expense report", "", "do", [], "patrick", ["type": "time", "at": day(fri, 15)], "queued", nil, "Job", nil, nil, nil),
            loop("loop_resume", "Send Sam your budget numbers", "", "do", [], "patrick", ["type": "event", "event": "reply:sam"], "queued", nil, "Job", nil, nil, nil),
            loop("loop_cleaning", "Pick up the dry cleaning", "", "do", [], "patrick", ["type": "place", "place": "office", "direction": "leave"], "queued", nil, "Home", nil, nil, nil),
        ]
    }
}
#endif
