import Foundation

/// Unsent text per thread, kept across leaving the thread and relaunching,
/// as BB web keeps drafts in the browser.
enum Drafts {
    struct Draft: Codable, Equatable {
        var text: String
        var mentions: [Mention]
    }

    private static let defaults = UserDefaults.standard

    static func load(_ threadId: String) -> Draft? {
        defaults.data(forKey: key(threadId)).flatMap { try? JSONDecoder().decode(Draft.self, from: $0) }
    }

    static func save(_ threadId: String, text: String, mentions: [Mention]) {
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            defaults.removeObject(forKey: key(threadId))
        } else if let data = try? JSONEncoder().encode(Draft(text: text, mentions: mentions)) {
            defaults.set(data, forKey: key(threadId))
        }
    }

    private static func key(_ threadId: String) -> String { "draft.\(threadId)" }
}
