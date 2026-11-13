import CryptoKit
import Foundation

/// Where the app writes each Bot's presence stills for its widgets and Live
/// Activity: `Look/presence/<hash of Bot id>/<state>.png` in the app group.
/// The app renders them (`PresenceStills.exportForWidgets`); extensions only read.
public enum PresenceStillFiles {
    public static func digest(_ text: String) -> String {
        SHA256.hash(data: Data(text.utf8)).prefix(12).map { String(format: "%02x", $0) }.joined()
    }

    public static func folder(botId: String) -> URL {
        AppGroup.containerURL.appending(path: "Look/presence/\(digest(botId))", directoryHint: .isDirectory)
    }

    /// The still for a state, if the app has written one.
    public static func url(botId: String, state: BotPresenceState) -> URL? {
        let url = folder(botId: botId).appending(path: state.rawValue + ".png")
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    public static func data(botId: String, state: BotPresenceState) -> Data? {
        url(botId: botId, state: state).flatMap { try? Data(contentsOf: $0) }
    }
}
