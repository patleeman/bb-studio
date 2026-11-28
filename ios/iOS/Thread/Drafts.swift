import Foundation

/// Unsent text per thread, kept across leaving the thread and relaunching,
/// as BB web keeps drafts in the browser.
enum Drafts {
    struct Draft: Codable, Equatable {
        var text: String
        var mentions: [Mention]
    }

    private static let defaults = UserDefaults.standard

    #if DEBUG
    /// An offline demo launch (`-qaBotDemo`) starts with none: UI tests share
    /// the demo's server, and one test's draft would wait in the next's composer.
    /// `-qaKeepDrafts` keeps them, for a test that relaunches to find its draft.
    private static let demoFresh: Void = {
        let arguments = ProcessInfo.processInfo.arguments
        guard arguments.contains("-qaBotDemo"), !arguments.contains("-qaKeepDrafts") else { return }
        let prefix = ServerScope.key("draft.")
        for key in UserDefaults.standard.dictionaryRepresentation().keys where key.hasPrefix(prefix) {
            UserDefaults.standard.removeObject(forKey: key)
        }
    }()
    #endif

    static func load(_ threadId: String, serverURL: URL = ServerScope.selectedURL) -> Draft? {
        #if DEBUG
        _ = demoFresh
        #endif
        return defaults.data(forKey: ServerScope.key("draft.\(threadId)", serverURL: serverURL)).flatMap { try? JSONDecoder().decode(Draft.self, from: $0) }
    }

    static func save(_ threadId: String, text: String, mentions: [Mention], serverURL: URL) {
        #if DEBUG
        _ = demoFresh
        #endif
        let key = ServerScope.key("draft.\(threadId)", serverURL: serverURL)
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            if defaults.object(forKey: key) != nil { defaults.removeObject(forKey: key) }
        } else if let data = try? JSONEncoder().encode(Draft(text: text, mentions: mentions)),
                  defaults.data(forKey: key) != data {
            defaults.set(data, forKey: key)
        }
    }

    /// Keeps text whose send failed, unless the thread already has a newer draft.
    /// The thread may have closed while it was sending, and then the composer
    /// can't save it.
    static func restore(_ threadId: String, text: String, mentions: [Mention], serverURL: URL) {
        guard load(threadId, serverURL: serverURL) == nil else { return }
        save(threadId, text: text, mentions: mentions, serverURL: serverURL)
    }

    /// Legacy drafts have no trustworthy origin. Copy only after explicit recovery;
    /// keep the originals, and never overwrite a draft already on this server.
    static var legacyKeys: [String] {
        defaults.dictionaryRepresentation().keys.filter {
            ($0.hasPrefix("draft.") && defaults.data(forKey: $0) != nil)
                || ($0 == "quickWriteDraft" && !(defaults.string(forKey: $0) ?? "").isEmpty)
        }
    }
    static func recoverLegacy(to serverURL: URL) {
        for key in legacyKeys {
            let destination = ServerScope.key(key, serverURL: serverURL)
            if defaults.object(forKey: destination) == nil {
                defaults.set(defaults.object(forKey: key), forKey: destination)
            }
        }
    }
}
