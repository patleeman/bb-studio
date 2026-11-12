import Foundation

/// The watch cannot reach the tailnet itself, so it hands each HTTP request to
/// the phone over WatchConnectivity and the phone performs it with `BBClient.raw`.
public enum WatchRelay {
    public static let method = "method"
    public static let path = "path"
    public static let body = "body"
    public static let status = "status"
    public static let error = "error"

    /// WatchConnectivity messages are capped at about 64 KB, so bodies travel zlib-compressed.
    public static func pack(_ data: Data) -> Data {
        (try? (data as NSData).compressed(using: .zlib) as Data) ?? data
    }

    public static func unpack(_ data: Data) -> Data {
        (try? (data as NSData).decompressed(using: .zlib) as Data) ?? data
    }
}
