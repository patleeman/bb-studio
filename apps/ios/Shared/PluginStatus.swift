import Foundation

public struct InstalledPlugin: Decodable, Identifiable, Sendable {
    public var id: String
    public var name: String?
    public var enabled: Bool
    public var status: String
    public var statusDetail: String?
}

extension BBClient {
    public func installedPlugins() async throws -> [InstalledPlugin] {
        struct Response: Decodable { var plugins: [InstalledPlugin] }
        let response: Response = try await get("/api/v1/plugins")
        return response.plugins.sorted { ($0.name ?? $0.id).localizedCaseInsensitiveCompare($1.name ?? $1.id) == .orderedAscending }
    }
}
