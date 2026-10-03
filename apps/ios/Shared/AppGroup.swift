import Foundation
import CryptoKit

/// Storage shared by the app and its extensions (widgets, share sheet).
public enum AppGroup {
    public static let id = "group.nyc.plee.bbgo"

    public static let defaults = UserDefaults(suiteName: id) ?? .standard

    public static var containerURL: URL {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: id)
            ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    }
}

/// The app's own links. `bbstudio://` is from before the rename to BB Studio and still opens.
public enum AppLink {
    public static let scheme = "bbstudio"

    public static func scoped(_ url: URL, serverURL: URL) -> URL {
        var parts = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        parts.queryItems = (parts.queryItems ?? []) + [URLQueryItem(name: "server", value: ServerScope.namespace(serverURL))]
        return parts.url!
    }
    public static func acceptsOrigin(_ url: URL, serverURL: URL = ServerScope.selectedURL) -> Bool {
        guard let origin = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "server" })?.value else { return true }
        return origin == ServerScope.namespace(serverURL)
    }
    public static func handles(_ url: URL) -> Bool { ["bbstudio", "bbgo"].contains(url.scheme ?? "") }
}

/// URL identity is available offline and shared by every process. Never migrate
/// unknown-origin derived data into this namespace.
public enum ServerScope {
    public static let defaultURL = URL(string: "https://patricks-megamac.tail5a01ec.ts.net")!
    public static var selectedURL: URL {
        (AppGroup.defaults.string(forKey: "serverURL") ?? UserDefaults.standard.string(forKey: "serverURL"))
            .flatMap(URL.init(string:)) ?? defaultURL
    }
    public static func namespace(_ serverURL: URL) -> String {
        SHA256.hash(data: Data(serverURL.absoluteString.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    public static func key(_ name: String, serverURL: URL = selectedURL) -> String {
        "server.\(namespace(serverURL)).\(name)"
    }
}

/// Last-known API responses. Callers must bind writes to the request's origin.
public enum DiskCache {
    private static var directory: URL { AppGroup.containerURL.appending(path: "Cache", directoryHint: .isDirectory) }
    private static func url(_ key: String, serverURL: URL?) -> URL {
        let folder = serverURL.map { directory.appending(path: ServerScope.namespace($0), directoryHint: .isDirectory) } ?? directory
        return folder.appending(path: key.replacingOccurrences(of: "/", with: "_") + ".json")
    }
    public static func save<T: Encodable>(_ value: T, as key: String, serverURL: URL) {
        write(value, to: url(key, serverURL: serverURL))
    }
    public static func load<T: Decodable>(_ type: T.Type, key: String, serverURL: URL = ServerScope.selectedURL) -> T? {
        read(type, from: url(key, serverURL: serverURL))
    }
    // Durable outboxes contain their own per-item origins; preserve the legacy file.
    public static func saveUnscoped<T: Encodable>(_ value: T, as key: String) { write(value, to: url(key, serverURL: nil)) }
    public static func loadUnscoped<T: Decodable>(_ type: T.Type, key: String) -> T? { read(type, from: url(key, serverURL: nil)) }
    private static func write<T: Encodable>(_ value: T, to url: URL) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: url, options: .atomic)
    }
    private static func read<T: Decodable>(_ type: T.Type, from url: URL) -> T? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }
}
