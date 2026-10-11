import Foundation

extension BBClient {
    public func createDrawing(name: String = "", projectId: String? = nil) async throws -> DrawingSummary {
        struct Result: Decodable { var drawing: DrawingSummary }
        let input: JSONValue = [
            "name": .string(name),
            "projectId": projectId.map(JSONValue.string) ?? .null
        ]
        let result: Result = try await self.rpc("studio", Studio.Method.drawings_createDrawing, input)
        return result.drawing
    }

    public func webURL(forDrawing id: String) -> URL {
        // Drawings are built into Studio.
        URL(string: "/plugins/studio/studio/drawings/\(id)", relativeTo: baseURL)!.absoluteURL
    }
}
