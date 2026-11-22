#if DEBUG
import Foundation

/// Debug builds, with `-qaLoopsDemo`: answers Studio's `tasks.*` offline for
/// the old read-only task cards in messages (`tasks.get`) and the loop push
/// buttons (`tasks.act`). `-qaTaskCards` adds old `::work` cards to the chat.
enum TasksDemo {
    static var enabled: Bool { LoopsDemo.enabled }
    static let noBoard = ProcessInfo.processInfo.arguments.contains("-qaTasksNoBoard")

    nonisolated(unsafe) private static var installed = false

    @MainActor static func installIfNeeded() {
        LoopsDemo.installIfNeeded()
        guard LoopsDemo.mode != nil, !installed else { return }
        installed = true
        ThreadTitles.set("thr_demo_w1", "Studio-native BB fork")
        ThreadTitles.set("thr_demo_w2", "Theme stills renderer")
        ThreadTitles.set("thr_demo_w3", "Mock question bank")
        ThreadTitles.set("thr_demo_w7", "iPad UI suite")
        let previous = BBClient.demoTransport
        BBClient.demoTransport = { method, path, body in
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
        private var tasks: [[String: Any]] = LoopsDemo.empty ? [] : TasksDemo.seed().filter { $0["id"] as? String != LoopsDemo.missing }
        private var history: [String: [[String: Any]]] = TasksDemo.seedHistory()
        private var cleared: [String: Double] = [:]
        private(set) var requests: [(String, [String: Any])] = []

        func respond(_ method: String, _ path: String, _ body: Data?) -> (Int, Data)? {
            guard method == "POST" else { return nil }
            let base = "/api/v1/plugins/studio/rpc/"
            guard path.hasPrefix(base) else { return nil }
            let name = String(path.dropFirst(base.count))
            guard name.hasPrefix("tasks.") || name.hasPrefix("work.") else { return nil }
            let unknown = (404, Data(#"{"ok":false,"error":{"message":"Unknown method"}}"#.utf8))
            if TasksDemo.noBoard, ["tasks.flight", "tasks.board"].contains(name) { return unknown }
            let input = body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
            return lock.withLock {
                requests.append((name, input))
                switch name {
                case "tasks.list":
                    let since = Self.now - 7 * 86_400_000
                    let list = tasks.filter { ($0["closedAt"] as? Double).map { $0 > since } ?? true }
                    return ok(["tasks": list, "threads": threads(), "held": []])
                case "tasks.get":
                    guard input["id"] as? String != LoopsDemo.missing, let task = find(input["id"] as? String) else { return (404, Data(#"{"ok":false,"error":{"message":"Task not found"}}"#.utf8)) }
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
                case "tasks.flight":
                    let threadId = input["threadId"] as? String ?? ""
                    var out = Rows(tasks, since: Self.todayStart).view(home: threadId, cleared: cleared[threadId] ?? 0)
                    out["threads"] = threads()
                    return ok(out)
                case "tasks.board":
                    var out = Rows(tasks, since: Self.todayStart).view(home: nil, cleared: 0)
                    out["threads"] = threads()
                    out["done"] = nil
                    return ok(out)
                case "tasks.act": return act(input)
                case "work.dismiss":
                    guard var task = find(input["id"] as? String), var card = task["card"] as? [String: Any] else { return (400, Data()) }
                    card["dismissedAt"] = Self.now
                    task["card"] = card
                    replace(task)
                    return ok(task)
                case "work.clear":
                    let threadId = input["threadId"] as? String ?? ""
                    self.cleared[threadId] = Self.now
                    var cleared = 0
                    for var task in tasks where task["conversation"] as? String == threadId && !(task["closedAt"] is NSNull) {
                        guard var card = task["card"] as? [String: Any], card["dismissedAt"] is NSNull else { continue }
                        card["dismissedAt"] = Self.now
                        task["card"] = card
                        replace(task)
                        cleared += 1
                    }
                    return ok(["cleared": cleared])
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
             ["owner": "thread:thr_demo_w2", "name": "Theme stills renderer", "threadId": "thr_demo_w2"],
             ["owner": "thread:thr_demo_w3", "name": "Mock question bank", "threadId": "thr_demo_w3"],
             ["owner": "thread:thr_demo_w7", "name": "iPad UI suite", "threadId": "thr_demo_w7"],
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
        static var todayStart: Double { (Calendar.current.startOfDay(for: .now).timeIntervalSince1970 * 1000).rounded() }

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
            Store.task("wc_demo_fork_ui", "Run the UI suite on the iPad", owner: "thread:thr_demo_w7", state: "in_progress", conversation: main, step: "2/6 Layout",
                 workers: ["thr_demo_w7"], parentId: "wc_demo_fork", origin: "work", created: now - 3_000_000),
            Store.task("wc_demo_stills", "Theme stills renderer", state: "waiting", needs: "Light or dark set for the stills?", conversation: main, step: "2/4",
                 workers: ["thr_demo_w2"], card: "worker", origin: "work", created: now - 1_200_000),
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
        if ProcessInfo.processInfo.arguments.contains("-qaRoomLead") {
            let lead = "thr_demo_interview"
            out += [
                Store.task("task_demo_prep", "Launch prep", owner: "thread:\(lead)", state: "in_progress", conversation: lead,
                     line: "Waiting on two workers", created: now - 840_000),
                Store.task("wc_demo_prep_bank", "Question bank, part 3", owner: "thread:thr_demo_w5", state: "in_progress", conversation: lead,
                     step: "Drafting answers", workers: ["thr_demo_w5"], card: "worker", origin: "work", created: now - 1_500_000),
                Store.task("wc_demo_prep_slides", "Slides for Friday", owner: "thread:thr_demo_w6", state: "in_progress", conversation: lead,
                     step: "2/3 Layout", workers: ["thr_demo_w6"], card: "worker", origin: "work", created: now - 900_000),
                Store.task("wc_demo_prep_mock", "Book the mock interview room", owner: "thread:thr_demo_w6", state: "done", conversation: lead,
                     line: "Booked the room for Friday 10:00", workers: ["thr_demo_w6"], card: "worker", origin: "work", created: now - 3_000_000, closed: now - 1_200_000),
            ]
        }
        return out
    }

    struct Rows {
        private let all: [[String: Any]]
        private let byId: [String: [String: Any]]
        private let since: Double

        init(_ all: [[String: Any]], since: Double) {
            self.all = all
            self.since = since
            var byId: [String: [String: Any]] = [:]
            for task in all { if let id = task["id"] as? String, byId[id] == nil { byId[id] = task } }
            self.byId = byId
        }

        private final class Node {
            let task: [String: Any]
            var children: [Node] = []
            var workers: [String] = []
            var deep: Set<String> = []
            var needsYou = false
            let home: String?
            init(_ task: [String: Any], home: String?) { self.task = task; self.home = home }
            var id: String { task["id"] as? String ?? "" }
        }

        private static func closed(_ t: [String: Any]) -> Bool { t["closedAt"] is Double }
        private static func owner(_ t: [String: Any]) -> String { t["owner"] as? String ?? TaskItem.user }
        private static func ownerThread(_ t: [String: Any]) -> String? {
            let owner = owner(t)
            return owner.hasPrefix("thread:") ? String(owner.dropFirst(7)) : nil
        }
        private static func needsYou(_ t: [String: Any]) -> Bool {
            owner(t) == TaskItem.user && t["state"] as? String == "waiting" && t["kind"] as? String != "waiting-outside"
        }

        private func shown(_ t: [String: Any]) -> Bool {
            let role = (t["automation"] as? [String: Any])?["role"] as? String
            if role == "schedule" || (role == "run" && Self.owner(t) != TaskItem.user) || t["state"] as? String == "dropped" { return false }
            if let card = t["card"] as? [String: Any], card["dismissedAt"] is Double { return false }
            if t["stale"] as? Bool == true && !Self.closed(t) { return (t["updatedAt"] as? Double ?? 0) >= since }
            return !Self.closed(t) || (t["closedAt"] as? Double ?? 0) >= since
        }

        private func home(_ t: [String: Any]) -> String? {
            var root = t
            var seen = Set<String>()
            while let parent = (root["parentId"] as? String).flatMap({ byId[$0] }), let id = root["id"] as? String, seen.insert(id).inserted { root = parent }
            if let conversation = root["conversation"] as? String { return conversation }
            if let thread = Self.ownerThread(root) { return thread }
            return Self.owner(root) == "cos" ? BotDemo.threadId : nil
        }

        private func rank(_ n: Node) -> Int { Self.closed(n.task) ? 3 : n.needsYou ? 0 : Self.owner(n.task) == TaskItem.user ? 1 : 2 }

        private func before(_ a: Node, _ b: Node) -> Bool {
            if rank(a) != rank(b) { return rank(a) < rank(b) }
            if Self.closed(a.task) {
                let ca = a.task["closedAt"] as? Double ?? 0, cb = b.task["closedAt"] as? Double ?? 0
                if ca != cb { return ca > cb }
            } else {
                let ca = a.task["createdAt"] as? Double ?? 0, cb = b.task["createdAt"] as? Double ?? 0
                if ca != cb { return ca < cb }
            }
            return a.id < b.id
        }

        private func roots() -> [Node] {
            let visible = all.filter(shown)
            let ids = Set(visible.compactMap { $0["id"] as? String })
            func isRoot(_ t: [String: Any]) -> Bool {
                guard let parent = (t["parentId"] as? String).flatMap({ byId[$0] }), let pid = parent["id"] as? String, ids.contains(pid) else { return true }
                return !Self.closed(t) && Self.closed(parent)
            }
            var childrenOf: [String: [[String: Any]]] = [:]
            for t in visible where !isRoot(t) { childrenOf[t["parentId"] as! String, default: []].append(t) }
            var seen = Set<String>()
            func make(_ t: [String: Any], home: String?) -> Node {
                let node = Node(t, home: home)
                seen.insert(node.id)
                node.children = (childrenOf[node.id] ?? []).filter { !seen.contains($0["id"] as? String ?? "") }.map { make($0, home: home) }.sorted(by: before)
                node.deep = Set(node.children.flatMap(\.deep))
                let mine = (t["workers"] as? [String] ?? []) + [Self.ownerThread(t)].compactMap { $0 }
                var own: [String] = []
                for id in mine where !own.contains(id) && id != home && id != t["conversation"] as? String && !node.deep.contains(id)
                    && id != LoopsDemo.leadId && id.hasPrefix("thr_demo_w") { own.append(id) }
                node.workers = own
                node.deep.formUnion(own)
                node.needsYou = (!Self.closed(t) && Self.needsYou(t)) || node.children.contains { $0.needsYou && !Self.closed($0.task) }
                return node
            }
            return visible.filter(isRoot).map { make($0, home: home($0)) }.sorted(by: before)
        }

        func view(home: String?, cleared: Double) -> [String: Any] {
            var picked = roots()
            if let home {
                picked = picked.filter { node in
                    guard node.home == home else { return false }
                    let gone = Self.closed(node.task) || node.task["stale"] as? Bool == true
                    let at = max(node.task["closedAt"] as? Double ?? 0, node.task["updatedAt"] as? Double ?? 0)
                    return !(cleared > 0 && gone && at <= cleared)
                }
            }
            var rows: [[String: Any]] = []
            var tasks: [[String: Any]] = []
            func walk(_ n: Node, under: String?, depth: Int) {
                rows.append(["id": n.id, "home": (n.home as Any?) ?? NSNull(), "under": (under as Any?) ?? NSNull(), "depth": depth, "open": !Self.closed(n.task),
                             "workers": n.workers, "hasWorkers": !n.deep.isEmpty, "needsYou": n.needsYou])
                tasks.append(n.task)
                for child in n.children { walk(child, under: n.id, depth: depth + 1) }
            }
            for root in picked { walk(root, under: nil, depth: 0) }
            let open = picked.filter { !Self.closed($0.task) }
            let counts: [String: Any] = [
                "open": open.count, "running": open.filter { $0.task["state"] as? String == "in_progress" }.count,
                "waiting": open.filter { $0.task["state"] as? String == "waiting" }.count, "todo": open.filter { $0.task["state"] as? String == "todo" }.count,
                "needsYou": open.filter(\.needsYou).count, "done": picked.count - open.count, "workers": Set(open.flatMap(\.deep)).count,
            ]
            let names = Dictionary(TasksDemo.workerNames, uniquingKeysWith: { a, _ in a })
            var workerIds: [String] = []
            for row in rows { for id in row["workers"] as? [String] ?? [] where !workerIds.contains(id) { workerIds.append(id) } }
            let workers: [[String: Any]] = workerIds.map { ["threadId": $0, "name": names[$0] ?? "A worker thread", "status": $0 == "thr_demo_w3" ? "idle" : "running", "archived": false] }
            return ["rows": rows, "tasks": tasks, "counts": counts, "workers": workers,
                    "done": picked.filter { Self.closed($0.task) }.map(\.id)]
        }
    }

    static let workerNames = [("thr_demo_w1", "Studio-native BB fork"), ("thr_demo_w7", "iPad UI suite"), ("thr_demo_w3", "Mock question bank")]

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
