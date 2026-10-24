import Foundation

// MARK: Bot

/// Studio's Bot: the user's always-on agent (it replaced the Chief of Staff),
/// with a name, an emoji and a state. Its thread is the lead of BB's personal
/// project, which the app, widgets, Siri and the watch all go to first.
extension BBClient {
    /// The Bot, or nil when there is none or Studio has no `bot_get` RPC.
    /// A successful response is remembered per server so widgets can draw offline;
    /// a failed request leaves the last known Bot intact. With a `botId`, that bot
    /// instead of the primary one.
    public func bot(_ botId: String? = nil) async throws -> BotInfo? {
        let output: BotWire
        do {
            output = try await rpc("studio", Studio.Method.bot_get, Self.scoped(botId))
        } catch where Self.isUnknownRPC(error) {
            return nil
        }
        let info = output.info
        if botId == nil || info?.primary == true { remember(info) }
        return info
    }

    /// The Bot's thread, nil when there is no Bot or Studio is absent.
    public func botThreadId() async throws -> String? {
        try await bot()?.lead.threadId
    }

    /// Every bot (`bot_list`), primary first, then the others by name. A Studio
    /// with one Bot answers through `bot_get`.
    public func bots() async throws -> [BotInfo] {
        do {
            struct Output: Decodable { var bots: [BotWire.Bot] }
            let output: Output = try await rpc("studio", Studio.Method.bot_list, .object([:]))
            let list = BotInfo.ordered(output.bots.map { BotWire(bot: $0, run: nil).info! })
            if let primary = list.first(where: \.primary) { remember(primary) }
            return list
        } catch where Self.isUnknownRPC(error) {
            return try await bot().map { [$0] } ?? []
        }
    }

    /// An RPC input with `botId` added when it names a bot other than the primary.
    static func scoped(_ botId: String?, _ fields: [String: JSONValue?] = [:]) -> JSONValue {
        var fields = fields
        if let botId { fields["botId"] = .string(botId) }
        return .object(omittingNil: fields)
    }

    /// Only the primary bot is remembered: widgets, Siri and the watch use it.
    private func remember(_ info: BotInfo?) {
        if let info, !info.primary { return }
        AppGroup.defaults.set(info?.lead.threadId, forKey: ServerScope.key("botThreadId", serverURL: baseURL))
        AppGroup.defaults.set(info?.name, forKey: ServerScope.key("botName", serverURL: baseURL))
        AppGroup.defaults.set(info?.avatar, forKey: ServerScope.key("botAvatar", serverURL: baseURL))
        AppGroup.defaults.set(info?.shape, forKey: ServerScope.key("botShape", serverURL: baseURL))
        AppGroup.defaults.set(info?.color, forKey: ServerScope.key("botColor", serverURL: baseURL))
    }

    /// The Bot's look as last seen on this server, for widgets.
    public var cachedBotLook: BotLook {
        BotLook(shape: AppGroup.defaults.string(forKey: ServerScope.key("botShape", serverURL: baseURL)),
                color: AppGroup.defaults.string(forKey: ServerScope.key("botColor", serverURL: baseURL)),
                emoji: cachedBotAvatar ?? BotInfo.defaultAvatar)
    }

    /// Makes the Bot (`bot_create`); a `prompt` is its first message. A `setup`
    /// (what it should help with, possibly empty) makes Studio's setup its first
    /// message instead: it asks a couple of questions, then names itself.
    @discardableResult
    public func createBot(name: String, shape: BotShape?, color: String?, prompt: String? = nil, setup: String? = nil) async throws -> BotInfo? {
        let output: BotWire = try await rpc("studio", Studio.Method.bot_create, .object(omittingNil: [
            "name": .string(name), "avatar": .string(BotInfo.defaultAvatar),
            "shape": shape.map { .string($0.rawValue) }, "color": color.map(JSONValue.string),
            "prompt": prompt.map(JSONValue.string), "setup": setup.map(JSONValue.string),
        ]))
        let info = output.info
        if info?.primary == true { remember(info) }
        return info
    }

