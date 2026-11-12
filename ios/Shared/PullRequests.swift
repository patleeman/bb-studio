import Foundation

public struct WorkspacePullRequest: Decodable, Sendable {
    public var number: Int
    public var title: String
    public var state: String
    public var url: URL
    public var baseRefName: String
    public var headRefName: String
}

extension BBClient {
    public func workspacePullRequest(_ environmentId: String) async throws -> WorkspacePullRequest? {
        struct Response: Decodable {
            var outcome: String
            var pullRequest: WorkspacePullRequest?
        }
        let response: Response = try await get("/api/v1/environments/\(environmentId)/pull-request")
        return response.outcome == "available" ? response.pullRequest : nil
    }
}
