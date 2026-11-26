#if DEBUG
import Foundation
import os

enum BotSpacesDemo {
    static var variant: String? {
        let arguments = ProcessInfo.processInfo.arguments
        // `-qaBotDemo` alone means the real home around its chat: there's no other shell.
        guard let index = arguments.firstIndex(of: "-qaSpacesDemo") else { return BotDemo.variant != nil ? "list" : nil }
        return arguments.indices.contains(index + 1) && !arguments[index + 1].hasPrefix("-") ? arguments[index + 1] : "list"
    }

    static let sideThreadId = "thr_demo_side_m3"

    /// `-qaStrandsDemo`: Studio answers `strands.tags` (the footer's strand tag), and the Bot's view nests more workers (a worker's worker, runners under Main).
    static var strands: Bool { ProcessInfo.processInfo.arguments.contains("-qaStrandsDemo") }


    /// `-qaRouterDemo`: Studio answers the model router's notice for Main (a usage limit with Hand off).
    static var router: Bool { ProcessInfo.processInfo.arguments.contains("-qaRouterDemo") }

    static var late: Duration? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: "-qaSpacesLate") else { return nil }
        let value = arguments.indices.contains(index + 1) ? Int(arguments[index + 1]) : nil
        return value.map { .milliseconds($0) } ?? .seconds(86_400)
    }

    @MainActor static func install(_ store: BotSpacesStore) {
        guard variant != nil else { return }
        let state = State.shared
        let previous = BBClient.demoTransport
        let pages = PageQA.shared
        let late = late
        let answered = OSAllocatedUnfairLock(initialState: late == nil)
        if !ProcessInfo.processInfo.arguments.contains("-qaSpacesSeedOnly") {
            BBClient.demoTransport = { method, path, body in
                try await pages.delay(path)
                if path.hasSuffix("/bot_spaces"), !answered.withLock({ $0 }) { throw URLError(.notConnectedToInternet) }
                if let answer = state.respond(method, path, body) { return answer }
                if let previous { return try await previous(method, path, body) }
                throw URLError(.cannotConnectToHost)
            }
        }
        let decoder = JSONDecoder()
        guard let spaces = try? decoder.decode(Studio.BotSpacesOutput.self, from: state.spacesJSON()) else { return }
        var views: [String: BotThreadsView] = [:]
        for botId in ["bot_juniper", "bot_home", "bot_research"] {
            if let wire = try? decoder.decode(Studio.BotThreadsViewOutput.self, from: state.viewJSON(botId)) { views[botId] = BotThreadsView(wire) }
        }
        if let late {
            store.seedUnknownForDemo()
            Task { @MainActor in
                try? await Task.sleep(for: late)
                answered.withLock { $0 = true }
                store.seedForDemo(BotSpaces(spaces), views: views)
            }
            return
        }
        guard ProcessInfo.processInfo.arguments.contains("-qaDemoCachedBot"),
              let cached = try? decoder.decode(Studio.BotSpacesOutput.self, from: Data(String(decoding: state.spacesJSON(), as: UTF8.self)
                  .replacingOccurrences(of: "bot_juniper", with: "bot_cached_before_cutover").utf8))
        else { return store.seedForDemo(BotSpaces(spaces), views: views) }
        var cachedViews = views
        cachedViews["bot_cached_before_cutover"] = views["bot_juniper"]
        store.seedForDemo(BotSpaces(cached), views: cachedViews)
        pages.firstPage = {
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(300))
                store.seedForDemo(BotSpaces(spaces), views: views)
            }
        }
    }

    static func themed(_ json: String, chosen: String? = nil) -> String {
        let arguments = ProcessInfo.processInfo.arguments
        let given = arguments.firstIndex(of: "-qaRoomTheme").flatMap { arguments.indices.contains($0 + 1) && arguments[$0 + 1] != "none" ? arguments[$0 + 1] : nil }
        guard let theme = chosen ?? given else { return json }
        return json.replacingOccurrences(of: #""id":"bot_juniper","#, with: #""id":"bot_juniper","appearance":{"themeId":"\#(theme)"},"#)
    }

    final class PageQA: @unchecked Sendable {
        static let shared = PageQA()
        let latency: Int?
        private let failing: Set<String>
        private let lock = NSLock()
        private var failed: Set<String> = []
        private var started = false
        var firstPage: (() -> Void)?

        init(arguments: [String] = ProcessInfo.processInfo.arguments) {
            func value(_ flag: String) -> String? {
                arguments.firstIndex(of: flag).flatMap { arguments.indices.contains($0 + 1) ? arguments[$0 + 1] : nil }
            }
            latency = value("-qaDemoPageLatency").flatMap(Int.init)
            failing = Set((value("-qaDemoPageFail") ?? "").split(separator: ",").map(String.init))
        }

        static func page(_ path: String) -> String? {
            if path.contains("/rpc/memory.") { return "memory" }
            if path.hasSuffix("/rpc/bot_library") { return "library" }
            if path.hasSuffix("/rpc/bot_threads_older") { return "archive" }
            return nil
        }

        func delay(_ path: String) async throws {
            guard let page = Self.page(path) else { return }
            let first = lock.withLock { () -> (() -> Void)? in
                defer { started = true }
                return started ? nil : firstPage
            }
            first?()
            if let latency { try await Task.sleep(for: .milliseconds(latency)) }
            let fail = lock.withLock { failing.contains(page) && failed.insert(path).inserted }
            if fail { throw URLError(.timedOut) }
        }
    }

    final class State: @unchecked Sendable {
        static let shared = State()

        struct Conversation {
            var id: String
            var title: String
            var main = false
            var at: Double
            var latest: String
            var parent: (threadId: String, messageId: String, title: String)? = nil
            var running = false
            var needs: String? = nil
            /// What New conversation started it on (provider, model name); the demo's own rows name theirs below.
            var model: (providerId: String, name: String)? = nil
        }

        struct Side {
            var threadId: String
            var sourceThreadId: String
            var messageId: String
            var replies: Int
            var lastReplyAt: Double?
            var lastReplyRole: String?
        }

        struct Thread {
            var title: String
            var rows: [[String: Any]]
            var status = "idle"
        }

        struct Worker {
            var id: String
            var title: String
            var status: String
            var owner: (threadId: String, title: String)
            var ago: Double
            var branch: String?
            var waitingOn: String? = nil
        }

        private let lock = NSLock()
        private let needs = BotSpacesDemo.variant == "needs"
        private var conversations: [String: [Conversation]] = [:]
        private var sides: [Side] = []
        private var threads: [String: Thread] = [:]
        private var finished: Set<String> = ["thr_demo_lisbon"]
        private var gone: Set<String> = []
        private var finishedAt: [String: (at: Double, summary: String)] = [:]
        private var made = 0
        /// Each conversation New conversation started: the model it asked for, as the list and header name it.
        private var startedModels: [String: (providerId: String, name: String)] = [:]
        private var workers: [Worker] = []
        private(set) var asked: [(threadId: String, text: String)] = []
        private var approvalPending = BotSpacesDemo.variant == "needs" && !ProcessInfo.processInfo.arguments.contains("-qaNoDemoApprovals")
        static let approvalId = "int_demo_push"

        private static var now: Double { Date().timeIntervalSince1970 * 1000 }

        init() {
            let now = Self.now
            let main = (BotDemo.threadId, "Main")
            conversations["bot_juniper"] = [
                Conversation(id: BotDemo.threadId, title: "Main", main: true, at: now - 30_000, latest: "Lisbon checks in tonight. Passport is in the bag.",
                             needs: needs ? "Push bb-studio-native to origin?" : nil),
                Conversation(id: "thr_demo_thread", title: "Budget sign-off", at: now - 900_000, latest: "Sent Dana the numbers",
                             parent: (main.0, "msg_demo", main.1)),
                Conversation(id: "thr_demo_interview", title: "Launch prep", at: now - 7_200_000, latest: "Mock with Sam moved to Friday 10:00"),
                Conversation(id: "thr_demo_trunc", title: "Tree truncation", at: now - 18_000_000, latest: "Cut titles at the end, keep the date", running: true),
                Conversation(id: "thr_demo_speech", title: "Train a model for silent speech", at: now - 280_000_000, latest: "Very few are things people already say"),
            ]
            conversations["bot_home"] = [
                Conversation(id: "thr_home_main", title: "Main", main: true, at: now - 600_000, latest: "Groceries are ordered", needs: "Approve the plumber's quote?"),
            ]
            conversations["bot_research"] = [
                Conversation(id: "thr_research_main", title: "Main", main: true, at: now - 86_400_000, latest: "Three papers worth reading"),
            ]
            workers = [
                Worker(id: "thr_demo_w1", title: "Studio-native BB fork", status: needs ? "needs-you" : "done", owner: main, ago: 60_000,
                       branch: "bb-studio-native", waitingOn: needs ? "approval" : nil),
                Worker(id: "thr_demo_w2", title: "Theme stills renderer", status: "running", owner: main, ago: 120_000, branch: "theme-stills"),
                Worker(id: "thr_demo_w3", title: "Mock question bank", status: "failed", owner: ("thr_demo_interview", "Launch prep"), ago: 3_600_000),
                Worker(id: "thr_demo_w4", title: "Release notes", status: "done", owner: main, ago: 86_400_000),
            ]
            for worker in workers { threads[worker.id] = Self.workerThread(worker, now: now) }
            threads["thr_demo_interview"] = Thread(title: "Launch prep", rows: [
                Self.row("int-u1", "user", "Help me prep for Friday's interview with Sam.", now - 7_400_000, seq: 1),
                Self.row("int-a1", "assistant", "Mock with Sam moved to Friday 10:00. I asked a worker for a question bank.", now - 7_200_000, seq: 2),
            ])
            conversations["bot_juniper", default: []].append(
                Conversation(id: "thr_demo_lisbon", title: "Lisbon trip planning", at: now - 172_800_000, latest: "Booked the Alfama flat"))
            finishedAt["thr_demo_lisbon"] = (now - 86_400_000, "Booked the Alfama flat for 14–18 Nov and the 09:40 flight. Saved the plan to memory.")
            threads["thr_demo_lisbon"] = Thread(title: "Lisbon trip planning", rows: [
                Self.row("lis-u1", "user", "Plan the Lisbon trip.", now - 180_000_000, seq: 1),
                Self.row("lis-a1", "assistant", "Booked the Alfama flat for 14–18 Nov.", now - 172_800_000, seq: 2),
            ])
            threads["thr_demo_kitchen"] = Thread(title: "Kitchen remodel quotes", rows: [
                Self.row("kit-a1", "assistant", "Three quotes in. The middle one is the best value.", now - 2_000_000_000, seq: 1),
            ])
            threads["thr_demo_w9"] = Self.workerThread(Worker(id: "thr_demo_w9", title: "Flaky fixture hunt", status: "failed", owner: main, ago: 900_000_000), now: now)
            sides = [Side(threadId: BotSpacesDemo.sideThreadId, sourceThreadId: BotDemo.threadId, messageId: "m3",
                          replies: 2, lastReplyAt: now - 300_000, lastReplyRole: "assistant")]
            threads[BotSpacesDemo.sideThreadId] = Thread(title: "PR review", rows: [
                Self.row("side-src", "assistant", BotDemo.current?.rows.first { $0.id == "m3" }?.text ?? "On it.", now - 86_000_000, seq: 1),
                Self.row("side-u1", "user", "Which of the two is riskier?", now - 360_000, seq: 2),
                Self.row("side-a1", "assistant", "The release workflow fix. It changes how tags are pushed, so I'll hold it for your OK.", now - 300_000, seq: 3),
            ])
            // Project threads that belong to no Bot, for the one list's Projects.
            for (id, title, text) in [("thr_site_form", "Fix the contact form", "The form posts twice on Safari."),
                                      ("thr_site_mobile", "Check the form on mobile", "Looks right on a small screen now."),
                                      ("thr_studio_icons", "Redraw the app icons", "Three directions are in the design."),
                                      ("thr_plain_receipts", "Sort the tax receipts", "Filed by month.")] {
                threads[id] = Thread(title: title, rows: [Self.row("\(id)-u", "user", title, now - 7_200_000, seq: 1),
                                                          Self.row("\(id)-a", "assistant", text, now - 7_100_000, seq: 2)])
            }
        }

        /// New conversation's choices: three providers (Auto, the model router, last, as when it isn't the default),
        /// their models, two projects, the project's defaults and no workspaces yet.
        static func composerOptions(_ path: String) -> Any? {
            let bare = path.split(separator: "?").first.map(String.init) ?? path
            let query = path.split(separator: "?").dropFirst().first.map(String.init) ?? ""
            switch bare {
            case "/api/v1/system/execution-options":
                let modes: [String: Any] = ["permissionModes": ["accept-edits", "auto", "full"]]
                let providers: [[String: Any]] = [
                    ["id": "claude-code", "displayName": "Claude Code", "available": true, "capabilities": modes],
                    ["id": "codex", "displayName": "Codex", "available": true, "capabilities": modes],
                    ["id": "auto", "displayName": "Auto", "available": true, "capabilities": modes],
                ]
                let efforts: [[String: Any]] = ["low", "medium", "high", "xhigh"].map { ["reasoningEffort": $0] }
                let models: [[String: Any]]
                if query.contains("providerId=auto") {
                    models = [["id": "auto", "model": "auto", "displayName": "Auto", "supportedReasoningEfforts": [Any](), "isDefault": true]]
                } else if query.contains("providerId=codex") {
                    models = [["id": "gpt-5.2", "model": "gpt-5.2", "displayName": "GPT-5.2", "supportedReasoningEfforts": efforts, "isDefault": true]]
                } else {
                    models = [["id": "claude-opus-5-5", "model": "claude-opus-5-5", "displayName": "Opus 5.5", "supportedReasoningEfforts": efforts, "isDefault": true],
                              ["id": "claude-sonnet-5-5", "model": "claude-sonnet-5-5", "displayName": "Sonnet 5.5", "supportedReasoningEfforts": efforts]]
                }
                return ["providers": providers, "models": models, "permissionCeiling": "full"]
            case "/api/v1/projects":
                return [["id": "proj_studio", "name": "BB Studio"], ["id": "proj_site", "name": "Website"]]
            case "/api/v1/environments":
                return [Any]()
            case "/api/v1/sidebar-bootstrap":
                return sidebarJSON()
            case "/api/v1/plugins" where !ProcessInfo.processInfo.arguments.contains("-qaStudioDemo"):
                // Automations running, for the Schedules place's All automations (Studio's demo answers its own list).
                return ["plugins": [["id": "studio", "status": "running"], ["id": "automations", "status": "running"]]]
            default:
                guard bare.hasPrefix("/api/v1/projects/"), bare.hasSuffix("/default-execution-options") else { return nil }
                return ["providerId": "claude-code", "model": "claude-opus-5-5", "reasoningLevel": "high", "permissionMode": "auto"]
            }
        }

        /// BB's thread list: two projects with threads of no Bot, and the personal project, where the Bot's own
        /// threads (its Main, a conversation, a worker, and a thread a conversation started) sit beside one of no Bot.
        static func sidebarJSON() -> [String: Any] {
            let now = Self.now
            func thread(_ id: String, _ title: String, _ project: String, ago: Double, parent: String? = nil) -> [String: Any] {
                ["id": id, "projectId": project, "title": title, "status": "idle", "createdAt": now - ago - 60_000, "updatedAt": now - ago,
                 "parentThreadId": parent ?? NSNull()]
            }
            return [
                "sections": [Any](),
                "projects": [
                    ["id": "proj_site", "name": "Website", "threads": [
                        thread("thr_site_form", "Fix the contact form", "proj_site", ago: 3_600_000),
                        thread("thr_site_mobile", "Check the form on mobile", "proj_site", ago: 3_000_000, parent: "thr_site_form"),
                    ]],
                    ["id": "proj_studio", "name": "BB Studio", "threads": [
                        thread("thr_studio_icons", "Redraw the app icons", "proj_studio", ago: 86_400_000),
                    ]],
                ],
                "personalProject": ["id": "proj_personal", "name": "Personal", "threads": [
                    thread(BotDemo.threadId, "Juniper", "proj_personal", ago: 60_000),
                    thread("thr_demo_interview", "Launch prep", "proj_personal", ago: 7_200_000),
                    thread("thr_demo_w2", "Theme stills renderer", "proj_personal", ago: 120_000, parent: BotDemo.threadId),
                    thread("thr_bot_child", "Draft the questions", "proj_personal", ago: 7_000_000, parent: "thr_demo_interview"),
                    thread("thr_plain_receipts", "Sort the tax receipts", "proj_personal", ago: 172_800_000),
                ]],
            ]
        }

        /// The provider and model name a New conversation request named (Auto routes the demo's to GPT-5.2).
        static func startedModel(_ request: [String: Any]?) -> (providerId: String, name: String) {
            switch request?["providerId"] as? String {
            case "auto": return ("codex", "GPT-5.2 (Auto)")
            case "codex": return ("codex", "GPT-5.2")
            default: return ("claude-code", request?["model"] as? String == "claude-sonnet-5-5" ? "Sonnet 5.5" : "Opus 5.5")
            }
        }

        func spacesJSON() -> Data {
            let all = #"""
                {"bots":[
                  {"id":"bot_juniper","name":"Juniper","avatar":"🌿","shape":"blob","color":"#2ba59a","primary":true,"mainThreadId":"\#(BotDemo.threadId)","needsYou":\#(lock.withLock { approvalPending }),"activity":{"turn":false,"workers":1},"state":"\#(lock.withLock { juniperState })"},
                  {"id":"bot_home","name":"Home","avatar":"🏠","shape":"star","color":"#e0803a","primary":false,"mainThreadId":"thr_home_main","needsYou":true,"activity":{"turn":false,"workers":0}},
                  {"id":"bot_research","name":"Research","avatar":"🔭","shape":"hexagon","color":"#5b6ee1","primary":false,"mainThreadId":"thr_research_main","needsYou":false,"activity":{"turn":false,"workers":0}}
                ],"currentBotId":"bot_juniper"}
                """#
            let json = ProcessInfo.processInfo.arguments.contains("-qaOneBot")
                ? all.split(separator: "\n").filter { !$0.contains("\"bot_home\"") && !$0.contains("\"bot_research\"") }.joined(separator: "\n")
                    .replacingOccurrences(of: #",\s*\]"#, with: "]", options: .regularExpression)
                : all
            return Data(BotSpacesDemo.themed(json, chosen: lock.withLock { chosenTheme }).utf8)
        }

        private var chosenTheme: String?
        /// Juniper's state for Pause, Resume and Stop (`-qaSpacesDemo`).
        private var juniperState = "active"
        private var routerHandedOff = false
        private(set) var mainMadeFrom: String?

        /// `strands.tags` for the demo's Main: its first turn in Lisbon trip, the PR turns in the fork's strand, today's in Theme stills.
        static func strandTagsJSON(_ threadId: String) -> [String: Any] {
            guard threadId == BotDemo.threadId else { return ["tags": [Any](), "strands": [Any]()] }
            let tags: [[String: Any]] = [
                ["turnId": "t1", "seq": 1, "strandId": "str_lisbon"],
                ["turnId": "t2", "seq": 2, "strandId": "str_fork"],
                ["turnId": "t3", "seq": 5, "strandId": "str_stills"],
            ]
            let names: [[String: Any]] = [["id": "str_lisbon", "title": "Lisbon trip"], ["id": "str_fork", "title": "Studio-native BB fork"],
                                          ["id": "str_stills", "title": "Theme stills"]]
            return ["tags": tags, "strands": names]
        }


        private(set) var appearanceCalls: [[String: Any]] = []

        func viewJSON(_ botId: String) -> Data {
            lock.withLock {
                let now = Self.now
                let one = ProcessInfo.processInfo.arguments.contains("-qaOneConversation")
                let list = (conversations[botId] ?? []).filter { !finished.contains($0.id) && $0.parent == nil && (!one || $0.main) }.map { conversation -> [String: Any] in
                    [
                        "threadId": conversation.id, "title": conversation.title, "isMain": conversation.main,
                        "forkedFrom": conversation.parent.map { ["threadId": $0.threadId, "messageId": $0.messageId, "title": $0.title] } ?? NSNull(),
                        "projectId": "proj_personal", "updatedAt": conversation.at, "latest": conversation.latest, "running": conversation.running,
                        "needsYou": conversation.needs.map { ["reason": $0, "at": now - 30_000] } ?? NSNull(), "mirrored": false,
                        "providerId": conversation.model?.providerId ?? (conversation.id == "thr_demo_interview" ? "codex" : "claude-code"),
                        "modelName": conversation.model?.name ?? (conversation.id == "thr_demo_interview" ? "GPT-5.2" : "Opus 5.5"),
                    ]
                }
                func worker(_ id: String, _ title: String, _ status: String, owner: (String, String), ago: Double) -> [String: Any] {
                    ["threadId": id, "title": title, "status": status, "ownerConversationId": owner.0, "ownerTitle": owner.1,
                     "updatedAt": now - ago, "mirrored": false, "sameTitle": 1, "providerId": id.hasSuffix("2") || id.hasSuffix("6") ? "codex" : "claude-code"]
                }
                var workers: [[String: Any]] = botId == "bot_juniper" ? self.workers.map { each in
                    var out = worker(each.id, each.title, each.status, owner: each.owner, ago: each.ago)
                    out["branch"] = each.branch ?? NSNull()
                    return out
                } : []
                // `-qaStrandsDemo`: a worker a worker started, a runner's thread under Main, and a second running worker.
                if botId == "bot_juniper", BotSpacesDemo.strands {
                    let main = (BotDemo.threadId, "Main")
                    var crop = worker("thr_demo_w5", "Crop stills", "done", owner: main, ago: 300_000)
                    crop["spawnedBy"] = "thr_demo_w2"
                    workers.insert(worker("thr_demo_w6", "Disk scan", "running", owner: main, ago: 90_000), at: 1)
                    workers.append(crop)
                    workers.append(worker("thr_demo_r1", "Morning check-in", "done", owner: main, ago: 26_000_000))
                    workers.append(worker("thr_demo_r2", "Inbox sweep", "done", owner: main, ago: 30_000_000))
                }
                let view: [String: Any] = ["botId": botId, "conversations": list, "workers": workers,
                                           "hiddenWorkers": 0, "hiddenToday": 0, "olderConversations": 0]
                return (try? JSONSerialization.data(withJSONObject: view)) ?? Data()
            }
        }

        func respond(_ method: String, _ path: String, _ body: Data?) -> (Int, Data)? {
            let input = body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
            let rpc = "/api/v1/plugins/studio/rpc/"
            if method == "POST", path.hasPrefix(rpc) {
                return studio(String(path.dropFirst(rpc.count)), input)
            }
            if method == "GET", let answer = Self.composerOptions(path) { return json(answer) }
            let prefix = "/api/v1/threads/"
            guard path.hasPrefix(prefix) else { return nil }
            let rest = path.dropFirst(prefix.count).split(separator: "?").first.map(String.init) ?? ""
            let parts = rest.split(separator: "/").map(String.init)
            if method == "DELETE", parts.count == 1, let id = parts.first {
                return lock.withLock {
                    guard input["childThreadsConfirmed"] as? Bool == true else {
                        return (409, Data(#"{"error":{"message":"This thread has child threads"}}"#.utf8))
                    }
                    gone.insert(id)
                    for key in conversations.keys { conversations[key]?.removeAll { $0.id == id } }
                    finished.remove(id)
                    threads[id] = nil
                    return json(["ok": true])
                }
            }
            guard let id = parts.first, lock.withLock({ threads[id] != nil }) else { return nil }
            switch (method, parts.dropFirst().first) {
            case ("GET", nil): return json(thread(id))
            case ("GET", "timeline"): return json(timeline(id))
            case ("GET", "interactions"): return json([Any]())
            case ("GET", "default-execution-options"): return json(["model": "claude-opus-5-5", "reasoningLevel": "high"])
            case ("POST", "read"): return json([String: Any]())
            case ("POST", "send"): return send(id, input)
            default: return (404, Data(#"{"error":{"message":"Not in the demo"}}"#.utf8))
            }
        }

        private func studio(_ name: String, _ input: [String: Any]) -> (Int, Data)? {
            let threadId = input["threadId"] as? String ?? ""
            switch name {
            case "bot_spaces":
                return envelope(raw: spacesJSON())
            case "bot_set_appearance":
                let appearance = input["appearance"] as? [String: Any] ?? [:]
                lock.withLock {
                    chosenTheme = appearance["themeId"] as? String
                    appearanceCalls.append(input)
                }
                return ok(["bot": ["id": input["botId"] ?? "bot_juniper", "name": "Juniper"]])
            case "bot_threads_view":
                return envelope(raw: viewJSON(input["botId"] as? String ?? "bot_juniper"))
            case "bot_side_threads":
                return lock.withLock {
                    let list = sides.filter { $0.sourceThreadId == threadId }.map { side -> [String: Any] in
                        ["messageId": side.messageId, "threadId": side.threadId, "botId": "bot_juniper", "replies": side.replies,
                         "lastReplyAt": side.lastReplyAt ?? NSNull(), "lastReplyRole": side.lastReplyRole ?? NSNull(), "working": false,
                         "kind": side.threadId.hasPrefix("thr_demo_fork") ? "fork" : "reply", "conversations": 1]
                    }
                    return ok(["chat": true, "threads": list])
                }
            case "bot_thread_reply":
                let messageId = input["messageId"] as? String ?? ""
                return lock.withLock {
                    if let side = sides.last(where: { $0.sourceThreadId == threadId && $0.messageId == messageId }) {
                        return ok(["threadId": side.threadId, "projectId": "proj_personal", "created": false])
                    }
                    made += 1
                    let id = "thr_demo_reply\(made)"
                    sides.append(Side(threadId: id, sourceThreadId: threadId, messageId: messageId, replies: 0, lastReplyAt: nil, lastReplyRole: nil))
                    threads[id] = Thread(title: "Thread", rows: [source(threadId, messageId, id: "\(id)-src")])
                    return ok(["threadId": id, "projectId": "proj_personal", "created": true])
                }
            case "bot_fork_conversation":
                let messageId = input["messageId"] as? String ?? ""
                return lock.withLock {
                    made += 1
                    let id = "thr_demo_fork\(made)"
                    sides.append(Side(threadId: id, sourceThreadId: threadId, messageId: messageId, replies: 0, lastReplyAt: nil, lastReplyRole: nil))
                    let parentTitle = conversations.values.flatMap { $0 }.first { $0.id == threadId }?.title ?? "Main"
                    threads[id] = Thread(title: "\(parentTitle) · fork", rows: [source(threadId, messageId, id: "\(id)-src")])
                    conversations["bot_juniper", default: []].insert(
                        Conversation(id: id, title: "\(parentTitle) · fork", at: Self.now, latest: "Forked here", parent: (threadId, messageId, parentTitle)), at: 1)
                    return ok(["threadId": id, "projectId": "proj_personal"])
                }
            case "bot_conversation_start":
                let request = input["request"] as? [String: Any]
                let text = ((request?["input"] as? [[String: Any]])?.first?["text"] as? String) ?? "New conversation"
                let model = Self.startedModel(request)
                return lock.withLock {
                    made += 1
                    let id = "thr_demo_new\(made)"
                    let title = String(text.prefix(40))
                    threads[id] = Thread(title: title, rows: [Self.row("\(id)-u", "user", text, Self.now, seq: 1)])
                    startedModels[id] = model
                    conversations[input["botId"] as? String ?? "bot_juniper", default: []].insert(
                        Conversation(id: id, title: title, at: Self.now, latest: text, model: model), at: 1)
                    return ok(["threadId": id, "projectId": request?["projectId"] as? String ?? "proj_personal"])
                }
            case "thread_model":
                if let started = lock.withLock({ startedModels[threadId] }) {
                    return ok(["model": ["providerId": started.providerId, "model": started.providerId, "reasoningLevel": "high", "modelName": started.name]])
                }
                return ok(["model": ["providerId": "claude-code", "model": "claude-opus-5-5", "reasoningLevel": "high", "modelName": "Opus 5.5"]])
            case "bot_finish":
                return lock.withLock {
                    finished.insert(threadId)
                    return ok(["state": "finished"])
                }
            case "bot_thread_info":
                return lock.withLock {
                    guard let worker = workers.first(where: { $0.id == threadId }) else { return ok(["info": NSNull()]) }
                    return ok(["info": [
                        "threadId": worker.id, "botId": "bot_juniper", "botName": "Juniper", "kind": "worker", "isMain": false,
                        "title": worker.title, "forkedFrom": NSNull(), "owner": ["threadId": worker.owner.threadId, "title": worker.owner.title],
                        "status": worker.status, "waitingOn": worker.waitingOn ?? NSNull(), "startedAt": Self.now - worker.ago - 600_000,
                        "tag": NSNull(), "branch": worker.branch ?? NSNull(), "archivedAt": NSNull(), "finishedSummary": NSNull(),
                        "finishing": false, "needsYou": NSNull(), "workers": [Any](),
                    ] as [String: Any]])
                }
            case "bot_worker_ask":
                let text = (input["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                return lock.withLock {
                    guard let worker = workers.first(where: { $0.id == threadId }) else {
                        return (400, Data(#"{"ok":false,"error":{"message":"That thread isn't a worker."}}"#.utf8))
                    }
                    asked.append((threadId, text))
                    let owner = worker.owner.threadId
                    if var thread = threads[owner] {
                        let seq = thread.rows.count
                        let now = Self.now
                        thread.rows.append(Self.row("\(owner)-ask\(seq)", "user", "About the worker [\(worker.title)](/threads/\(worker.id)): \(text)", now, seq: seq + 1))
                        thread.rows.append(Self.row("\(owner)-ans\(seq)", "assistant", "\(worker.title) stopped on a bad fixture. I'll restart it with the fix.", now + 1_000, seq: seq + 2))
                        threads[owner] = thread
                    }
                    return ok(["conversationId": owner, "projectId": "proj_personal"])
                }
            case "bot_conversation_approvals":
                return lock.withLock {
                    guard approvalPending, threadId == BotDemo.threadId,
                          let worker = workers.first(where: { $0.id == "thr_demo_w1" }) else { return ok(["approvals": [Any]()]) }
                    return ok(["approvals": [[
                        "worker": ["threadId": worker.id, "title": worker.title, "projectId": "proj_personal"],
                        "approval": approvalView("pending"),
                    ] as [String: Any]]])
                }
            case "router.notice.get":
                guard BotSpacesDemo.router else { return (404, Data(#"{"ok":false,"error":{"message":"Unknown method"}}"#.utf8)) }
                guard threadId == BotDemo.threadId, !lock.withLock({ routerHandedOff }) else { return ok(NSNull()) }
                let target: [String: Any] = ["providerId": "codex", "model": "gpt-5.2", "reasoningLevel": NSNull()]
                let notice: [String: Any] = ["threadId": threadId, "requestId": "req_demo", "kind": "usage-limit", "failedProviderId": "claude-code",
                                             "failedProviderName": "Claude Code", "reason": "usage limit", "target": target, "targetName": "GPT-5.2",
                                             "text": "Claude Code hit its usage limit. Hand off to GPT-5.2 to keep going.", "createdAt": Self.now - 60_000]
                return ok(notice)
            case "router.notice.dismiss":
                lock.withLock { routerHandedOff = true }
                return ok(["ok": true])
            case "router.handoff":
                lock.withLock { routerHandedOff = true }
                let target: [String: Any] = ["providerId": "codex", "model": "gpt-5.2", "reasoningLevel": NSNull()]
                return ok(["threadId": "thr_demo_interview", "target": target, "cancelledRetries": 0])
            case "toolGateway.overview":
                let servers: [[String: Any]] = [
                    ["id": "gw_github", "label": "GitHub", "kind": "streamable-http", "status": "running", "enabled": true, "tools": 12],
                    ["id": "gw_calendar", "label": "Google Calendar", "kind": "streamable-http", "status": "needs-sign-in", "enabled": true, "tools": 4],
                    ["id": "gw_files", "label": "Files", "kind": "stdio", "status": "off", "enabled": false, "tools": 6],
                ]
                let requests: [[String: Any]] = [["id": "gwr_1", "label": "Google Calendar: read events", "why": "To find a free slot for the furnace tune-up", "createdAt": Self.now - 300_000]]
                return ok(["servers": servers, "requests": requests])
            case "bot_pause", "bot_resume", "bot_stop":
                lock.withLock { juniperState = name == "bot_resume" ? "active" : name == "bot_pause" ? "paused" : "stopped" }
                return ok(["id": "bot_juniper", "name": "Juniper", "state": lock.withLock { juniperState }])
            case "bot_make_main", "bot_new_main":
                lock.withLock { mainMadeFrom = threadId.isEmpty ? "new" : threadId }
                return ok(["id": "bot_juniper", "name": "Juniper"])
            case "strands.tags":
                guard BotSpacesDemo.strands else { return (404, Data(#"{"ok":false,"error":{"message":"Unknown method"}}"#.utf8)) }
                return ok(Self.strandTagsJSON(threadId))
            case "bot_worker_approval_resolve":
                let decision = input["decision"] as? String ?? ""
                return lock.withLock {
                    guard approvalPending, threadId == "thr_demo_w1", input["interactionId"] as? String == Self.approvalId else {
                        return (400, Data(#"{"ok":false,"error":{"message":"That approval isn't waiting any more."}}"#.utf8))
                    }
                    approvalPending = false
                    if let index = workers.firstIndex(where: { $0.id == threadId }) {
                        workers[index].status = decision == "deny" ? "failed" : "running"
                        workers[index].waitingOn = nil
                        workers[index].ago = 0
                    }
                    if let index = conversations["bot_juniper"]?.firstIndex(where: { $0.main }) {
                        conversations["bot_juniper"]?[index].needs = nil
                    }
                    return ok(["approval": approvalView(decision == "deny" ? "denied" : "approved")])
                }
            // Studio retired memory records: its memory RPC (src/memory/register.ts) answers from the Bot's always-on skill,
            // lists no records and refuses writes. The demo answers the same way.
            case "memory.overview":
                return ok([
                    "bot": ["id": "bot_juniper", "name": "Juniper"],
                    "profile": ["pageId": "", "title": "Always on", "updatedAt": Self.now - 3_600_000,
                                "chars": Self.profile.count, "cap": 2000, "over": false],
                    "split": ["state": "none", "legacyPageId": NSNull(), "legacyTitle": NSNull(), "splitAt": NSNull()],
                    "counts": ["current": 0, "replaced": 0, "archived": 0],
                    "topics": [] as [Any],
                ] as [String: Any])
            case "memory.profile":
                return ok(["profile": ["pageId": "", "title": "Always on", "updatedAt": Self.now - 3_600_000,
                                       "chars": Self.profile.count, "cap": 2000, "over": false, "markdown": Self.profile] as [String: Any]])
            case "memory.list":
                return ok(["records": [] as [Any], "total": 0])
            case "memory.get":
                return ok(["record": NSNull()])
            case "memory.add", "memory.update", "memory.archive":
                return (400, Data(#"{"ok":false,"error":{"message":"Memory records are retired. Standing rules go in the Bot's always-on skill (Memory → Core), procedures in a skill, and what happened stays in the conversation history."}}"#.utf8))
            case "bot_library":
                return ok(["botId": "bot_juniper", "items": libraryJSON()])
            case "bot_threads_older":
                return lock.withLock {
                    let now = Self.now
                    let finishedRows = conversations.values.flatMap { $0 }.filter { finished.contains($0.id) }.map { conversation -> [String: Any] in
                        let info = finishedAt[conversation.id] ?? (now, "")
                        return ["threadId": conversation.id, "title": conversation.title, "finishedAt": info.at, "summary": info.summary]
                    }
                    let older: [[String: Any]] = gone.contains("thr_demo_kitchen") ? [] : [[
                        "threadId": "thr_demo_kitchen", "title": "Kitchen remodel quotes", "isMain": false, "forkedFrom": NSNull(), "projectId": "proj_personal",
                        "updatedAt": now - 2_000_000_000, "latest": "Three quotes in", "running": false, "needsYou": NSNull(), "mirrored": false,
                    ]]
                    let workers: [[String: Any]] = [
                        ["threadId": "thr_demo_w9", "title": "Flaky fixture hunt", "status": "failed", "ownerConversationId": BotDemo.threadId, "ownerTitle": "Main",
                         "projectId": "proj_personal", "updatedAt": now - 900_000_000, "tag": NSNull(), "branch": NSNull(), "mirrored": false, "sameTitle": 1],
                        ["threadId": "thr_demo_w4", "title": "Release notes", "status": "done", "ownerConversationId": BotDemo.threadId, "ownerTitle": "Main",
                         "projectId": "proj_personal", "updatedAt": now - 300_000_000, "tag": "v0.2", "branch": NSNull(), "mirrored": false, "sameTitle": 1],
                    ]
                    return ok(["botId": "bot_juniper", "conversations": older, "workers": workers, "finished": finishedRows])
                }
            case "bot_finished":
                return lock.withLock {
                    guard finished.contains(threadId), let conversation = conversations.values.flatMap({ $0 }).first(where: { $0.id == threadId }) else {
                        return ok(["finished": NSNull()])
                    }
                    let info = finishedAt[threadId] ?? (Self.now, "")
                    return ok(["finished": ["threadId": threadId, "botId": "bot_juniper", "title": conversation.title, "summary": info.summary,
                                            "startedAt": info.at - 200_000_000, "finishedAt": info.at, "records": 2, "memoryHref": NSNull(), "archived": true] as [String: Any]])
                }
            case "bot_reopen":
                return lock.withLock {
                    finished.remove(threadId)
                    if let index = conversations["bot_juniper"]?.firstIndex(where: { $0.id == threadId }) {
                        conversations["bot_juniper"]?[index].at = Self.now
                    }
                    return ok(["ok": true])
                }
            case "links.resolve":
                let kind = input["kind"] as? String ?? ""
                let id = input["id"] as? String ?? ""
                return lock.withLock {
                    switch kind {
                    case "conversation", "worker":
                        // The burst demo's busy thread is served by its own fixture.
                        if BurstDemo.enabled, id == BurstDemo.threadId { return ok(["found": true, "title": "Busy thread", "spec": NSNull()]) }
                        let title = threads[id]?.title ?? conversations.values.flatMap { $0 }.first { $0.id == id }?.title
                        return ok(["found": title != nil, "title": title ?? NSNull(), "spec": NSNull()])
                    case "record":
                        // Memory records are retired: none resolves.
                        return ok(["found": false, "title": NSNull(), "spec": NSNull()])
                    default:
                        return ok(["found": true, "title": NSNull(), "spec": NSNull()])
                    }
                }
            case "designs.getDesign" where DesignDemo.on:
                let design: Any = input["id"] as? String == DesignDemo.id ? DesignDemo.design() : NSNull()
                return ok(["design": design])
            case "bot_get":
                // Home's default is Auto (the model router); Research names none, so it starts on the project's defaults.
                switch input["botId"] as? String {
                case "bot_home": return ok(["bot": ["defaultModel": ["providerId": "auto", "model": "auto", "reasoningLevel": NSNull()]]])
                case "bot_research": return ok(["bot": ["defaultModel": NSNull()]])
                default: return ok(["bot": ["defaultModel": ["providerId": "claude-code", "model": "claude-opus-5-5", "reasoningLevel": "high"]]])
                }
            default:
                return nil
            }
        }

        private func approvalView(_ state: String) -> [String: Any] {
            ["id": Self.approvalId, "state": state, "title": "Push to origin", "short": "git push origin bb-studio-native",
             "lines": ["Command: git push origin bb-studio-native", "Cwd: ~/workingdir/bb-studio-native"], "decisions": ["deny", "allow_once"]]
        }

        private func source(_ threadId: String, _ messageId: String, id: String) -> [String: Any] {
            let text = threads[threadId]?.rows.first { $0["id"] as? String == messageId }?["text"] as? String
                ?? BotDemo.current?.rows.first { $0.id == messageId }?.text ?? ""
            return Self.row(id, "assistant", text, Self.now - 60_000, seq: 1)
        }

        private func thread(_ id: String) -> [String: Any] {
            lock.withLock {
                ["id": id, "projectId": "proj_personal", "providerId": "claude-code", "title": threads[id]?.title ?? "Thread",
                 "status": threads[id]?.status ?? "idle", "createdAt": 1, "updatedAt": Self.now, "parentThreadId": BotDemo.threadId]
            }
        }

        private func timeline(_ id: String) -> [String: Any] {
            lock.withLock {
                let rows = threads[id]?.rows ?? []
                return ["rows": rows, "maxSeq": rows.count, "timelinePage": ["hasOlderRows": false]]
            }
        }

        private func send(_ id: String, _ input: [String: Any]) -> (Int, Data) {
            let text = (input["input"] as? [[String: Any]])?.compactMap { $0["text"] as? String }.first ?? ""
            lock.withLock {
                let now = Self.now
                var thread = threads[id] ?? Thread(title: "Thread", rows: [])
                let seq = thread.rows.count
                thread.rows.append(Self.row("\(id)-u\(seq)", "user", text, now, seq: seq + 1))
                thread.rows.append(Self.row("\(id)-a\(seq)", "assistant", "Noted. I'll keep this here so Main stays clear.", now + 1_000, seq: seq + 2))
                threads[id] = thread
                if let index = sides.firstIndex(where: { $0.threadId == id }) {
                    sides[index].replies += 2
                    sides[index].lastReplyAt = now + 1_000
                    sides[index].lastReplyRole = "assistant"
                }
            }
            return json(["ok": true, "delivery": "sent"])
        }

        private static func workerThread(_ worker: Worker, now: Double) -> Thread {
            let start = now - worker.ago - 600_000
            func command(_ id: String, _ command: String, _ output: String, _ at: Double, status: String = "completed") -> [String: Any] {
                ["id": id, "kind": "work", "workKind": "command", "status": status, "title": "Ran a command", "command": command,
                 "output": output, "createdAt": at]
            }
            var rows: [[String: Any]] = [
                ["id": "\(worker.id)-brief", "kind": "conversation", "role": "user", "initiator": "agent", "createdAt": start, "sourceSeqEnd": 1,
                 "text": "\(worker.title): work on it in its own branch, keep the old routes working, and ask before pushing."],
                row("\(worker.id)-a1", "assistant", "Reading the code first.", start + 60_000, seq: 2),
                ["id": "\(worker.id)-t1", "kind": "work", "workKind": "tool", "toolName": "Read", "title": "Read 14 files", "status": "completed", "createdAt": start + 90_000],
                command("\(worker.id)-c1", "pnpm gen:contracts", "367 methods", start + 200_000),
            ]
            switch worker.status {
            case "running":
                rows.append(command("\(worker.id)-c2", "scripts/render-stills.sh", "", now - 30_000, status: "running"))
                return Thread(title: worker.title, rows: rows, status: "active")
            case "failed":
                rows.append(command("\(worker.id)-c2", "scripts/test.sh", "212 passed, 3 failed", now - worker.ago - 60_000, status: "failed"))
                rows.append(row("\(worker.id)-a2", "assistant", "Three tests fail on the question fixture. Stopping here.", now - worker.ago, seq: 3))
                return Thread(title: worker.title, rows: rows, status: "error")
            default:
                rows.append(command("\(worker.id)-c2", "scripts/test.sh", "212 passed", now - worker.ago - 60_000))
                rows.append(row("\(worker.id)-a2", "assistant", "The bridge is on the Studio contract. Old routes map through the new router.", now - worker.ago, seq: 3))
                return Thread(title: worker.title, rows: rows)
            }
        }

        static let profile = """
            ## Preferences
            - Short answers first, then detail on request.
            - Ask before pushing or sending anything outside.
            ## Check-in
            - Anything waiting on me?
            """

        private func libraryJSON() -> [[String: Any]] {
            let now = Self.now
            func item(_ plugin: String, _ id: String, _ title: String, _ kind: String, _ type: String, _ ago: Double, madeIn: (String, String, String, String?, String?)?) -> [String: Any] {
                let segment = ["page", "whiteboard", "design"].contains(kind) ? "pages" : "apps"
                return ["pluginId": plugin, "id": id, "title": title, "kind": kind, "type": type, "href": "/plugins/studio/studio/\(segment)/\(id)",
                        "updatedAt": now - ago, "createdAt": now - ago - 60_000,
                        "madeIn": madeIn.map { m -> Any in ["threadId": m.0, "title": m.1, "kind": m.2, "conversationId": m.3.map { $0 as Any } ?? NSNull(), "conversationTitle": m.4.map { $0 as Any } ?? NSNull()] } ?? NSNull()]
            }
            let main = (BotDemo.threadId, "Main", "conversation", Optional(BotDemo.threadId), Optional("Main"))
            let worker = ("thr_demo_w2", "Theme stills renderer", "worker", Optional(BotDemo.threadId), Optional("Main"))
            let interview = ("thr_demo_interview", "Launch prep", "conversation", Optional("thr_demo_interview"), Optional("Launch prep"))
            return [
                item("pages", "pg_demo_trip", "Lisbon itinerary", "page", "doc", 600_000, madeIn: main),
                item("artifacts", "art_demo_still1", "Event Horizon still 1.png", "artifact", "artifact", 1_200_000, madeIn: worker),
                item("artifacts", "art_demo_still2", "Event Horizon still 2.png", "artifact", "artifact", 1_300_000, madeIn: worker),
                item("artifacts", "art_demo_still3", "Event Horizon still 3.png", "artifact", "artifact", 1_400_000, madeIn: worker),
                item("design", "dsn_demo_home", "Phone home screen", "design", "design", 5_000_000, madeIn: main),
                item("pages", "pg_demo_questions", "Mock interview questions", "page", "doc", 7_000_000, madeIn: interview),
                item("excalidraw", "drw_demo_arch", "System design sketch", "whiteboard", "whiteboard", 8_000_000, madeIn: interview),
                item("minis", "mini_demo_pack", "Packing list", "app", "mini", 100_000_000, madeIn: nil),
            ]
        }

        private static func row(_ id: String, _ role: String, _ text: String, _ at: Double, seq: Int) -> [String: Any] {
            ["id": id, "kind": "conversation", "role": role, "text": text, "createdAt": at, "sourceSeqEnd": seq]
        }

        private func ok(_ result: Any) -> (Int, Data) { json(["ok": true, "result": result]) }

        private func envelope(raw: Data) -> (Int, Data) {
            (200, Data(#"{"ok":true,"result":"#.utf8) + raw + Data("}".utf8))
        }

        private func json(_ value: Any) -> (Int, Data) {
            (200, (try? JSONSerialization.data(withJSONObject: value)) ?? Data("{}".utf8))
        }
    }
}
#endif
