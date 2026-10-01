import Foundation

extension BBClient {
    public func editablePageMarkdown(_ id: String) async throws -> String {
        struct Result: Decodable { var markdown: String }
        let result: Result = try await rpc("pages", "editableMarkdown", ["id": .string(id)])
        return result.markdown
    }

    public func editPageBlock(_ id: String, expected: String, block: String?, markdown: String) async throws -> String {
        struct Result: Decodable { var markdown: String }
        var input: [String: JSONValue] = [
            "id": .string(id), "expected": .string(expected), "markdown": .string(markdown)
        ]
        if let block { input["block"] = .string(block) }
        let result: Result = try await rpc("pages", "editBlock", .object(input))
        return result.markdown
    }

    public func pageRequests(_ id: String) async throws -> [PageRequest] {
        struct Result: Decodable { var requests: [PageRequest] }
        let result: Result = try await rpc("pages", "requests", ["pageId": .string(id)])
        return result.requests
    }
}
