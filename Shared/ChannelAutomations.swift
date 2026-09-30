import Foundation

/// A prompt a bot posts to a channel on a schedule, from Bot Teams. BB's
/// Automations plugin runs it; Bot Teams keeps which channel and bot it's for.
public struct ChannelAutomation: Decodable, Identifiable, Hashable, Sendable {
    public var id: String
    public var channelId: String
    public var botId: String
    public var name: String
    public var prompt: String
    public var enabled: Bool
    public var trigger: Trigger
    public var nextRunAt: Double?
    public var lastRunAt: Double?
    public var lastRunStatus: String?
    public var lastError: String?

    public struct Trigger: Codable, Hashable, Sendable {
        /// "schedule" or "once".
        public var triggerType: String
        public var cron: String?
        public var timezone: String?
        public var runAt: Double?

        public static func schedule(_ cron: String, timezone: String) -> Trigger {
            Trigger(triggerType: "schedule", cron: cron, timezone: timezone)
        }

        public static func once(_ date: Date) -> Trigger {
            Trigger(triggerType: "once", runAt: (date.timeIntervalSince1970 * 1000).rounded())
        }

        var json: JSONValue {
            if triggerType == "once" { return ["triggerType": "once", "runAt": .from(Int(runAt ?? 0))] }
            return ["triggerType": "schedule", "cron": .string(cron ?? ""), "timezone": .string(timezone ?? "")]
        }

        /// As the web app puts it: "Weekdays at 09:00 · America/New_York".
        public var description: String {
            if triggerType == "once" {
                return "Once · " + Date(timeIntervalSince1970: (runAt ?? 0) / 1000).formatted(date: .abbreviated, time: .shortened)
            }
            let zone = timezone ?? ""
            let parts = (cron ?? "").split(whereSeparator: \.isWhitespace).map(String.init)
            if parts.count == 5, let minute = Int(parts[0]), let hour = Int(parts[1]), parts[2] == "*", parts[3] == "*",
                ["*", "1-5"].contains(parts[4])
            {
                return "\(parts[4] == "1-5" ? "Weekdays" : "Every day") at \(String(format: "%02d:%02d", hour, minute)) · \(zone)"
            }
            if cron == "0 * * * *" { return "Every hour · \(zone)" }
            return "Custom schedule (\(cron ?? "")) · \(zone)"
        }
    }
}

public struct ChannelAutomationRun: Decodable, Identifiable, Hashable, Sendable {
    public var id: String
    public var status: String
    public var trigger: String
    public var startedAt: Double
    public var finishedAt: Double?
    public var error: String?
    public var skipReason: String?
    public var responseStatus: String?
    public var responseThreadId: String?
    public var responseError: String?
    public var output: String?
}

extension BBClient {
    public func channelAutomations(_ channelId: String) async throws -> [ChannelAutomation] {
        struct Result: Decodable { var automations: [ChannelAutomation] }
        let result: Result = try await rpc("bot-teams", "automationList", ["channelId": .string(channelId), "limit": 50])
        return result.automations
    }

    public func createChannelAutomation(
        _ channelId: String, botId: String, name: String, prompt: String, trigger: ChannelAutomation.Trigger, enabled: Bool
    ) async throws -> ChannelAutomation {
        try await rpc("bot-teams", "automationCreate", [
            "channelId": .string(channelId), "botId": .string(botId), "name": .string(name), "prompt": .string(prompt),
            "trigger": trigger.json, "enabled": .bool(enabled), "requestId": .string(UUID().uuidString.lowercased()),
        ])
    }

    public func updateChannelAutomation(
        _ automation: ChannelAutomation, name: String, prompt: String, trigger: ChannelAutomation.Trigger
    ) async throws -> ChannelAutomation {
        try await rpc("bot-teams", "automationUpdate", [
            "channelId": .string(automation.channelId), "automationId": .string(automation.id), "name": .string(name),
            "prompt": .string(prompt), "trigger": trigger.json,
        ])
    }

    /// "pause", "resume", "run" or "delete".
    public func channelAutomationAction(_ automation: ChannelAutomation, _ action: String) async throws {
        var input: [String: JSONValue] = [
            "channelId": .string(automation.channelId), "automationId": .string(automation.id), "action": .string(action),
        ]
        if action == "run" { input["requestId"] = .string(UUID().uuidString.lowercased()) }
        let _: JSONValue = try await rpc("bot-teams", "automationAction", .object(input))
    }

    public func channelAutomationRuns(_ automation: ChannelAutomation, cursor: String? = nil) async throws
        -> (runs: [ChannelAutomationRun], next: String?)
    {
        struct Result: Decodable {
            var runs: [ChannelAutomationRun]
            var nextCursor: String?
        }
        var input: [String: JSONValue] = [
            "channelId": .string(automation.channelId), "automationId": .string(automation.id), "limit": 10,
        ]
        if let cursor { input["cursor"] = .string(cursor) }
        let result: Result = try await rpc("bot-teams", "automationRuns", .object(input))
        return (result.runs, result.nextCursor)
    }
}
