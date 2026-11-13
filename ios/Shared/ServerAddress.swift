import Foundation

/// The BB Studio server's address as typed: a full URL, or a bare host such as
/// BB Studio's Tailscale Serve name (`studio.tailnet.ts.net`), which gets
/// `https://`. A trailing slash, query or fragment is dropped; a path stays (a
/// server behind a prefix).
public enum ServerAddress {
    public static func parse(_ text: String) -> URL? {
        var text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !text.contains(" ") else { return nil }
        if !text.contains("://") { text = "https://" + text }
        guard var parts = URLComponents(string: text), let scheme = parts.scheme?.lowercased(), ["http", "https"].contains(scheme),
              let host = parts.host, !host.isEmpty
        else { return nil }
        parts.scheme = scheme
        parts.host = host.lowercased()
        parts.query = nil
        parts.fragment = nil
        while parts.path.hasSuffix("/") { parts.path.removeLast() }
        return parts.url
    }

    /// Whether a BB server answers there: its thread list, which every BB has.
    public static func check(_ url: URL) async -> String? {
        do {
            _ = try await BBClient(baseURL: url).threads(limit: 1)
            return nil
        } catch {
            return BBClient.describe(error, server: url)
        }
    }
}
