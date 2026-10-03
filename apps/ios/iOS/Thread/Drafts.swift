import Foundation

/// Unsent text per thread, kept across leaving the thread and relaunching,
/// as BB web keeps drafts in the browser.
enum Drafts {
    struct Draft: Codable, Equatable {
        var text: String
        var mentions: [Mention]
    }

    private static let defaults = UserDefaults.standard

    static func load(_ threadId: String, serverURL: URL = ServerScope.selectedURL) -> Draft? {
        defaults.data(forKey: ServerScope.key("draft.\(threadId)", serverURL: serverURL)).flatMap { try? JSONDecoder().decode(Draft.self, from: $0) }
    }

    static func save(_ threadId: String, text: String, mentions: [Mention], serverURL: URL) {
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            defaults.removeObject(forKey: ServerScope.key("draft.\(threadId)", serverURL: serverURL))
        } else if let data = try? JSONEncoder().encode(Draft(text: text, mentions: mentions)) {
            defaults.set(data, forKey: ServerScope.key("draft.\(threadId)", serverURL: serverURL))
        }
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