    /// Changes the Bot's name, look or role (`bot_set`).
    @discardableResult
    public func setBotProfile(name: String, shape: BotShape?, color: String?, role: String, botId: String? = nil) async throws -> BotInfo? {
        let output: BotWire = try await rpc("studio", Studio.Method.bot_set, Self.scoped(botId, [
            "name": .string(name), "shape": shape.map { .string($0.rawValue) } ?? .null,
            "color": color.map(JSONValue.string), "role": .string(role),
        ]))
        let info = output.info
        remember(info)
        return info
    }

    /// Edits the Bot made to its own profile, and your reverts of them, newest first. Empty from an older Studio.
    public func botProfileChanges(botId: String? = nil) async throws -> [BotProfileChange] {
        struct Output: Decodable { var changes: [BotProfileChange] }
        let output: Output = try await rpc("studio", Studio.Method.bot_profile_changes, Self.scoped(botId))
        return output.changes
    }

    /// Restores what one of the Bot's own edits replaced.
    @discardableResult
    public func revertBotProfileChange(_ id: Int, botId: String? = nil) async throws -> BotInfo? {
        let output: BotWire = try await rpc("studio", Studio.Method.bot_profile_revert, Self.scoped(botId, ["changeId": .number(Double(id))]))
        let info = output.info
        remember(info)
        return info
    }

    /// The Bot's Memory page, made on first use.
    public func botMemoryPageId(botId: String? = nil) async throws -> String? {
        struct Output: Decodable { var pageId: String? }
        let output: Output = try await rpc("studio", Studio.Method.bot_memory, Self.scoped(botId))
        return output.pageId
    }

    /// The Bot's own skills.
    public func botSkills(botId: String? = nil) async throws -> [BotSkill] {
        struct Output: Decodable { var skills: [BotSkill] }
        let output: Output = try await rpc("studio", Studio.Method.bot_skills, Self.scoped(botId))
        return output.skills
    }

    /// The Bot's skill learning settings and latest review.
    public func botLearning(botId: String? = nil) async throws -> BotLearning {
        try await rpc("studio", Studio.Method.bot_learning, Self.scoped(botId))
    }

    /// Turns Learn from work on or off.
    @discardableResult
    public func setBotLearning(enabled: Bool, botId: String? = nil) async throws -> BotLearning {
        try await rpc("studio", Studio.Method.bot_learning_set, Self.scoped(botId, ["enabled": .bool(enabled)]))
    }

    /// Pins a skill (the curator leaves it alone) or unpins it.
    public func pinBotSkill(_ name: String, pinned: Bool, botId: String? = nil) async throws {
        struct Output: Decodable { var changed: Bool }
        let _: Output = try await rpc("studio", Studio.Method.bot_skill_pin, Self.scoped(botId, ["name": .string(name), "pinned": .bool(pinned)]))
    }

    /// Brings an archived skill back.
    public func restoreBotSkill(_ name: String, botId: String? = nil) async throws {
        struct Output: Decodable { var changed: Bool }
        let _: Output = try await rpc("studio", Studio.Method.bot_skill_restore, Self.scoped(botId, ["name": .string(name)]))
    }

    public var cachedBotThreadId: String? {
        AppGroup.defaults.string(forKey: ServerScope.key("botThreadId", serverURL: baseURL))
    }

    /// The Bot's name as last seen on this server, or "Bot".
    public var cachedBotName: String {
        AppGroup.defaults.string(forKey: ServerScope.key("botName", serverURL: baseURL)) ?? BotInfo.defaultName
    }

    public var cachedBotAvatar: String? {
        AppGroup.defaults.string(forKey: ServerScope.key("botAvatar", serverURL: baseURL))
    }

    /// Makes a thread the Bot's ("Make this my Bot"); makes the Bot if there is none.
    @discardableResult
    public func makeBot(_ threadId: String) async throws -> BotInfo? {
        let _: BotWire = try await rpc("studio", Studio.Method.bot_set_thread, ["threadId": .string(threadId)])
        return try await bot()
    }

