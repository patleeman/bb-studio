import Foundation

// MARK: Bot

/// Studio's Bot: the user's always-on agent (it replaced the Chief of Staff),
/// with a name, an emoji and a state. Its thread is the lead of BB's personal
/// project, which the app, widgets, Siri and the watch all go to first.
extension BBClient {
    /// The Bot, or nil when there is none, or when Studio is absent. A Studio that
    /// predates the Bot answers through `chief_of_staff` as a Bot named "Chief of
    /// Staff". Remembers the answer per server so widgets can draw while offline.
    public func bot() async throws -> BotInfo? {
        do {
            let output: BotWire = try await rpc("studio", Studio.Method.bot_get, .object([:]))
            let info = output.info
            remember(info)
            return info
        } catch where Self.isMissingRPC(error) {
            do {
                let output: Studio.ChiefOfStaffOutput = try await rpc("studio", Studio.Method.chief_of_staff, .object([:]))
                let run = output.run
                let info = output.threadId.map { _ in
                    BotInfo(name: "Chief of Staff", avatar: BotInfo.defaultAvatar, state: .active,
                            lead: ThreadLead(threadId: output.threadId, enabled: run?.enabled, cadence: run?.cadence, time: run?.time, cron: run?.cron))
                }
                remember(info)
                return info
            } catch where Self.isMissingRPC(error) {
                remember(nil)
                return nil
            }
        }
    }

    /// The Bot's thread, nil when there is no Bot or Studio is absent.
    public func botThreadId() async throws -> String? {
        try await bot()?.lead.threadId
    }

    private func remember(_ info: BotInfo?) {
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

    /// Makes the Bot (`bot_create`); a `prompt` is its first message.
    @discardableResult
    public func createBot(name: String, shape: BotShape?, color: String?, prompt: String?) async throws -> BotInfo? {
        let output: BotWire = try await rpc("studio", Studio.Method.bot_create, .object(omittingNil: [
            "name": .string(name), "avatar": .string(BotInfo.defaultAvatar),
            "shape": shape.map { .string($0.rawValue) }, "color": color.map(JSONValue.string),
            "prompt": prompt.map(JSONValue.string),
        ]))
        let info = output.info
        remember(info)
        return info
    }

    /// Changes the Bot's name, look or role (`bot_set`).
    @discardableResult
    public func setBotProfile(name: String, shape: BotShape?, color: String?, role: String) async throws -> BotInfo? {
        let output: BotWire = try await rpc("studio", Studio.Method.bot_set, .object(omittingNil: [
            "name": .string(name), "shape": shape.map { .string($0.rawValue) } ?? .null,
            "color": color.map(JSONValue.string), "role": .string(role),
        ]))
        let info = output.info
        remember(info)
        return info
    }

    /// The Bot's Memory page, made on first use.
    public func botMemoryPageId() async throws -> String? {
        struct Output: Decodable { var pageId: String? }
        let output: Output = try await rpc("studio", Studio.Method.bot_memory, .object([:]))
        return output.pageId
    }

    /// The Bot's own skills.
    public func botSkills() async throws -> [BotSkill] {
        struct Output: Decodable { var skills: [BotSkill] }
        let output: Output = try await rpc("studio", Studio.Method.bot_skills, .object([:]))
        return output.skills
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
    public func setBotState(_ action: BotInfo.Action) async throws -> BotInfo? {
        let method = switch action {
        case .pause: Studio.Method.bot_pause
        case .resume: Studio.Method.bot_resume
        case .stop: Studio.Method.bot_stop
        }
        let _: BotWire = try await rpc("studio", method, .object([:]))
        return try await bot()
    }

    /// Turns the Bot's check-ins (heartbeat) on or off; on needs an active Bot.
    @discardableResult
    public func setBotHeartbeat(enabled: Bool, cadence: String, time: String?, cron: String?) async throws -> ThreadLead {
        let output: BotWire = try await rpc("studio", Studio.Method.bot_set_run, .object(omittingNil: [
            "enabled": .bool(enabled), "cadence": .string(cadence),
            "time": time.map(JSONValue.string), "cron": cron.map(JSONValue.string),
        ]))
        let run = output.run
        return ThreadLead(threadId: output.bot?.threadId, enabled: run?.enabled, cadence: run?.cadence, time: run?.time, cron: run?.cron)
    }

    /// The Bot's handoff chain, oldest thread first; it ends at the Bot's thread.
    /// A Studio without `bot_chain` answers with the Bot's thread alone.
    public func botChain() async throws -> [String] {
        struct Output: Decodable { var threadIds: [String] }
        do {
            let output: Output = try await rpc("studio", Studio.Method.bot_chain, .object([:]))
            return output.threadIds
        } catch where Self.isMissingRPC(error) {
            return try await botThreadId().map { [$0] } ?? []
        }
    }

    /// Sets the Bot's check-ins to a preset (`bot_checkin_preset`): one schedule and one line on its Memory page.
    @discardableResult
    public func setBotCheckinPreset(_ preset: BotCheckinPreset) async throws -> BotInfo? {
        let output: BotWire = try await rpc("studio", Studio.Method.bot_checkin_preset, preset.input)
        let info = output.info
        remember(info)
        return info
    }

    /// What the Bot is doing: Needs you, In progress, Scheduled, Completed.
    public func botActivity() async throws -> BotActivity {
        try await rpc("studio", Studio.Method.bot_activity, .object([:]))
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

/// The Bot: who it is, its state, and its thread and check-ins.
public struct BotInfo: Hashable, Sendable {
    public enum State: String, Sendable { case active, paused, stopped }
    public enum Action: Sendable { case pause, resume, stop }
    public static let defaultName = "Bot"
    public static let defaultAvatar = "🤖"

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

    public init(name: String, avatar: String, state: State, lead: ThreadLead, shape: String? = nil, color: String? = nil, role: String? = nil) {
        self.name = name
        self.avatar = avatar
        self.state = state
        self.lead = lead
        self.shape = shape
        self.color = color
        self.role = role
    }

    public var look: BotLook { BotLook(shape: shape, color: color, emoji: avatar) }

    /// "🧭 Chief of Staff".
    public var title: String { "\(avatar) \(name)" }
}

/// `bot_get` and the other Bot RPCs' shared answer.
struct BotWire: Decodable {
    struct Bot: Decodable {
        var name: String; var avatar: String; var state: String; var threadId: String?
        var shape: String?; var color: String?; var role: String?
    }
    struct Run: Decodable { var enabled: Bool; var cadence: String; var time: String?; var cron: String? }
    var bot: Bot?
    var run: Run?

    var info: BotInfo? {
        bot.map { bot in
            BotInfo(name: bot.name, avatar: bot.avatar, state: BotInfo.State(rawValue: bot.state) ?? .active,
                    lead: ThreadLead(threadId: bot.threadId, enabled: run?.enabled, cadence: run?.cadence, time: run?.time, cron: run?.cron),
                    shape: bot.shape, color: bot.color, role: bot.role)
        }
    }
}

/// One of the Bot's own skills.
public struct BotSkill: Decodable, Hashable, Sendable, Identifiable {
    public var name: String
    public var description: String
    public var updatedAt: Double
    public var id: String { name }
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
}

/// A lead thread (the Bot's) and its heartbeat.
public struct ThreadLead: Hashable, Sendable {
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
