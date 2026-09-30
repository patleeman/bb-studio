import Foundation

// MARK: Studio Artifacts

/// A file an agent or you saved from a thread into Studio, with every version kept.
public struct Artifact: Decodable, Identifiable, Hashable, Sendable {
    public var id: String
    public var title: String
    public var description: String
    public var projectId: String?
    public var sourceThreadId: String?
    public var sourcePath: String?
    public var createdAt: Double
    public var updatedAt: Double
    public var archived: Bool
    /// The newest version.
    public var version: ArtifactVersion
    /// How many versions there are.
    public var versions: Int

    public var displayTitle: String {
        let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return title.isEmpty ? version.name : title
    }

    /// App path that opens it in BB web, and that agents link to.
    public var href: String { "/plugins/artifacts/artifacts/\(id)" }

    /// `art_` and 16 lowercase letters or digits.
    public static func isId(_ value: String) -> Bool {
        value.wholeMatch(of: /art_[0-9a-z]{16}/) != nil
    }
}

public struct ArtifactVersion: Decodable, Identifiable, Hashable, Sendable {
    public var id: String
    public var number: Int
    /// The file name.
    public var name: String
    public var mime: String
    public var size: Int
    /// image, html, markdown, code, text, pdf or other.
    public var type: String
    public var createdAt: Double

    public var typeLabel: String {
        switch type {
        case "image": "Image"
        case "html": "HTML"
        case "markdown": "Markdown"
        case "code": "Code"
        case "text": "Text"
        case "pdf": "PDF"
        default: "File"
        }
    }

    public var symbol: String {
        switch type {
        case "image": "photo"
        case "html": "globe"
        case "markdown": "doc.richtext"
        case "code": "chevron.left.forwardslash.chevron.right"
        case "text": "doc.text"
        case "pdf": "doc.text.image"
        default: "doc"
        }
    }

    /// The server shows these as text.
    public var isText: Bool { ["markdown", "code", "text"].contains(type) }
}

extension BBClient {
    public func artifact(_ id: String) async throws -> (artifact: Artifact?, versions: [ArtifactVersion]) {
        struct Result: Decodable {
            var artifact: Artifact?
            var versions: [ArtifactVersion]
        }
        let result: Result = try await rpc("artifacts", "get", ["id": .string(id)])
        return (result.artifact, result.versions)
    }

    /// A version's text, cut off at 2 MB; nil for binary files.
    public func artifactText(_ id: String, versionId: String) async throws -> (text: String?, truncated: Bool) {
        struct Result: Decodable {
            var text: String?
            var truncated: Bool
        }
        let result: Result = try await rpc("artifacts", "text", ["id": .string(id), "versionId": .string(versionId)])
        return (result.text, result.truncated)
    }

    /// A version's bytes. Versions never change, so it caches forever.
    public func artifactContentURL(_ id: String, versionId: String, download: Bool = false) -> URL {
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        components.path = "/api/v1/plugins/artifacts/http/content"
        components.queryItems = [URLQueryItem(name: "artifact", value: id), URLQueryItem(name: "version", value: versionId)]
            + (download ? [URLQueryItem(name: "download", value: "1")] : [])
        return components.url!
    }

    public func renameArtifact(_ id: String, title: String) async throws {
        let _: JSONValue = try await rpc(
            "artifacts", "update", ["id": .string(id), "title": .string(String(title.prefix(200)))])
    }

    public func moveArtifact(_ id: String, projectId: String?) async throws {
        let _: JSONValue = try await rpc(
            "artifacts", "move", ["id": .string(id), "projectId": projectId.map { .string($0) } ?? .null])
    }

    public func deleteArtifact(_ id: String) async throws {
        let _: JSONValue = try await rpc("artifacts", "delete", ["id": .string(id)])
    }

    /// Copies a Markdown or text artifact into a new page; returns the page's app path.
    public func saveArtifactAsPage(_ id: String) async throws -> String {
        struct Result: Decodable { var href: String }
        let result: Result = try await rpc("artifacts", "saveAsPage", ["id": .string(id)])
        return result.href
    }

    /// Artifacts saved from a thread.
    public func threadArtifacts(_ threadId: String) async throws -> [Artifact] {
        struct Result: Decodable { var artifacts: [Artifact] }
        let result: Result = try await rpc("artifacts", "threadArtifacts", ["threadId": .string(threadId)])
        return result.artifacts
    }
}
