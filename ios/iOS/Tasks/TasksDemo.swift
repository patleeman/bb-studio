#if DEBUG
import Foundation

enum TasksDemo {
    static var enabled: Bool { LoopsDemo.enabled && !ProcessInfo.processInfo.arguments.contains("-qaTasksOld") }
    static var old: Bool { LoopsDemo.mode != nil && !enabled }

    nonisolated(unsafe) private static var installed = false
    static let offline = ProcessInfo.processInfo.arguments.contains("-qaTasksOffline")
    static let started = ProcessInfo.processInfo.systemUptime

    @MainActor static func installIfNeeded() {
        LoopsDemo.installIfNeeded()
        guard LoopsDemo.mode != nil, !installed else { return }
        installed = true
        ThreadTitles.set("thr_demo_w1", "Studio-native BB fork")
        ThreadTitles.set("thr_demo_w3", "Mock question bank")
        let previous = BBClient.demoTransport
        BBClient.demoTransport = { method, path, body in
            if offline, path.contains("/rpc/tasks."), ProcessInfo.processInfo.systemUptime - started < 45 { throw URLError(.notConnectedToInternet) }
            if let answer = Store.shared.respond(method, path, body) { return answer }
            if let previous { return try await previous(method, path, body) }
            throw URLError(.cannotConnectToHost)
        }
    }

    static func messages() -> [(role: String, text: String)] {
        guard enabled, !LoopsDemo.empty, ProcessInfo.processInfo.arguments.contains("-qaTaskCards") else { return [] }
        return [
            ("user", "How are the workers doing?"),
            ("assistant", "The fork is on tests. The stills need you.\n\n::work{id=\"wc_demo_fork\"}\n::work{id=\"wc_demo_stills\"}"),
            ("assistant", "::loop{id=\"task_demo_spend\"}"),
            ("assistant", "The question bank worker stopped.\n\n::work{id=\"wc_demo_bank\"}"),
        ]
    }

    final class Store: @unchecked Sendable {
        static let shared = Store()
        private let lock = NSLock()
        private var tasks: [[String: Any]] = LoopsDemo.empty ? [] : TasksDemo.seed()
        private var history: [String: [[String: Any]]] = TasksDemo.seedHistory()
        private(set) var requests: [(String, [String: Any])] = []

