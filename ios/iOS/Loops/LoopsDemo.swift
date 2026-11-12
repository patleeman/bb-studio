#if DEBUG
import Foundation

/// Debug builds: `-qaLoopsDemo` answers Studio's `loops.*` and its settings
/// from a local in-memory store with the mockups' loops, and adds loop cards
/// and a morning card to the `-qaBotDemo` chat. `-qaLoopsDemo off` is the
/// Attention Router turned off. Actions change the store as Studio would.
/// Nothing leaves the simulator.
enum LoopsDemo {
    static var mode: String? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: "-qaLoopsDemo") else { return nil }
        return arguments.indices.contains(index + 1) && !arguments[index + 1].hasPrefix("-") ? arguments[index + 1] : "on"
    }

    static var enabled: Bool { mode != nil && mode != "off" }
    /// The lead working on the Larkspur loop, a Hand off target.
    static let leadId = "thr_larkspur01"
    /// `-qaLoopsEmpty`: no loops at all.
    static var empty: Bool { ProcessInfo.processInfo.arguments.contains("-qaLoopsEmpty") }

    nonisolated(unsafe) private static var installed = false

    /// Answers before anything asks; other requests go where they went before.
    @MainActor static func installIfNeeded() {
        guard mode != nil, !installed else { return }
        installed = true
        ThreadTitles.set(leadId, "Larkspur lead")
        let previous = BBClient.demoTransport
        BBClient.demoTransport = { method, path, body in
            if let answer = Store.shared.respond(method, path, body) { return answer }
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

    final class Store: @unchecked Sendable {
        static let shared = Store()
        private let lock = NSLock()
        private var loops: [[String: Any]] = LoopsDemo.empty ? [] : LoopsDemo.seed()
        private var history: [String: [[String: Any]]] = [:]
        private var places: [String] = []
        /// Each request's method and body, for tests that read them back.
        private(set) var requests: [(String, [String: Any])] = []

        func respond(_ method: String, _ path: String, _ body: Data?) -> (Int, Data)? {
            if method == "POST", path == "/api/v1/plugins/studio/rpc/settings.get" {
                return ok(["values": ["loopsEnabled": LoopsDemo.enabled], "changed": ["loopsEnabled"], "timeZone": "America/New_York"])
            }
            let prefix = "/api/v1/plugins/studio/rpc/loops."
            guard method == "POST", path.hasPrefix(prefix) else { return nil }
            let name = String(path.dropFirst(prefix.count))
            let input = body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
            return lock.withLock {
                requests.append((name, input))
                switch name {
                case "list": return ok(groups())
                case "get":
                    guard let loop = find(input["id"] as? String) else { return (404, Data(#"{"ok":false,"error":{"message":"Loop not found"}}"#.utf8)) }
                    return ok(["loop": loop, "history": history[loop["id"] as! String] ?? []])
                case "act": return act(input)
                case "update": return update(input)
                case "add":
                    let now = Self.now
                    let loop = Self.loop("loop_new\(loops.count)", input["text"] as? String ?? "", owner: "cos", status: "in_progress", created: now)
                    loops.append(loop)
                    return ok(loop)
                case "place", "fire": return ok(["matched": 0])
                case "setPlaces":
                    places = input["names"] as? [String] ?? []
                    return ok(["names": places])
                case "places": return ok(["names": places])
                case "morning":
                    let items = ["loop_tax", "loop_deck", "loop_sam", "loop_flights", "loop_vendor"].compactMap(find)
                    return ok(["date": "2026-11-02", "items": items, "more": 3, "lowPriority": []])
                default: return nil
                }
            }
        }

        private func find(_ id: String?) -> [String: Any]? { loops.first { $0["id"] as? String == id } }

        private func replace(_ loop: [String: Any]) {
            if let index = loops.firstIndex(where: { $0["id"] as? String == loop["id"] as? String }) { loops[index] = loop }
        }

        private func event(_ id: String, _ type: String, _ data: [String: Any] = [:]) {
            let encoded = (try? JSONSerialization.data(withJSONObject: data)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
            history[id, default: []].append(["type": type, "at": Self.now, "data": encoded])
        }

        private func act(_ input: [String: Any]) -> (Int, Data) {
            guard var loop = find(input["id"] as? String), let action = input["action"] as? String else { return (400, Data()) }
            let id = loop["id"] as! String
            if !(loop["closedAt"] is NSNull) { return ok(loop) }
            switch action {
            case "done", "got_it", "choose", "drop":
                loop["status"] = action == "drop" ? "dropped" : "done"
                loop["closedAt"] = Self.now
                loop["closedBy"] = "patrick"
                event(id, "closed", ["action": action, "option": input["option"] ?? NSNull()])
            case "snooze":
                loop["status"] = "snoozed"
                loop["trigger"] = input["snooze"] as? String == "home"
                    ? ["type": "place", "place": "home", "direction": "arrive"] : ["type": "time", "at": Self.now + 3 * 3_600_000]
            case "hand_off":
                loop["owner"] = input["owner"] as? String ?? "cos"
                loop["status"] = "in_progress"
                event(id, "handed_off", ["owner": loop["owner"]!])
            default: break
            }
            loop["updatedAt"] = Self.now
            replace(loop)
            return ok(loop)
        }

        private func update(_ input: [String: Any]) -> (Int, Data) {
            guard var loop = find(input["id"] as? String) else { return (400, Data()) }
            if input["surfaceNow"] as? Bool == true {
                loop["status"] = "surfaced"
                loop["trigger"] = ["type": "none"]
            }
            for (key, value) in input["changes"] as? [String: Any] ?? [:] { loop[key] = value }
            if let status = loop["status"] as? String, !["done", "dropped"].contains(status), !(loop["closedAt"] is NSNull) {
                loop["closedAt"] = NSNull()
                loop["closedBy"] = NSNull()
            }
            loop["updatedAt"] = Self.now
            replace(loop)
            return ok(loop)
        }

        private func groups() -> [String: Any] {
            var g: [String: [[String: Any]]] = ["needsYouNow": [], "comingUp": [], "agentsOnIt": [], "waitingOnOthers": [], "done": []]
            for loop in loops {
                let key = !(loop["closedAt"] is NSNull) ? "done"
                    : loop["kind"] as? String == "waiting" ? "waitingOnOthers"
                    : loop["owner"] as? String != "patrick" ? "agentsOnIt"
                    : loop["status"] as? String == "surfaced" ? "needsYouNow" : "comingUp"
                g[key, default: []].append(loop)
            }
            return g
        }

        private func ok(_ result: Any) -> (Int, Data) { json(["ok": true, "result": result]) }

        private func json(_ value: Any) -> (Int, Data) {
            (200, (try? JSONSerialization.data(withJSONObject: value)) ?? Data())
        }

        static var now: Double { (Date().timeIntervalSince1970 * 1000).rounded() }

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
        let loop = Store.loop
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
            loop("loop_larkspur", "Draft the Larkspur Q4 lead summary", "", "do", [], "thread:thr_larkspur01", ["type": "none"], "in_progress", nil, "Larkspur", nil, Store.now - 720_000, nil),
            loop("loop_hosting", "Cancel the hosting Pro trial", "", "do", [], "patrick", ["type": "none"], "done", nil, "Systems", nil, Store.now - 7_200_000, Store.now - 60_000),
            loop("loop_plumber", "Call the plumber about the slow drain", "", "do", [], "patrick", ["type": "place", "place": "home", "direction": "arrive"], "queued", nil, "Home", nil, nil, nil),
            loop("loop_expense", "Send the October expense report", "", "do", [], "patrick", ["type": "time", "at": day(fri, 15)], "queued", nil, "Job", nil, nil, nil),
            loop("loop_resume", "Send Sam your budget numbers", "", "do", [], "patrick", ["type": "event", "event": "reply:sam"], "queued", nil, "Job", nil, nil, nil),
            loop("loop_cleaning", "Pick up the dry cleaning", "", "do", [], "patrick", ["type": "place", "place": "office", "direction": "leave"], "queued", nil, "Home", nil, nil, nil),
        ]
    }
}
#endif
