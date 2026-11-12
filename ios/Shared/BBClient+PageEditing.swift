import Foundation

extension BBClient {
    public func editablePageMarkdown(_ id: String) async throws -> String {
        struct Result: Decodable { var markdown: String }
        let result: Result = try await self.rpc("studio", Studio.Method.pages_editableMarkdown, ["id": .string(id)])
        return result.markdown
    }

    /// Saves the whole page as plain Markdown; returns the page with block ids as it now is.
    public func editPageDocument(_ id: String, expected: String, markdown: String) async throws -> String {
        struct Result: Decodable { var markdown: String }
        let input: JSONValue = ["id": .string(id), "expected": .string(expected), "markdown": .string(markdown)]
        let result: Result = try await self.rpc("studio", Studio.Method.pages_editDocument, input)
        return result.markdown
    }

    public func pageRequests(_ id: String) async throws -> [PageRequest] {
        struct Result: Decodable { var requests: [PageRequest] }
        let result: Result = try await self.rpc("studio", Studio.Method.pages_requests, ["pageId": .string(id)])
        return result.requests
    }
}
