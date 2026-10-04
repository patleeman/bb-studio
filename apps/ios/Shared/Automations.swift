import Foundation

/// A scheduled agent or script run, from the automations plugin.
public struct Automation: Decodable, Identifiable, Hashable, Sendable {
    public struct Trigger: Decodable, Hashable, Sendable {
        /// `schedule` or `once`.
        public var triggerType: String
        public var cron: String?
        public var timezone: String?
        public var runAt: Double?
    }

    /// Only the fields worth showing. `env` is left out on purpose: it can hold secrets.
    public struct Execution: Decodable, Hashable, Sendable {
        /// `agent` or `script`.
        public var mode: String
        public var prompt: String?
        public var providerId: String?
        public var model: String?
        public var reasoningLevel: String?
        public var targetThreadId: String?
        public var scriptFile: String?
        public var interpreter: String?
    }

    public var id: String
    public var projectId: String
    public var name: String
    public var enabled: Bool
    public var trigger: Trigger
    public var execution: Execution
    public var nextRunAt: Double?
    public var lastRunAt: Double?
    public var runCount: Int?
    public var lastRunStatus: String?
    public var lastRunThreadId: String?
    public var lastError: String?

    public var schedule: String {
        switch trigger.triggerType {
        case "once":
            guard let runAt = trigger.runAt else { return "Once" }
            return "Once, " + Date(timeIntervalSince1970: runAt / 1000).formatted(date: .abbreviated, time: .shortened)
        default:
            return trigger.cron.map(Cron.describe) ?? "On a schedule"
        }
    }
}

public struct AutomationRun: Decodable, Identifiable, Hashable, Sendable {
    public var id: String
    public var status: String
    /// `schedule`, `manual`, …
    public var trigger: String?
    public var threadId: String?
    public var skipReason: String?
    public var error: String?
    public var output: String?
    public var exitCode: Int?
    public var scheduledFor: Double?
    public var startedAt: Double?
    public var finishedAt: Double?

    public var duration: TimeInterval? {
        guard let startedAt, let finishedAt else { return nil }
        return (finishedAt - startedAt) / 1000
    }
}

/// Plain-English cron, for the common shapes; anything else shows as written.
public enum Cron {
    public static func describe(_ cron: String) -> String {
        let fields = cron.split(separator: " ").map(String.init)
        guard fields.count == 5 else { return cron }
        let (minute, hour, day, month, weekday) = (fields[0], fields[1], fields[2], fields[3], fields[4])
        guard day == "*", month == "*" else { return cron }
        if hour == "*", let m = Int(minute) {
            return m == 0 ? "Hourly" : "Hourly at :\(String(format: "%02d", m))"
        }
        if minute.hasPrefix("*/"), hour == "*", weekday == "*" {
            return "Every \(minute.dropFirst(2)) minutes"
        }
        guard let h = Int(hour), let m = Int(minute) else { return cron }
        var components = DateComponents()
        components.hour = h
        components.minute = m
        let time = Calendar.current.date(from: components)?.formatted(date: .omitted, time: .shortened) ?? "\(h):\(m)"
        switch weekday {
        case "*": return "Daily at \(time)"
        case "1-5": return "Weekdays at \(time)"
        case "0,6", "6,0": return "Weekends at \(time)"
        default:
            let names = Calendar.current.weekdaySymbols
            let days = weekday.split(separator: ",").compactMap { Int($0) }.map { names[$0 % 7] }
            return days.isEmpty ? cron : days.joined(separator: ", ") + " at \(time)"
        }
    }
}

extension BBClient {
    public func automations() async throws -> [(automation: Automation, projectName: String)] {
        struct Overview: Decodable {
            struct Entry: Decodable {
                struct Project: Decodable { var id: String; var name: String }
                var automation: Automation
                var project: Project?
            }
            var automations: [Entry]
        }
        let overview: Overview = try await rpc("automations", "automations_overview")
        return overview.automations.map { ($0.automation, $0.project?.name ?? "") }
    }

    public func automationRuns(_ automation: Automation, limit: Int = 30, cursor: String? = nil) async throws
        -> (runs: [AutomationRun], next: String?)
    {
        struct Page: Decodable { var runs: [AutomationRun]; var nextCursor: String? }
        var input: [String: JSONValue] = [
            "projectId": .string(automation.projectId), "automationId": .string(automation.id), "limit": .number(Double(limit)),
        ]
        if let cursor { input["cursor"] = .string(cursor) }
        let page: Page = try await rpc("automations", "automations_runs", .object(input))
        return (page.runs, page.nextCursor)
    }

    public func runAutomation(_ automation: Automation) async throws {
        let _: JSONValue = try await rpc(
            "automations", "automations_run",
            ["projectId": .string(automation.projectId), "automationId": .string(automation.id), "idempotencyKey": .string(UUID().uuidString)])
    }

    public func setAutomation(_ automation: Automation, enabled: Bool) async throws -> Automation {
        try await rpc(
            "automations", enabled ? "automations_resume" : "automations_pause",
            ["projectId": .string(automation.projectId), "automationId": .string(automation.id)])
    }

    public func createAutomation(projectId: String, name: String, prompt: String, trigger: JSONValue,
                                 execution: ExecutionChoice) async throws -> Automation {
        let provider = execution.providerId ?? ""
        let model = execution.model ?? ""
        let body: JSONValue = [
            "projectId": .string(projectId), "name": .string(name), "enabled": true,
            "trigger": trigger, "origin": "app",
            "execution": ["mode": "agent", "prompt": .string(prompt), "providerId": .string(provider),
                          "model": .string(model), "reasoningLevel": .string(execution.reasoningLevel ?? "medium"),
                          "permissionMode": .string(execution.permissionMode ?? "auto"),
                          "environment": ["type": "project-default"]],
        ]
        return try await rpc("automations", "automations_create", body)
    }

    public func updateAutomation(_ automation: Automation, name: String, prompt: String?, trigger: JSONValue) async throws -> Automation {
        var body: [String: JSONValue] = ["projectId": .string(automation.projectId),
                                          "automationId": .string(automation.id), "name": .string(name), "trigger": trigger]
        if let prompt { body["agent"] = ["prompt": .string(prompt)] }
        return try await rpc("automations", "automations_update", .object(body))
    }
}
