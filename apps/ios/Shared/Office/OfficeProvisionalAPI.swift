import Foundation

// office_start is the only office RPC still awaiting its server contract.
extension BBClient {
    private func pendingOfficeRPC<T: Decodable>(_ method: String, _ input: JSONValue) async throws -> T {
        try await rpc("studio", method, input)
    }

    public func officeStart(spaceId: String, request: String) async throws -> OfficeStartResult {
        try await pendingOfficeRPC("office_start", ["spaceId": .string(spaceId), "request": .string(request)])
    }
}

/// Provisional office_start result from the web OfficeHome composer.
public struct OfficeStartResult: Codable, Sendable {
    public var threadId: String?
    public var taskId: String?
    public var botId: String?
}
