import Foundation

/// A bot automation's schedule, as Studio's `scheduleSchema` (src/schedule.ts):
/// `times` on days, an `interval` within a window, a raw `cron`, or `once`.
/// Studio compiles it to BB crons and says what it means (`scheduleText`).
public struct BotSchedule: Codable, Hashable, Sendable {
    public struct Quiet: Codable, Hashable, Sendable { public var from: String; public var to: String }
    public var type: String
    public var days: [Int]?
    public var times: [String]?
    public var every: Int?
    public var unit: String?
    public var from: String?
    public var to: String?
    public var cron: String?
    public var at: Double?
    public var timezone: String?
    public var quiet: Quiet?
    public var until: String?

    public static let weekdays = [1, 2, 3, 4, 5]
    public static let everyDay = [0, 1, 2, 3, 4, 5, 6]
    public static func times(_ times: [String], days: [Int] = weekdays) -> BotSchedule { BotSchedule(type: "times", days: days, times: times) }
    public static func once(_ date: Date) -> BotSchedule { BotSchedule(type: "once", at: (date.timeIntervalSince1970 * 1000).rounded()) }

    /// The JSON Studio takes: only this type's fields.
    public var json: JSONValue {
        func time(_ value: String?) -> JSONValue? { value.map(JSONValue.string) }
        var fields: [String: JSONValue?] = ["type": .string(type)]
        switch type {
        case "once":
            fields["at"] = .number(at ?? 0)
            return .object(omittingNil: fields)
        case "times":
            fields["days"] = .array((days ?? Self.everyDay).map { .number(Double($0)) })
            fields["times"] = .array((times ?? []).map(JSONValue.string))
        case "interval":
            fields["days"] = .array((days ?? Self.everyDay).map { .number(Double($0)) })
            fields["every"] = .number(Double(every ?? 30))
            fields["unit"] = .string(unit ?? "minutes")
            fields["from"] = time(from)
            fields["to"] = time(to)
        default:
            fields["cron"] = .string(cron ?? "")
        }
        fields["timezone"] = timezone.map(JSONValue.string)
        if let quiet, type != "cron" { fields["quiet"] = .object(["from": .string(quiet.from), "to": .string(quiet.to)]) }
        fields["until"] = until.map(JSONValue.string)
        return .object(omittingNil: fields)
    }
}

/// One of a bot's automations (`bot_automations`): a check-in, reminder, watcher or runner.
public struct BotAutomation: Decodable, Identifiable, Hashable, Sendable {
    public enum Kind: String, Decodable, CaseIterable, Identifiable, Sendable {
        case checkin, reminder, watcher, runner
        public var id: String { rawValue }
        public var title: String {
            switch self { case .checkin: "Check-in"; case .reminder: "Reminder"; case .watcher: "Watcher"; case .runner: "Runner" }
        }
        public var symbol: String {
            switch self { case .checkin: "bubble.left"; case .reminder: "alarm"; case .watcher: "eye"; case .runner: "repeat" }
        }
        public var blurb: String {
            switch self {
            case .checkin: "Wakes the bot in its chat with a short instruction, on a schedule."
            case .reminder: "One message to the bot at a time you pick."
            case .watcher: "A script on a schedule. It wakes the bot only when it prints something."
            case .runner: "A recurring job in its own thread that reports only what matters."
            }
        }
    }
    public struct Model: Decodable, Hashable, Sendable { public var model: String?; public var reasoning: String? }
    public struct Script: Decodable, Hashable, Sendable {
        public var body: String
        public var interpreter: String
        public var timeoutMs: Double
        public var workingDirectory: String?
        public var envKeys: [String]
    }
    public var id: String
    public var kind: Kind
    public var name: String
    /// The bot's original check-in (its heartbeat): its instruction is its Memory page's Check-in section.
    public var original: Bool
    public var instruction: String
    public var schedule: BotSchedule
    public var scheduleText: String
    /// active, paused, done (a reminder that ran) or ended (past its end date).
    public var state: String
    public var nextRunAt: Double?
    public var lastRunAt: Double?
    public var lastOutcome: String?
    public var model: Model?
    public var script: Script?
    public var target: String
    public var targetName: String
    public var threadId: String?

    public var active: Bool { state == "active" }
}

