import Foundation

// MARK: Chief of Staff

/// Studio's Chief of Staff: the lead of BB's personal project, which the app,
/// widgets, Siri and the watch all go to first. It starts empty.
extension BBClient {
    /// Nil when no Chief of Staff is set, or when Studio is absent or too old to
    /// know `chief_of_staff`. Remembers the last answer per server so widgets can
    /// draw while offline.
    public func chiefOfStaffThreadId() async throws -> String? {
        let id: String?
        do {
            let output: Studio.ChiefOfStaffOutput = try await rpc("studio", Studio.Method.chief_of_staff, .object([:]))
            id = output.threadId
        } catch where Self.isMissingRPC(error) {
            id = nil
        }
        AppGroup.defaults.set(id, forKey: ServerScope.key("chiefThreadId", serverURL: baseURL))
        return id
    }

    /// Makes a thread the Chief of Staff, replacing any other; nil empties the slot.
    public func setChiefOfStaff(_ threadId: String?) async throws {
        let output: Studio.ChiefOfStaffSetOutput = try await rpc(
            "studio", Studio.Method.chief_of_staff_set, ["threadId": threadId.map(JSONValue.string) ?? .null])
        AppGroup.defaults.set(output.threadId, forKey: ServerScope.key("chiefThreadId", serverURL: baseURL))
    }

    public var cachedChiefOfStaffThreadId: String? {
        AppGroup.defaults.string(forKey: ServerScope.key("chiefThreadId", serverURL: baseURL))
    }

    /// The Chief of Staff and its heartbeat, for the heartbeat sheet. Nil when Studio is absent or too old for the slot.
    public func chiefOfStaff() async throws -> ThreadLead? {
        do {
            let output: Studio.ChiefOfStaffOutput = try await rpc("studio", Studio.Method.chief_of_staff, .object([:]))
            AppGroup.defaults.set(output.threadId, forKey: ServerScope.key("chiefThreadId", serverURL: baseURL))
            let run = output.run
            return ThreadLead(threadId: output.threadId, enabled: run?.enabled, cadence: run?.cadence, time: run?.time, cron: run?.cron)
        } catch where Self.isMissingRPC(error) {
            return nil
        }
    }

    /// Turns the Chief of Staff's heartbeat on or off; on needs a Chief of Staff.
    @discardableResult
    public func setChiefOfStaffHeartbeat(enabled: Bool, cadence: String, time: String?, cron: String?) async throws -> ThreadLead {
        let output: Studio.ChiefOfStaffSetRunOutput = try await rpc("studio", Studio.Method.chief_of_staff_set_run, .object(omittingNil: [
            "enabled": .bool(enabled), "cadence": .string(cadence),
            "time": time.map(JSONValue.string), "cron": cron.map(JSONValue.string),
        ]))
        let run = output.run
        return ThreadLead(threadId: output.threadId, enabled: run?.enabled, cadence: run?.cadence, time: run?.time, cron: run?.cron)
    }
}

/// A lead thread (the Chief of Staff) and its heartbeat.
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