        func respond(_ method: String, _ path: String, _ body: Data?) -> (Int, Data)? {
            guard method == "POST" else { return nil }
            let base = "/api/v1/plugins/studio/rpc/"
            guard path.hasPrefix(base) else { return nil }
            let name = String(path.dropFirst(base.count))
            guard name.hasPrefix("tasks.") || name.hasPrefix("work.") || name == "loops.add" else { return nil }
            if TasksDemo.old {
                return name == "loops.add" ? nil : (404, Data(#"{"ok":false,"error":{"message":"Unknown method"}}"#.utf8))
            }
            let input = body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
            return lock.withLock {
                requests.append((name, input))
                switch name {
                case "tasks.list":
                    let since = Self.now - 7 * 86_400_000
                    let list = tasks.filter { ($0["closedAt"] as? Double).map { $0 > since } ?? true }
                    return ok(["tasks": list, "threads": threads(), "held": []])
                case "tasks.get":
                    guard let task = find(input["id"] as? String) else { return (404, Data(#"{"ok":false,"error":{"message":"Task not found"}}"#.utf8)) }
                    let id = task["id"] as! String
                    let runs = tasks.filter { $0["parentId"] as? String == id }
                    return ok(["task": task, "history": history[id] ?? [], "todo": isTodo(task), "threads": threads(), "runs": runs])
                case "tasks.inFlight":
                    let threadId = input["threadId"] as? String ?? ""
                    let since = Self.now - 30 * 60_000
                    let rows = tasks.filter { task in
                        guard task["conversation"] as? String == threadId else { return false }
                        let closed = (task["closedAt"] as? Double).map { $0 <= since } ?? false
                        if closed { return false }
                        if let card = task["card"] as? [String: Any] { return card["dismissedAt"] is NSNull }
                        return task["closedAt"] is NSNull
                    }
                    return ok(["tasks": rows, "threads": threads()])
                case "tasks.act": return act(input)
                case "work.dismiss":
                    guard var task = find(input["id"] as? String), var card = task["card"] as? [String: Any] else { return (400, Data()) }
                    card["dismissedAt"] = Self.now
                    task["card"] = card
                    replace(task)
                    return ok(task)
                case "work.clear":
                    let threadId = input["threadId"] as? String ?? ""
                    var cleared = 0
                    for var task in tasks where task["conversation"] as? String == threadId && !(task["closedAt"] is NSNull) {
                        guard var card = task["card"] as? [String: Any], card["dismissedAt"] is NSNull else { continue }
                        card["dismissedAt"] = Self.now
                        task["card"] = card
                        replace(task)
                        cleared += 1
                    }
                    return ok(["cleared": cleared])
                case "loops.add":
                    let text = (input["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                    let id = "loop_typed\(tasks.count)"
                    let task = Self.task(id, text, queue: "surfaced", origin: "loop", created: Self.now)
                    tasks.append(task)
                    event(id, "added_by_you")
                    return ok(Self.loopShape(task))
                default: return nil
                }
            }
        }

        private func isTodo(_ task: [String: Any]) -> Bool {
            if task["automation"] is [String: Any] { return task["owner"] as? String == "patrick" }
            return task["origin"] as? String != "work"
        }

        private func threads() -> [[String: Any]] {
            [["owner": "thread:thr_demo_w1", "name": "Studio-native BB fork", "threadId": "thr_demo_w1"],
             ["owner": "thread:thr_demo_w3", "name": "Mock question bank", "threadId": "thr_demo_w3"],
             ["owner": "thread:\(LoopsDemo.leadId)", "name": "Larkspur lead", "threadId": LoopsDemo.leadId],
             ["owner": "thread:\(BotDemo.threadId)", "name": "Main", "threadId": BotDemo.threadId]]
        }

        private func find(_ id: String?) -> [String: Any]? { tasks.first { $0["id"] as? String == id } }

        private func replace(_ task: [String: Any]) {
            if let index = tasks.firstIndex(where: { $0["id"] as? String == task["id"] as? String }) { tasks[index] = task }
        }

        private func event(_ id: String, _ type: String, _ data: [String: Any] = [:]) {
            let encoded = (try? JSONSerialization.data(withJSONObject: data)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
            history[id, default: []].append(["type": type, "at": Self.now, "data": encoded])
        }

        private func handedBy(_ id: String) -> String? {
            for event in (history[id] ?? []).reversed() where event["type"] as? String == "handed_off" {
                let data = (event["data"] as? String).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] } ?? [:]
                if data["by"] as? String == "patrick" { continue }
                return data["owner"] as? String == "patrick" ? data["from"] as? String : nil
            }
            return nil
        }

        private func act(_ input: [String: Any]) -> (Int, Data) {
            guard var task = find(input["id"] as? String), let action = input["action"] as? String else { return (400, Data()) }
            let id = task["id"] as! String
            let closed = !(task["closedAt"] is NSNull)
            let owner = task["owner"] as? String ?? "patrick"
            var note: Any = NSNull()
            func close(_ state: String) {
                task["state"] = state
                task["closedAt"] = Self.now
                task["closedBy"] = "patrick"
                event(id, "closed", ["action": action, "option": input["option"] ?? NSNull(), "by": "patrick"])
            }
            switch action {
            case "hand_off":
                guard !closed else { return (400, Data(#"{"ok":false,"error":{"message":"This task is closed. Reopen it first."}}"#.utf8)) }
                let to = input["to"] as? String ?? "cos"
                task["owner"] = to
                task["state"] = "in_progress"
                task["needs"] = NSNull()
                task["attention"] = ["queue": NSNull(), "push": false]
                event(id, "handed_off", ["owner": to, "from": owner, "by": "patrick"])
            case "take_back":
                guard !closed else { return (400, Data()) }
                task["owner"] = "patrick"
                task["state"] = "todo"
                task["attention"] = ["queue": "surfaced", "push": false]
                task["progress"] = ["step": NSNull(), "line": NSNull()]
                event(id, "handed_off", ["owner": "patrick", "from": owner, "by": "patrick"])
            case "choose":
                if let from = handedBy(id), owner == "patrick", !closed {
                    task["owner"] = from
                    task["state"] = "in_progress"
                    task["needs"] = NSNull()
                    task["options"] = []
                    task["kind"] = "do"
                    task["progress"] = ["step": NSNull(), "line": "Chose: \(input["option"] as? String ?? "")"]
                    event(id, "acted", ["action": "choose", "option": input["option"] ?? NSNull()])
                    note = NSNull()
                } else if !closed {
                    close("done")
                    task["progress"] = ["step": NSNull(), "line": "Chose: \(input["option"] as? String ?? "")"]
                }
            case "done", "got_it": if !closed { close("done") }
            case "drop": if !closed { close("dropped") }
            case "snooze":
                guard isTodo(task), owner == "patrick" else { return (400, Data(#"{"ok":false,"error":{"message":"Only your own to-dos can be snoozed or nudged."}}"#.utf8)) }
                var timing = task["timing"] as? [String: Any] ?? [:]
                timing["snoozed"] = true
                timing["trigger"] = input["snooze"] as? String == "home" ? ["type": "place", "place": "home", "direction": "arrive"] : ["type": "time", "at": (input["at"] as? Double) ?? Self.now + 3 * 3_600_000]
                task["timing"] = timing
                task["attention"] = ["queue": "queued", "push": false]
                event(id, "snoozed")
            case "reopen":
                guard closed || task["stale"] as? Bool == true else { break }
                task["closedAt"] = NSNull()
                task["closedBy"] = NSNull()
                task["stale"] = false
                if owner == "patrick" {
                    task["state"] = "todo"
                    task["attention"] = ["queue": "surfaced", "push": false]
                } else {
                    task["state"] = "in_progress"
                }
                event(id, "reopened")
            default: break
            }
            task["updatedAt"] = Self.now
            replace(task)
            return ok(["task": task, "note": note])
        }

        private func ok(_ result: Any) -> (Int, Data) {
            (200, (try? JSONSerialization.data(withJSONObject: ["ok": true, "result": result])) ?? Data())
        }

        static var now: Double { (Date().timeIntervalSince1970 * 1000).rounded() }

        static func task(_ id: String, _ title: String, why: String = "", owner: String = "patrick", state: String = "todo", kind: String = "do",
                         options: [String] = [], needs: String? = nil, conversation: String? = nil, area: String? = nil, due: Double? = nil,
                         trigger: [String: Any] = ["type": "none"], snoozed: Bool = false, queue: String? = nil, step: String? = nil, line: String? = nil,
                         workers: [String] = [], card: String? = nil, automation: [String: Any]? = nil, schedule: [String: Any]? = nil, parentId: String? = nil,
                         stale: Bool = false, origin: String = "task", priority: String = "normal", created: Double? = nil, closed: Double? = nil) -> [String: Any] {
            let created = created ?? now - 3_600_000
            let closedState = ["done", "dropped", "failed"].contains(state)
            return ["id": id, "title": title, "why": why, "owner": owner, "state": state, "kind": kind, "options": options,
                    "needs": (needs as Any?) ?? NSNull(), "priority": priority, "conversation": (conversation as Any?) ?? NSNull(), "project": NSNull(), "area": (area as Any?) ?? NSNull(),
                    "timing": ["due": (due as Any?) ?? NSNull(), "trigger": trigger, "snoozed": snoozed],
                    "attention": ["queue": (queue as Any?) ?? NSNull(), "push": false],
                    "progress": ["step": (step as Any?) ?? NSNull(), "line": (line as Any?) ?? NSNull()],
                    "workers": workers, "outputs": [], "source": NSNull(), "parentId": (parentId as Any?) ?? NSNull(), "schedule": (schedule as Any?) ?? NSNull(),
                    "card": card.map { ["kind": $0, "messageId": NSNull(), "messageSeq": NSNull(), "dismissedAt": NSNull()] as [String: Any] } as Any? ?? NSNull(),
                    "automation": (automation as Any?) ?? NSNull(), "stale": stale, "origin": origin, "createdAt": created,
                    "updatedAt": closed ?? created, "closedAt": closedState ? (closed ?? now - 60_000) : NSNull(), "closedBy": closedState ? owner : NSNull()]
        }

        static func loopShape(_ task: [String: Any]) -> [String: Any] {
            let timing = task["timing"] as? [String: Any] ?? [:]
            return ["id": task["id"]!, "title": task["title"]!, "why": task["why"]!, "source": NSNull(), "kind": task["kind"]!, "options": task["options"]!,
                    "owner": task["owner"]!, "trigger": timing["trigger"] ?? ["type": "none"], "priority": "normal", "push": false, "status": "surfaced",
                    "due": NSNull(), "area": NSNull(), "createdAt": task["createdAt"]!, "updatedAt": task["updatedAt"]!, "closedAt": NSNull(), "closedBy": NSNull()]
        }
    }

    static func seed() -> [[String: Any]] {
        let now = Store.now
        let main = BotDemo.threadId
        var out: [[String: Any]] = LoopsDemo.seed().map { loop in
            let status = loop["status"] as? String ?? "surfaced"
            let kind = loop["kind"] as? String == "waiting" ? "waiting-outside" : loop["kind"] as? String ?? "do"
            let state = status == "done" ? "done" : status == "dropped" ? "dropped" : status == "in_progress" ? "in_progress" : kind == "waiting-outside" ? "waiting" : "todo"
            let queue: String? = status == "surfaced" ? "surfaced" : status == "queued" || status == "snoozed" ? "queued" : nil
            return Store.task(loop["id"] as! String, loop["title"] as! String, why: loop["why"] as? String ?? "", owner: loop["owner"] as? String ?? "patrick",
                        state: state, kind: kind, options: loop["options"] as? [String] ?? [], area: loop["area"] as? String, due: loop["due"] as? Double,
                        trigger: loop["trigger"] as? [String: Any] ?? ["type": "none"], snoozed: status == "snoozed", queue: queue,
                        origin: "loop", created: loop["createdAt"] as? Double, closed: loop["closedAt"] as? Double)
        }
        for index in out.indices where ["loop_options", "loop_flights"].contains(out[index]["id"] as? String) {
            out[index]["attention"] = ["queue": "queued", "push": false]
        }
        out.insert(Store.task("task_demo_quote", "Approve the plumber's quote", why: "Two quotes came in for the slow drain.", state: "waiting", kind: "decide",
                        options: ["Ace Plumbing · $480", "Second quote"], needs: "Which one should I book?", conversation: main, area: "Home", queue: "surfaced", created: now - 1_800_000), at: 0)
        out += [
            Store.task("task_demo_spend", "Spend alert: Claude spend over the daily budget", why: "$41 today against a $30 budget.", state: "waiting",
                 needs: "Check what is using it", conversation: main, queue: "surfaced",
                 automation: ["id": "aut_demo_spend", "kind": "watcher", "role": "finding", "thread": NSNull(), "keys": ["spend"], "count": 3, "lastAt": now - 600_000,
                              "mode": "dedupe", "clearedAt": NSNull(), "severity": "critical"], parentId: "task_auto-aut_demo_spend", created: now - 600_000),
            Store.task("wc_demo_fork", "Studio-native BB fork", owner: "thread:thr_demo_w1", state: "in_progress", conversation: main, step: "3/5 Tests",
                 line: "Unit tests running", workers: ["thr_demo_w1"], card: "worker", origin: "work", created: now - 2_400_000),
            Store.task("wc_demo_stills", "Theme stills renderer", state: "waiting", needs: "Light or dark set for the stills?", conversation: main, step: "2/4",
                 workers: ["thr_demo_w1"], card: "worker", origin: "work", created: now - 1_200_000),
            Store.task("wc_demo_bank", "Mock question bank", owner: "thread:thr_demo_w3", state: "in_progress", conversation: main, line: "Wrote 12 of 20 questions",
                 workers: ["thr_demo_w3"], card: "worker", stale: true, origin: "work", created: now - 5_400_000),
            Store.task("wc_demo_notes", "Release notes", owner: "thread:thr_demo_w1", state: "done", conversation: main, line: "Posted to the release page",
                 workers: ["thr_demo_w1"], card: "worker", origin: "work", created: now - 3_600_000, closed: now - 900_000),
            Store.task("task_demo_disk", "Disk space: /Volumes/Data is 92% full", owner: "cos", state: "in_progress", conversation: main, line: "Found again at 92%",
                 automation: ["id": "aut_demo_disk", "kind": "watcher", "role": "finding", "thread": NSNull(), "keys": ["disk"], "count": 4, "lastAt": now - 300_000,
                              "mode": "dedupe", "clearedAt": NSNull(), "severity": "warn"], created: now - 86_400_000),
            Store.task("task_auto-aut_demo_checkin", "Daily check-in", owner: "cos", state: "in_progress", line: "Nothing new",
                 automation: ["id": "aut_demo_checkin", "kind": "checkin", "role": "schedule", "thread": NSNull(), "keys": [], "count": 0, "lastAt": NSNull(),
                              "mode": NSNull(), "clearedAt": NSNull(), "severity": NSNull()],
                 schedule: ["text": "Every day at 1:00 PM", "cron": "0 13 * * *", "timeZone": "America/New_York", "automationId": "aut_demo_checkin", "paused": false],
                 created: now - 900_000_000),
        ]
        return out
    }

    static func seedHistory() -> [String: [[String: Any]]] {
        let now = Store.now
        func event(_ type: String, _ at: Double, _ data: [String: Any]) -> [String: Any] {
            ["type": type, "at": at, "data": (try? JSONSerialization.data(withJSONObject: data)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"]
        }
        return [
            "task_demo_quote": [event("created", now - 1_800_000, ["owner": "cos", "by": "cos"]),
                                event("handed_off", now - 1_700_000, ["owner": "patrick", "from": "cos", "by": "cos", "needs": "Which one should I book?"])],
            "wc_demo_fork": [event("created", now - 2_400_000, ["owner": "thread:thr_demo_w1", "by": "cos"]),
                             event("progress", now - 600_000, ["step": "3/5 Tests", "line": "Unit tests running"])],
            "wc_demo_stills": [event("created", now - 1_200_000, ["owner": "thread:thr_demo_w1", "by": "cos"]),
                               event("handed_off", now - 400_000, ["owner": "patrick", "from": "thread:thr_demo_w1", "by": "thread:thr_demo_w1", "needs": "Light or dark set for the stills?"])],
            "task_demo_spend": [event("created", now - 7_200_000, ["owner": "patrick", "by": "cos"]),
                                event("found_again", now - 600_000, ["count": 3, "line": "$41 today"])],
        ]
    }
}
#endif