    /// Pauses, resumes or stops the Bot. Stop also stops the threads it started and its automations.
    @discardableResult
    public func setBotState(_ action: BotInfo.Action, botId: String? = nil) async throws -> BotInfo? {
        let method = switch action {
        case .pause: Studio.Method.bot_pause
        case .resume: Studio.Method.bot_resume
        case .stop: Studio.Method.bot_stop
        }
        let _: BotWire = try await rpc("studio", method, Self.scoped(botId))
        return try await bot(botId)
    }

    /// Turns the Bot's check-ins (heartbeat) on or off; on needs an active Bot.
    @discardableResult
    public func setBotHeartbeat(enabled: Bool, cadence: String, time: String?, cron: String?, botId: String? = nil) async throws -> ThreadLead {
        let output: BotWire = try await rpc("studio", Studio.Method.bot_set_run, Self.scoped(botId, [
            "enabled": .bool(enabled), "cadence": .string(cadence),
            "time": time.map(JSONValue.string), "cron": cron.map(JSONValue.string),
        ]))
        let run = output.run
        return ThreadLead(threadId: output.bot?.threadId, enabled: run?.enabled, cadence: run?.cadence, time: run?.time, cron: run?.cron)
    }

    /// The Bot's handoff chain, oldest thread first; it ends at the Bot's thread.
    /// A Studio without `bot_chain` answers with the Bot's thread alone.
    public func botChain(botId: String? = nil) async throws -> [String] {
        struct Output: Decodable { var threadIds: [String] }
        do {
            let output: Output = try await rpc("studio", Studio.Method.bot_chain, Self.scoped(botId))
            return output.threadIds
        } catch where Self.isMissingRPC(error) {
            return try await bot(botId)?.lead.threadId.map { [$0] } ?? []
        }
    }

    /// The side threads on a Bot chat's replies (`bot_side_threads`), by reply id; empty on a Studio without them.
    public func botSideThreads(threadId: String) async throws -> [String: BotSideThread] {
        struct Output: Decodable { var threads: [BotSideThread] }
        do {
            let output: Output = try await rpc("studio", Studio.Method.bot_side_threads, ["threadId": .string(threadId)])
            return Dictionary(output.threads.map { ($0.messageId, $0) }, uniquingKeysWith: { first, _ in first })
        } catch where Self.isMissingRPC(error) {
            return [:]
        }
    }

    /// A reply's side thread, forked from the chat at that reply on first open (`bot_side_thread_open`).
    public func openBotSideThread(threadId: String, messageId: String) async throws -> String {
        struct Output: Decodable { var threadId: String }
        let output: Output = try await rpc("studio", Studio.Method.bot_side_thread_open, ["threadId": .string(threadId), "messageId": .string(messageId)])
        return output.threadId
    }

    /// Sets the Bot's check-ins to a preset (`bot_checkin_preset`): one schedule and one line on its Memory page.
    @discardableResult
    public func setBotCheckinPreset(_ preset: BotCheckinPreset, botId: String? = nil) async throws -> BotInfo? {
        let output: BotWire = try await rpc("studio", Studio.Method.bot_checkin_preset, Self.scoped(botId, ["preset": .string(preset.rawValue)]))
        let info = output.info
        if botId == nil || info?.primary == true { remember(info) }
        return info
    }

    /// What the Bot is doing: Needs you, In progress, Scheduled, Completed.
    public func botActivity(botId: String? = nil) async throws -> BotActivity {
        try await rpc("studio", Studio.Method.bot_activity, Self.scoped(botId))
    }

    /// A Bot chat's prompt cache (`bot_cache_state`); nil on a Studio without it.
    public func botCacheState(threadId: String) async throws -> BotCacheState? {
        do {
            let state: BotCacheState = try await rpc("studio", Studio.Method.bot_cache_state, Self.scoped(nil, ["threadId": .string(threadId)]))
            return state
        } catch where Self.isMissingRPC(error) {
            return nil
        }
    }

    /// The bot's runners (`bot_runners`): scheduled jobs that report back to it.
    public func botRunners(botId: String? = nil) async throws -> [BotRunner] {
        struct Output: Decodable { var runners: [BotRunner]? }
        let output: Output = try await rpc("studio", Studio.Method.bot_runners, Self.scoped(botId))
        return output.runners ?? []
    }

