import UIKit

/// Photos and files waiting in a thread's composer, kept with its draft
/// text (`Drafts`) across leaving the thread and relaunching. Each thread's
/// are files in its own folder, with a list of their names and types.
enum DraftAttachments {
    private struct Entry: Codable, Equatable {
        var id: UUID
        var name: String
        var mimeType: String
    }

    private static let root = URL.applicationSupportDirectory.appending(path: "DraftAttachments", directoryHint: .isDirectory)

    private static func folder(_ threadId: String, serverURL: URL) -> URL {
        root.appending(path: ServerScope.namespace(serverURL), directoryHint: .isDirectory)
            .appending(path: threadId.replacingOccurrences(of: "/", with: "_"), directoryHint: .isDirectory)
    }

    static func load(_ threadId: String, serverURL: URL) -> [PendingAttachment] {
        let folder = folder(threadId, serverURL: serverURL)
        guard let data = try? Data(contentsOf: folder.appending(path: "list.json")),
              let entries = try? JSONDecoder().decode([Entry].self, from: data) else { return [] }
        return entries.compactMap { entry in
            guard let file = try? Data(contentsOf: folder.appending(path: entry.id.uuidString)) else { return nil }
            return PendingAttachment(id: entry.id, data: file, name: entry.name, mimeType: entry.mimeType,
                thumbnail: entry.mimeType.hasPrefix("image/") ? UIImage(data: file) : nil)
        }
    }

    /// Writes only files it doesn't have yet, and removes the ones gone from the composer.
    static func save(_ items: [PendingAttachment], threadId: String, serverURL: URL) {
        let folder = folder(threadId, serverURL: serverURL)
        let manager = FileManager.default
        guard !items.isEmpty else {
            try? manager.removeItem(at: folder)
            return
        }
        do {
            try manager.createDirectory(at: folder, withIntermediateDirectories: true)
            for item in items {
                let file = folder.appending(path: item.id.uuidString)
                if !manager.fileExists(atPath: file.path) { try item.data.write(to: file, options: .atomic) }
            }
            let entries = items.map { Entry(id: $0.id, name: $0.name, mimeType: $0.mimeType) }
            try JSONEncoder().encode(entries).write(to: folder.appending(path: "list.json"), options: .atomic)
            let kept = Set(entries.map(\.id.uuidString) + ["list.json"])
            for name in (try? manager.contentsOfDirectory(atPath: folder.path)) ?? [] where !kept.contains(name) {
                try? manager.removeItem(at: folder.appending(path: name))
            }
        } catch {}
    }

    /// Keeps files whose send failed, unless the thread already has others
    /// waiting. As with `Drafts.restore`, the thread may have closed meanwhile.
    static func restore(_ items: [PendingAttachment], threadId: String, serverURL: URL) {
        guard !items.isEmpty, load(threadId, serverURL: serverURL).isEmpty else { return }
        save(items, threadId: threadId, serverURL: serverURL)
    }
}
