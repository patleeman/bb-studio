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
    /// image, audio, video, html, markdown, code, text, pdf or other.
    public var type: String
    public var createdAt: Double

    public var typeLabel: String {
        switch type {
        case "image": "Image"
        case "audio": "Audio"
        case "video": "Video"
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
        case "audio": "waveform"
        case "video": "film"
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

/// Artifacts are built into Studio. For one release, a Studio from before the
/// merge (no `artifacts.*` methods) falls back to the Artifacts plugin, whose
/// last release forwards to Studio anyway.
nonisolated(unsafe) private var artifactsInStudio = true

extension BBClient {
    /// Studio first; the Artifacts plugin only when Studio doesn't have the method.
    func viaStudio<T>(_ studio: () async throws -> T, else legacy: () async throws -> T) async throws -> T {
        do {
            let result = try await studio()
            artifactsInStudio = true
            return result
        } catch where Self.isMissingRPC(error) {
            artifactsInStudio = false
            return try await legacy()
        }
    }

    public func artifact(_ id: String) async throws -> (artifact: Artifact?, versions: [ArtifactVersion]) {
        struct Result: Decodable {
            var artifact: Artifact?
            var versions: [ArtifactVersion]
        }
        let input: JSONValue = ["id": .string(id)]
        let result: Result = try await viaStudio({ try await self.rpc("studio", Studio.Method.artifacts_get, input) }, else: { try await self.rpc("artifacts", "get", input) })
        return (result.artifact, result.versions)
    }

    /// A version's text, cut off at 2 MB; nil for binary files.
    public func artifactText(_ id: String, versionId: String) async throws -> (text: String?, truncated: Bool) {
        struct Result: Decodable {
            var text: String?
            var truncated: Bool
        }
        let input: JSONValue = ["id": .string(id), "versionId": .string(versionId)]
        let result: Result = try await viaStudio({ try await self.rpc("studio", Studio.Method.artifacts_text, input) }, else: { try await self.rpc("artifacts", "text", input) })
        return (result.text, result.truncated)
    }

    /// A version's bytes. Versions never change, so it caches forever.
    public func artifactContentURL(_ id: String, versionId: String, download: Bool = false) -> URL {
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        // Studio serves artifacts; a Studio from before the merge doesn't, and the old plugin does.
        components.path = artifactsInStudio ? "/api/v1/plugins/studio/http/artifacts/content" : "/api/v1/plugins/artifacts/http/content"
        components.queryItems = [URLQueryItem(name: "artifact", value: id), URLQueryItem(name: "version", value: versionId)]
            + (download ? [URLQueryItem(name: "download", value: "1")] : [])
        return components.url!
    }

    public func renameArtifact(_ id: String, title: String) async throws {
        let input: JSONValue = ["id": .string(id), "title": .string(String(title.prefix(200)))]
        let _: JSONValue = try await viaStudio({ try await self.rpc("studio", Studio.Method.artifacts_update, input) }, else: { try await self.rpc("artifacts", "update", input) })
    }

    public func moveArtifact(_ id: String, projectId: String?) async throws {
        let input: JSONValue = ["id": .string(id), "projectId": projectId.map { .string($0) } ?? .null]
        let _: JSONValue = try await viaStudio({ try await self.rpc("studio", Studio.Method.artifacts_move, input) }, else: { try await self.rpc("artifacts", "move", input) })
    }

    public func deleteArtifact(_ id: String) async throws {
        let input: JSONValue = ["id": .string(id)]
        let _: JSONValue = try await viaStudio({ try await self.rpc("studio", Studio.Method.artifacts_delete, input) }, else: { try await self.rpc("artifacts", "delete", input) })
    }

    /// Copies a Markdown or text artifact into a new page; returns the page's app path.
    public func saveArtifactAsPage(_ id: String) async throws -> String {
        struct Result: Decodable { var href: String }
        let input: JSONValue = ["id": .string(id)]
        let result: Result = try await viaStudio({ try await self.rpc("studio", Studio.Method.artifacts_saveAsPage, input) }, else: { try await self.rpc("artifacts", "saveAsPage", input) })
        return result.href
    }

    /// Artifacts saved from a thread.
    public func threadArtifacts(_ threadId: String) async throws -> [Artifact] {
        struct Result: Decodable { var artifacts: [Artifact] }
        let input: JSONValue = ["threadId": .string(threadId)]
        let result: Result = try await viaStudio({ try await self.rpc("studio", Studio.Method.artifacts_threadArtifacts, input) }, else: { try await self.rpc("artifacts", "threadArtifacts", input) })
        return result.artifacts
    }

    /// Files a reply produced (the reply ending at `seq`, or the latest one) and the thread's storage files.
    public func artifactCandidates(threadId: String, seq: Int?) async throws -> ArtifactCandidates {
        let input: JSONValue = ["threadId": .string(threadId), "seq": seq.map { .number(Double($0)) } ?? .null]
        return try await viaStudio({ try await self.rpc("studio", Studio.Method.artifacts_candidates, input) }, else: { try await self.rpc("artifacts", "candidates", input) })
    }

    /// Saves files into Studio; a file saved before gets a new version.
    public func saveFilesToStudio(threadId: String, paths: [String]) async throws -> SavedFiles {
        let input: JSONValue = ["threadId": .string(threadId), "paths": .array(paths.prefix(50).map { .string($0) })]
        return try await viaStudio({ try await self.rpc("studio", Studio.Method.artifacts_saveFiles, input) }, else: { try await self.rpc("artifacts", "saveFiles", input) })
    }
}

public struct ArtifactCandidates: Decodable, Sendable {
    public struct File: Decodable, Identifiable, Hashable, Sendable {
        public var path: String
        public var display: String
        /// image, created, changed or storage.
        public var kind: String
        /// Set when it is already in Studio.
        public var artifactId: String?
        public var id: String { path }

        public var symbol: String {
            switch kind {
            case "image": "photo"
            case "created": "doc.badge.plus"
            case "changed": "pencil.line"
            default: "tray.full"
            }
        }
    }

    public var reply: [File]
    public var storage: [File]
    /// Why thread storage couldn't be listed, e.g. its machine is offline.
    public var storageError: String?
}

public struct SavedFiles: Decodable, Sendable {
    public struct Saved: Decodable, Sendable {
        public var path: String
        public var artifactId: String
        /// created, versioned or unchanged.
        public var outcome: String
    }
    public struct Failed: Decodable, Sendable {
        public var path: String
        public var error: String
    }
    public var saved: [Saved]
    public var failed: [Failed]
}