    /// Pauses or resumes a runner.
    public func setRunnerPaused(_ id: String, paused: Bool, botId: String? = nil) async throws {
        let _: JSONValue = try await rpc("studio", paused ? Studio.Method.bot_runner_pause : Studio.Method.bot_runner_resume,
                                         Self.scoped(botId, ["id": .string(id)]))
    }

    /// Runs a runner now, off its schedule.
    public func runRunnerNow(_ id: String, botId: String? = nil) async throws {
        let _: JSONValue = try await rpc("studio", Studio.Method.bot_runner_run_now, Self.scoped(botId, ["id": .string(id)]))
    }
}

/// Studio's check-in presets, as on the desktop Bot page.
public enum BotCheckinPreset: String, CaseIterable, Identifiable, Sendable {
    case morning, evening, working, off
    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .morning: "Morning brief"
        case .evening: "Evening wrap-up"
        case .working: "Every 2 hours while I'm working"
        case .off: "Off"
        }
    }

    public var detail: String {
        switch self {
        case .morning: "Weekdays 8:00"
        case .evening: "Weekdays 18:00"
        case .working: "Weekdays 9–17"
        case .off: "Only when you message"
        }
    }

    public var symbol: String {
        switch self {
        case .morning: "sunrise.fill"
        case .evening: "sunset.fill"
        case .working: "clock.fill"
        case .off: "moon.zzz.fill"
        }
    }

    /// `bot_checkin_preset`'s input.
    public var input: JSONValue { .object(["preset": .string(rawValue)]) }

    /// Which preset a Bot's check-ins are, nil for a hand-made schedule (desktop's `presetOf`).
    public static func of(_ lead: ThreadLead?) -> BotCheckinPreset? {
        guard let cadence = lead?.heartbeat else { return .off }
        if cadence == "weekdays", lead?.time == "08:00" { return .morning }
        if cadence == "weekdays", lead?.time == "18:00" { return .evening }
        if cadence == "custom", lead?.cron == "0 9-17/2 * * 1-5" { return .working }
        return nil
    }
}

/// The first-time flow, as on desktop (Onboarding.tsx): a new Bot's default
/// name and look, ideas for what it should help with, and Create, which sends
/// that as `bot_create`'s `setup`.
public enum BotSetup {
    public struct Idea: Hashable, Sendable {
        public let label: String
        public let text: String
    }

    /// The same ideas as desktop's; a tap fills the field.
    public static let ideas = [
        Idea(label: "Watch my projects", text: "Keep an eye on my projects and tell me what needs me."),
        Idea(label: "Morning brief", text: "Give me a short brief every weekday morning: what changed, what's stuck, what needs me."),
        Idea(label: "Plan my week", text: "Help me plan my week and keep me on track."),
        Idea(label: "Triage threads", text: "Watch my threads, nudge the stuck ones and tell me which need an answer."),
    ]

    /// Its name until it picks its own: the first is the Chief of Staff.
    public static func name(first: Bool) -> String { first ? "Chief of Staff" : "New bot" }
    public static func shape(first: Bool) -> BotShape { first ? .default : .hexagon }
    public static func color(first: Bool) -> String { BotPalette.hexes[first ? 0 : 2] }
    public static func look(first: Bool) -> BotLook {
        BotLook(shape: shape(first: first).rawValue, color: color(first: first), emoji: BotInfo.defaultAvatar)
    }
    /// What goes out as `setup`: the field, trimmed (empty is fine: the Bot asks).
    public static func goal(_ text: String) -> String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
}

/// The Bot: who it is, its state, and its thread and check-ins.
public struct BotInfo: Hashable, Sendable, Codable {
    public enum State: String, Sendable, Codable { case active, paused, stopped }
    public enum Action: Sendable { case pause, resume, stop }
    public static let defaultName = "Bot"
    public static let defaultAvatar = "🤖"

