import Foundation

/// Storage shared by the app and its extensions (widgets, share sheet).
public enum AppGroup {
    public static let id = "group.nyc.plee.bbgo"

    public static let defaults = UserDefaults(suiteName: id) ?? .standard

    public static var containerURL: URL {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: id)
            ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    }
}

/// Last-known API responses on disk, so the app opens instantly and still
/// shows something when the tailnet is unreachable.
public enum DiskCache {
    private static var directory: URL { AppGroup.containerURL.appending(path: "Cache", directoryHint: .isDirectory) }

    private static func url(_ key: String) -> URL {
        directory.appending(path: key.replacingOccurrences(of: "/", with: "_") + ".json")
    }

    public static func save<T: Encodable>(_ value: T, as key: String) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? data.write(to: url(key), options: .atomic)
    }

    public static func load<T: Decodable>(_ type: T.Type, key: String) -> T? {
        guard let data = try? Data(contentsOf: url(key)) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }
}