public struct BotAutomationRun: Decodable, Identifiable, Hashable, Sendable {
    public var id: String
    public var at: Double
    public var status: String
    public var manual: Bool
    public var outcome: String
    public var threadId: String?
}

/// What a new or edited automation sends.
public struct BotAutomationDraft: Hashable, Sendable {
    public var name = ""
    public var instruction = ""
    public var schedule = BotSchedule.times(["08:00"])
    public var model = ""
    public var reasoning = ""
    public var script = ""
    public var interpreter = "bash"
    public var timeoutSeconds = 60
    public var target = "main"
    public init() {}

    public init(_ automation: BotAutomation) {
        name = automation.name
        instruction = automation.original ? "" : automation.instruction
        schedule = automation.schedule
        model = automation.model?.model ?? ""
        reasoning = automation.model?.reasoning ?? ""
        script = automation.script?.body ?? ""
        interpreter = automation.script?.interpreter ?? "bash"
        timeoutSeconds = Int((automation.script?.timeoutMs ?? 60_000) / 1000)
        target = automation.target == "own" ? "main" : automation.target
    }

    /// The RPC fields for `kind`; the original check-in sends only its schedule.
    public func fields(kind: BotAutomation.Kind, original: Bool = false) -> [String: JSONValue?] {
        var fields: [String: JSONValue?] = ["schedule": schedule.json]
        if original { return fields }
        fields["name"] = .string(name.trimmingCharacters(in: .whitespacesAndNewlines))
        fields["instruction"] = .string(instruction.trimmingCharacters(in: .whitespacesAndNewlines))
        switch kind {
        case .checkin, .reminder:
            let model = model.trimmingCharacters(in: .whitespaces)
            fields["model"] = .object(omittingNil: ["model": model.isEmpty ? nil : .string(model), "reasoning": reasoning.isEmpty ? nil : .string(reasoning)])
        case .watcher:
            fields["script"] = .object(["body": .string(script), "interpreter": .string(interpreter), "timeoutMs": .number(Double(max(1, min(900, timeoutSeconds)) * 1000))])
            fields["target"] = .string(target)
        case .runner:
            break
        }
        return fields
    }
}

extension BBClient {
    public func botAutomations(botId: String? = nil) async throws -> [BotAutomation] {
        struct Output: Decodable { var automations: [BotAutomation] }
        let output: Output = try await rpc("studio", Studio.Method.bot_automations, Self.scoped(botId))
        return output.automations
    }

    @discardableResult
    public func createBotAutomation(_ kind: BotAutomation.Kind, _ draft: BotAutomationDraft, botId: String? = nil) async throws -> BotAutomation {
        var fields = draft.fields(kind: kind)
        fields["kind"] = .string(kind.rawValue)
        return try await rpc("studio", Studio.Method.bot_automation_create, Self.scoped(botId, fields))
    }

    @discardableResult
    public func updateBotAutomation(_ automation: BotAutomation, _ draft: BotAutomationDraft, botId: String? = nil) async throws -> BotAutomation {
        var fields = draft.fields(kind: automation.kind, original: automation.original)
        fields["id"] = .string(automation.id)
        return try await rpc("studio", Studio.Method.bot_automation_update, Self.scoped(botId, fields))
    }

    public enum BotAutomationAction: Sendable { case pause, resume, runNow }

    @discardableResult
    public func botAutomation(_ action: BotAutomationAction, id: String, botId: String? = nil) async throws -> BotAutomation {
        let method = switch action {
        case .pause: Studio.Method.bot_automation_pause
        case .resume: Studio.Method.bot_automation_resume
        case .runNow: Studio.Method.bot_automation_run_now
        }
        return try await rpc("studio", method, Self.scoped(botId, ["id": .string(id)]))
    }

    public func deleteBotAutomation(id: String, botId: String? = nil) async throws {
        let _: JSONValue = try await rpc("studio", Studio.Method.bot_automation_delete, Self.scoped(botId, ["id": .string(id)]))
    }

    public func botAutomationRuns(id: String, botId: String? = nil, limit: Int = 8) async throws -> [BotAutomationRun] {
        struct Output: Decodable { var runs: [BotAutomationRun] }
        let output: Output = try await rpc("studio", Studio.Method.bot_automation_runs, Self.scoped(botId, ["id": .string(id), "limit": .number(Double(limit))]))
        return output.runs
    }
}