    /// Studio's id for it; nil from a Studio that predates bot ids.
    public var id: String?
    /// The primary bot, which widgets, Siri and the watch use. Older Studios have only it.
    public var primary: Bool = true
    /// Runs on another provider (`kind: "external"`): no memory, skills or runners.
    public var external: Bool = false
    public var name: String
    public var avatar: String
    public var state: State
    /// Its thread and check-in (heartbeat).
    public var lead: ThreadLead
    /// Its drawn avatar; nil shows the emoji.
    public var shape: String?
    public var color: String?
    /// A sentence or two on its role.
    public var role: String?
    /// Its image avatar (generated by it or uploaded), a server path; nil draws the avatar.
    public var avatarImageUrl: String?

    public init(name: String, avatar: String, state: State, lead: ThreadLead, shape: String? = nil, color: String? = nil, role: String? = nil) {
        self.name = name
        self.avatar = avatar
        self.state = state
        self.lead = lead
        self.shape = shape
        self.color = color
        self.role = role
    }

    public var look: BotLook { BotLook(shape: shape, color: color, emoji: avatar, image: avatarImageUrl) }

    /// Primary first, then the others by name.
    public static func ordered(_ bots: [BotInfo]) -> [BotInfo] {
        bots.enumerated().sorted { l, r in
            if l.element.primary != r.element.primary { return l.element.primary }
            let order = l.element.name.localizedStandardCompare(r.element.name)
            return order == .orderedSame ? l.offset < r.offset : order == .orderedAscending
        }.map(\.element)
    }

    /// "🧭 Chief of Staff".
    public var title: String { "\(avatar) \(name)" }
}

/// `bot_get` and the other Bot RPCs' shared answer.
struct BotWire: Decodable {
    struct Bot: Decodable {
        var id: String?; var primary: Bool?; var kind: String?
        var name: String; var avatar: String; var state: String; var threadId: String?
        var shape: String?; var color: String?; var role: String?
        var avatarImageUrl: String?
    }
    struct Run: Decodable { var enabled: Bool; var cadence: String; var time: String?; var cron: String? }
    var bot: Bot?
    var run: Run?

    var info: BotInfo? {
        bot.map { bot in
            BotInfo(name: bot.name, avatar: bot.avatar, state: BotInfo.State(rawValue: bot.state) ?? .active,
                    lead: ThreadLead(threadId: bot.threadId, enabled: run?.enabled, cadence: run?.cadence, time: run?.time, cron: run?.cron),
                    shape: bot.shape, color: bot.color, role: bot.role)
                .with(id: bot.id, primary: bot.primary ?? true, external: bot.kind == "external", image: bot.avatarImageUrl)
        }
    }
}

extension BotInfo {
    func with(id: String?, primary: Bool, external: Bool, image: String? = nil) -> BotInfo {
        var copy = self
        copy.avatarImageUrl = image
        copy.id = id
        copy.primary = primary
        copy.external = external
        return copy
    }
}

/// An edit a Bot made to its own profile (`bot_profile_changes`), or your revert of one.
public struct BotProfileChange: Decodable, Hashable, Sendable, Identifiable {
    public var id: Int
    public var field: String
    public var oldValue: String?
    public var newValue: String?
    public var oldImageUrl: String?
    public var newImageUrl: String?
    public var actorName: String?
    public var at: Double
    /// The change this one undid; set on your reverts.
    public var reverts: Int?
    /// When you reverted this one.
    public var revertedAt: Double?

    public var canRevert: Bool { reverts == nil && revertedAt == nil }

    /// "Changed by Dot", or "You reverted".
    public var byLine: String { reverts != nil ? "You reverted" : "Changed by \(actorName ?? "an agent")" }

    public var fieldLabel: String {
        switch field {
        case "role": "description"
        case "avatar": "emoji"
        case "avatarImage": "avatar"
        default: field
        }
    }

    /// One side of the diff, in words.
    public func describe(_ value: String?) -> String {
        switch field {
        case "avatarImage": value?.isEmpty == false ? "an image" : "drawn"
        case "shape": value ?? "emoji"
        default: value?.isEmpty == false ? value! : "empty"
        }
    }

    /// "name: Bot → Dot".
    public var summary: String { "\(fieldLabel): \(describe(oldValue)) → \(describe(newValue))" }
}

