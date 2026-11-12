import Foundation

/// User-authored text is durable data, not a disposable server cache.
struct PageDraftStore {
    struct Draft: Codable, Equatable {
        var serverURL: URL
        var pageId: String
        var kind: String
        var text: String
        var expected: String?
        var submitted: String?
        var projectId: String?
    }

    var directory = AppGroup.containerURL.appending(path: "PageDrafts", directoryHint: .isDirectory)
    var write: (Data, URL) throws -> Void = { try $0.write(to: $1, options: .atomic) }

    func url(server: URL, page: String, kind: String = "edit") -> URL {
        let key = Data(page.utf8).base64EncodedString().replacingOccurrences(of: "/", with: "_")
        return directory.appending(path: ServerScope.namespace(server), directoryHint: .isDirectory)
            .appending(path: "\(kind)-\(key).json")
    }

    /// Names retain the page identity even if a draft file becomes unreadable.
    func pages(server: URL) -> [String] {
        let folder = directory.appending(path: ServerScope.namespace(server), directoryHint: .isDirectory)
        let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
        return Array(Set(files.compactMap { file -> String? in
            let name = file.deletingPathExtension().lastPathComponent
            guard file.pathExtension == "json", name.hasPrefix("edit-") || name.hasPrefix("work-") else { return nil }
            let encoded = String(name.dropFirst(5)).replacingOccurrences(of: "_", with: "/")
            guard let data = Data(base64Encoded: encoded) else { return nil }
            return String(data: data, encoding: .utf8)
        })).sorted()
    }

    func exists(server: URL, page: String, kind: String = "edit") -> Bool {
        FileManager.default.fileExists(atPath: url(server: server, page: page, kind: kind).path)
    }

    func load(server: URL, page: String, kind: String = "edit") throws -> Draft? {
        let file = url(server: server, page: page, kind: kind)
        guard FileManager.default.fileExists(atPath: file.path) else { return nil }
        let draft = try JSONDecoder().decode(Draft.self, from: Data(contentsOf: file))
        guard draft.serverURL == server, draft.pageId == page, draft.kind == kind else {
            throw CocoaError(.fileReadCorruptFile)
        }
        return draft
    }

    func save(_ draft: Draft) throws {
        let file = url(server: draft.serverURL, page: draft.pageId, kind: draft.kind)
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try write(JSONEncoder().encode(draft), file)
    }

    func remove(server: URL, page: String, kind: String = "edit") throws {
        let file = url(server: server, page: page, kind: kind)
        if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
    }
}
