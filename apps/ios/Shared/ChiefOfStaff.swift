import Foundation

// MARK: Chief of Staff

/// Studio's Chief of Staff slot: one thread above every Space that the app,
/// widgets, Siri and the watch all go to first. It starts empty and is never
/// filled in from a Space's lead.
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
}