/// One of a bot's runners: a scheduled job that reports back to it.
public struct BotRunner: Decodable, Hashable, Sendable, Identifiable {
    public struct Schedule: Decodable, Hashable, Sendable { public var cadence: String?; public var time: String?; public var cron: String? }
    public var id: String
    public var name: String
    /// The runner's own thread; opening the runner opens it.
    public var threadId: String?
    public var state: String?
    public var schedule: Schedule?
    public var nextRunAt: Double?
    public var lastRunAt: Double?
    public var lastReport: String?
    public var lastReportAt: Double?
    public var urgent: Bool?
    /// Its thread is working now. Older Studios leave these out.
    public var running: Bool?
    /// When the current run started (ms), while running; nil when BB couldn't tell.
    public var runningSince: Double?
    /// "succeeded", "failed", … from BB's automation.
    public var lastRunStatus: String?
    /// How loudly the last report spoke: "log", "tell" or "urgent".
    public var lastLevel: String?
    /// The agent provider it runs on, for its logo.
    public var providerId: String?

    public var paused: Bool { state == "paused" }

    /// "Weekdays at 08:00", "Every 2 hours", or the cron line.
    public var scheduleLabel: String {
        guard let cadence = schedule?.cadence else { return "Manual" }
        if cadence == "custom" { return schedule?.cron ?? "Custom" }
        let label = ThreadLead.cadences.first { $0.id == cadence }?.label ?? cadence
        return schedule?.time.map { "\(label) at \($0)" } ?? label
    }
}

/// One of the Bot's own skills.
public struct BotSkill: Decodable, Hashable, Sendable, Identifiable {
    public var name: String
    public var description: String
    public var updatedAt: Double
    /// "active", "stale" (unused 30 days) or "archived" (unused 90 days; hidden from the Bot, restorable).
    public var state: String?
    /// The curator leaves a pinned skill alone.
    public var pinned: Bool?
    public var id: String { name }
    public var isArchived: Bool { state == "archived" }
}

/// A Bot's skill learning (`bot_learning`).
public struct BotLearning: Decodable, Hashable, Sendable {
    public struct Result: Decodable, Hashable, Sendable { public var at: Double; public var result: String }
    public var enabled: Bool
    public var interval: Int
    public var reviewing: Bool
    public var lastReview: Result?

    /// "Saved 1 skill · 2h ago", "Reviewing now…" or nil before the first review.
    public func status(now: Date = Date()) -> String? {
        if reviewing { return "Reviewing now…" }
        guard let lastReview else { return nil }
        let ago = RelativeDateTimeFormatter().localizedString(for: Date(timeIntervalSince1970: lastReview.at / 1000), relativeTo: now)
        return "\(lastReview.result) · \(ago)"
    }
}

/// The Bot's Activity (`bot_activity`).
public struct BotActivity: Decodable, Hashable, Sendable {
    public struct Thread: Decodable, Hashable, Sendable, Identifiable {
        public var id: String
        public var title: String
        public var status: String
        /// "self" for the Bot's own thread, "started" for one it started.
        public var relation: String
        public var needsYou: Bool
        public var updatedAt: Double
        /// The listed thread that started this one; nil when the Bot did (or older Studios).
        public var parentId: String?
        /// When its current turn started (ms), while it works; nil when BB couldn't tell.
        public var runningSince: Double?
        /// The agent provider it runs on, for its logo.
        public var providerId: String?
    }
    public struct Scheduled: Decodable, Hashable, Sendable, Identifiable {
        public var id: String
        /// "heartbeat" or "automation".
        public var kind: String
        public var name: String
        public var enabled: Bool
        public var nextRunAt: Double?
    }
    public var needsYou: [Thread]
    /// Queued behind other work; older Studios leave it out.
    public var waiting: [Thread]?
    public var inProgress: [Thread]
    public var scheduled: [Scheduled]
    public var completed: [Thread]
    public var latest: String?
    /// Compactions Studio's cache warmer ran; older Studios leave it out.
    public var compactions: [Compaction]?

