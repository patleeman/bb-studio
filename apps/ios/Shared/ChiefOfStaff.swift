import Foundation

// MARK: Chief of Staff

/// The Personal Space's lead thread: the agent the app, widgets, Siri and the
/// watch all go to first.
extension BBClient {
    /// Nil when the Personal Space has no lead. Remembers the last answer per
    /// server so widgets can draw while offline.
    public func chiefOfStaffThreadId() async throws -> String? {
        guard let personal = try await studioSpaces().first(where: \.isDefault) else { return nil }
        let id = try await spaceLead(personal.id).threadId
        AppGroup.defaults.set(id, forKey: ServerScope.key("chiefThreadId", serverURL: baseURL))
        return id
    }

    public var cachedChiefOfStaffThreadId: String? {
        AppGroup.defaults.string(forKey: ServerScope.key("chiefThreadId", serverURL: baseURL))
    }
}