    /// One compaction Studio ran before a Bot chat's prompt cache expired.
    public struct Compaction: Decodable, Hashable, Sendable {
        public var threadId: String
        /// Milliseconds.
        public var at: Double
        public var tokens: Double?

        public init(threadId: String, at: Double, tokens: Double? = nil) {
            self.threadId = threadId
            self.at = at
            self.tokens = tokens
        }
    }
}

/// A lead thread (the Bot's) and its heartbeat.
public struct ThreadLead: Hashable, Sendable, Codable {
    public var threadId: String?
    /// The heartbeat's cadence (`hourly`, `every15minutes`…), nil when it's off.
    public var heartbeat: String?
    public var time: String?
    public var cron: String?

    public init(threadId: String?, heartbeat: String? = nil, time: String? = nil, cron: String? = nil) {
        self.threadId = threadId
        self.heartbeat = heartbeat
        self.time = time
        self.cron = cron
    }

    /// From any of Studio's run shapes; the heartbeat is nil unless it's enabled.
    init<Cadence: Encodable>(threadId: String?, enabled: Bool?, cadence: Cadence?, time: String?, cron: String?) {
        self.init(threadId: threadId, heartbeat: enabled == true ? Self.cadenceId(cadence) : nil, time: time, cron: cron)
    }

    /// The wire id of a generated cadence enum (`hourly`, `every15minutes`, or whatever a newer Studio sent).
    static func cadenceId<Cadence: Encodable>(_ cadence: Cadence?) -> String? {
        guard let cadence, let data = try? JSONEncoder().encode(cadence) else { return nil }
        return try? JSONDecoder().decode(String.self, from: data)
    }

    /// The heartbeat choices, in Studio's order, with their labels.
    public static let cadences: [(id: String, label: String)] = [
        ("every5minutes", "Every 5 minutes"), ("every15minutes", "Every 15 minutes"), ("every30minutes", "Every 30 minutes"),
        ("hourly", "Hourly"), ("every2hours", "Every 2 hours"), ("every6hours", "Every 6 hours"),
        ("daily", "Daily"), ("weekdays", "Weekdays"), ("weekly", "Weekly"), ("custom", "Custom"),
    ]
}

/// A Bot chat's prompt cache (`bot_cache_state`, src/bot-cache.ts in Studio):
/// warm while Studio keeps it so, cold once it expired, or not warmed.
public struct BotCacheState: Decodable, Hashable, Sendable {
    public struct Warming: Decodable, Hashable, Sendable {
        public var active: Bool
        public var reason: String?
    }
    public var botId: String?
    /// "warm", "cold" or "off".
    public var state: String
    public var label: String
    /// Milliseconds since 1970.
    public var warmUntil: Double?
    public var warming: Warming

    /// "Warm · 42m" counted down to `now`, "Cold" or "Warming off"; nil when it isn't a Bot's chat.
    public func line(now: Date = .now) -> String? {
        guard botId != nil, !label.isEmpty else { return nil }
        if state == "warm", let warmUntil {
            let left = warmUntil / 1000 - now.timeIntervalSince1970
            return left > 0 ? "Warm · \(max(1, Int((left / 60).rounded(.up))))m" : "Cold"
        }
        return label
    }
}

/// A side thread on one of the Bot's replies: a fork of its chat at that reply.
public struct BotSideThread: Codable, Hashable, Sendable {
    public var messageId: String
    public var threadId: String
    public var replies: Int
    /// Milliseconds, as Studio sends them.
    public var lastReplyAt: Double?
    public var working: Bool

    /// "2 replies · 5m ago", "Working…", "Thread".
    public func label(now: Date = .now) -> String {
        let count = replies == 1 ? "1 reply" : "\(replies) replies"
        if working { return replies > 0 ? "\(count) · working…" : "Working…" }
        guard replies > 0 else { return "Thread" }
        guard let lastReplyAt else { return count }
        let at = Date(timeIntervalSince1970: lastReplyAt / 1000)
        return "\(count) · \(at.formatted(.relative(presentation: .named, unitsStyle: .abbreviated)))"
    }
}
