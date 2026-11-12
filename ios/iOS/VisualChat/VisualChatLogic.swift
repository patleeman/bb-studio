import CryptoKit
import Foundation
import UIKit

/// Visual Chat (the `studio-visual-chat` plugin) on the phone: the logic the
/// board screen runs on, with no views, so it can be tested. The board itself
/// is drawn by the plugin's own renderer (`canvas.renderer`), the same code
/// the desktop page uses, in a web view (VisualChatBoard.swift).
enum VisualChatPlugin {
    static let id = "studio-visual-chat"
    /// The realtime channel the plugin publishes board updates and the page being written on.
    static let channel = "studio-visual-chat"
    static let updated = "canvas:updated"
    static let stream = "canvas:stream"
    /// The renderer protocol this app speaks (renderer.ts RENDERER_PROTOCOL).
    static let rendererProtocol = 1
}

// MARK: The bridge

/// A message from the board's host page, through `webkit.messageHandlers.visualChat`.
/// Only the top document's messages count, and only these shapes: anything
/// else (another key, a wrong type, a URL that isn't https) is dropped.
enum VisualChatBridgeMessage: Equatable {
    /// The renderer is in and the page frame loaded.
    case ready(protocol: Int)
    /// Open a URL in full (a webpage part's Open), in Safari's view.
    case open(URL)
    /// Check a webpage part's URL with the server (canvas.webpage); answer with the same id.
    case webpage(id: Int, url: String)
    /// What the frame shows now, after a post.
    case rendered(rev: Int, streamN: Int, streaming: Bool, embeds: Int)

    static let handlerName = "visualChat"
    static let maxBytes = 8 * 1024
    static let maxURL = 2000

    /// Parses a message body: a JSON string the host page made with JSON.stringify.
    static func parse(_ body: Any) -> VisualChatBridgeMessage? {
        guard let text = body as? String, text.utf8.count <= maxBytes,
              let object = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
              let type = object["type"] as? String
        else { return nil }
        func only(_ keys: Set<String>) -> Bool { Set(object.keys) == keys.union(["type"]) }
        switch type {
        case "ready":
            guard only(["protocol"]), let version = int(object["protocol"]) else { return nil }
            return .ready(protocol: version)
        case "open":
            guard only(["url"]), let url = httpsURL(object["url"]) else { return nil }
            return .open(url)
        case "webpage":
            guard only(["id", "url"]), let id = int(object["id"]), (1...1_000_000_000).contains(id),
                  let url = httpsURL(object["url"]) else { return nil }
            return .webpage(id: id, url: url.absoluteString)
        case "rendered":
            guard only(["rev", "streamN", "streaming", "embeds"]), let rev = int(object["rev"]), let streamN = int(object["streamN"]),
                  let streaming = bool(object["streaming"]), let embeds = int(object["embeds"]) else { return nil }
            return .rendered(rev: rev, streamN: streamN, streaming: streaming, embeds: embeds)
        default:
            return nil
        }
    }

    /// A whole, non-negative number (JSON numbers arrive as NSNumber; a Bool is not one).
    private static func int(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        let double = number.doubleValue
        guard double.isFinite, double >= 0, double <= 1e12, double.rounded() == double else { return nil }
        return Int(double)
    }

    private static func bool(_ value: Any?) -> Bool? {
        guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }
        return number.boolValue
    }

    /// An https URL with a host, no credentials, at most 2,000 characters.
    static func httpsURL(_ value: Any?) -> URL? {
        guard let text = value as? String, !text.isEmpty, text.count <= maxURL,
              let components = URLComponents(string: text), components.scheme?.lowercased() == "https",
              let host = components.host, !host.isEmpty, components.user == nil, components.password == nil,
              let url = components.url
        else { return nil }
        return url
    }
}

// MARK: Versions

/// Paging through a chat's versions, as the desktop page does (route.tsx
/// timelinePositions): each finished turn is a version, and while a turn
/// works the live board is one more position after the last.
struct VisualChatTimeline: Equatable {
    struct Version: Equatable {
        var n: Int
        var rev: Int
        var prompt: String?
        var caption: String?
    }

    var versions: [Version]
    var liveRev: Int
    var working: Bool
    /// The version the user picked (nil: the live board).
    var viewing: Int?

    private var liveExtra: Bool {
        guard let last = versions.last else { return true }
        return working && last.rev != liveRev
    }

    var total: Int { versions.count + (liveExtra ? 1 : 0) }

    /// 1-based; `total` is the live board.
    var position: Int {
        guard let viewing, let at = versions.firstIndex(where: { $0.n == viewing }), at < total - 1 else { return total }
        return at + 1
    }

    /// The version shown, or nil for the live board.
    var shown: Int? { position < total ? viewing : nil }

    /// Where a position points: a version's n, or nil for the live board.
    func target(_ position: Int) -> Int? {
        position >= total ? nil : versions.indices.contains(position - 1) ? versions[position - 1].n : nil
    }

    var canGoBack: Bool { position > 1 }
    var canGoForward: Bool { position < total }

    /// The version a step back or forward lands on (nil: the live board), or
    /// `.none` when there's nowhere to go.
    func step(_ delta: Int) -> Int?? {
        let next = position + delta
        guard next >= 1, next <= total else { return .none }
        return .some(target(next))
    }

    /// "2 of 3" for the chat line; nil with one position.
    var label: String? { total > 1 ? "\(position) of \(total)" : nil }
}

// MARK: The page being written

/// The page the agent is writing, as the realtime channel sends it (use-canvas.ts):
/// the html so far, kept until the board has the finished page's revision.
struct VisualChatStream: Equatable {
    var html: String
    var n: Int
    var until: Int?
    var ended: Bool

    /// One `canvas:stream` signal for this chat, on what's showing now.
    static func reduce(_ now: VisualChatStream?, signal payload: JSONValue) -> VisualChatStream? {
        let n = payload["n"]?.vcInt ?? 0
        if payload["done"]?.vcBool == true {
            guard var now, let rev = payload["rev"]?.vcInt else { return nil }
            now.until = rev
            now.ended = true
            return now
        }
        guard let html = payload["html"]?.stringValue else { return now }
        if let now, now.n > n, !now.ended { return now }
        return VisualChatStream(html: html, n: n, until: nil, ended: false)
    }

    /// The stream gives way once the board has the finished page, or the turn is over.
    static func settle(_ stream: VisualChatStream?, rev: Int, working: Bool) -> VisualChatStream? {
        guard let stream else { return nil }
        if stream.ended ? (stream.until.map { rev >= $0 } ?? false) : !working { return nil }
        return stream
    }
}

// MARK: The renderer, kept by version

/// The board renderer's script (`canvas.renderer`), kept on disk per server
/// by its version, so a board opens without downloading it again and works
/// from the last copy when the server can't send one.
struct VisualChatRenderer: Codable, Equatable {
    var version: String
    var js: String

    /// The version is the first 16 hex of the script's SHA-256 (src/renderer.ts), so a copy is checked before it's used.
    static func version(of js: String) -> String {
        SHA256.hash(data: Data(js.utf8)).prefix(8).map { String(format: "%02x", $0) }.joined()
    }

    var isIntact: Bool { Self.version(of: js) == version }
}

struct VisualChatRendererCache {
    let directory: URL

    static var standard: VisualChatRendererCache {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first ?? FileManager.default.temporaryDirectory
        return VisualChatRendererCache(directory: caches.appending(path: "VisualChatRenderer", directoryHint: .isDirectory))
    }

    private func file(_ server: URL) -> URL {
        directory.appending(path: ServerScope.namespace(server) + ".json")
    }

    func load(server: URL) -> VisualChatRenderer? {
        guard let data = try? Data(contentsOf: file(server)),
              let renderer = try? JSONDecoder().decode(VisualChatRenderer.self, from: data), renderer.isIntact
        else { return nil }
        return renderer
    }

    func save(_ renderer: VisualChatRenderer, server: URL) {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        guard let data = try? JSONEncoder().encode(renderer) else { return }
        try? data.write(to: file(server), options: .atomic)
    }

    /// The current renderer: the kept copy when the server says it's still current (no download), the server's
    /// new one otherwise (kept for next time), or the kept copy when the server can't be reached.
    /// `fetch(version)` is `canvas.renderer` with the version the app has: it answers the current version, and
    /// the script only when that isn't the one the app has.
    func resolve(server: URL, fetch: (String?) async throws -> (version: String, js: String?)) async throws -> VisualChatRenderer {
        let kept = load(server: server)
        do {
            let answer = try await fetch(kept?.version)
            if let js = answer.js {
                let renderer = VisualChatRenderer(version: answer.version, js: js)
                guard renderer.isIntact else { throw VisualChatError("The board renderer arrived damaged.") }
                save(renderer, server: server)
                return renderer
            }
            if let kept, kept.version == answer.version { return kept }
            // Told it's current but nothing is kept: ask for the script itself.
            let full = try await fetch(nil)
            guard let js = full.js else { throw VisualChatError("The server sent no board renderer.") }
            let renderer = VisualChatRenderer(version: full.version, js: js)
            guard renderer.isIntact else { throw VisualChatError("The board renderer arrived damaged.") }
            save(renderer, server: server)
            return renderer
        } catch {
            if let kept { return kept }
            throw error
        }
    }
}

struct VisualChatError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

// MARK: The client hint

/// The screen the user is on, for the agent (canvas.create and canvas.send `client`).
struct VisualChatClient: Equatable {
    enum Kind: String { case phone, duoFolded = "duo-folded", duoUnfolded = "duo-unfolded", desktop }
    var kind: Kind
    var width: Int
    var height: Int

    /// The folded Duo's outer screen, either way up.
    static func isDuoFolded(_ screen: CGSize) -> Bool {
        let small = min(screen.width, screen.height), large = max(screen.width, screen.height)
        return abs(small - 466) < 1 && abs(large - 678) < 1
    }

    /// From the screen (which device and how it's folded) and the board's size in points.
    static func of(screen: CGSize, phone: Bool, board: CGSize) -> VisualChatClient {
        let kind: Kind = DuoLayout.isInnerScreen(screen, phone: phone) ? .duoUnfolded
            : phone && isDuoFolded(screen) ? .duoFolded : phone ? .phone : .desktop
        let clamp = { (value: CGFloat) in Int(min(10000, max(200, value.rounded()))) }
        return VisualChatClient(kind: kind, width: clamp(board.width), height: clamp(board.height))
    }

    var json: JSONValue { ["kind": .string(kind.rawValue), "width": .number(Double(width)), "height": .number(Double(height))] }
}

// MARK: The theme

/// iOS's light and dark, as the renderer's theme inputs (renderer.ts themeFrom):
/// BB's color slots filled from the system colors, opaque, and the system fonts.
enum VisualChatTheme {
    static func raw(_ traits: UITraitCollection) -> JSONValue {
        let ground = UIColor.systemBackground.resolvedColor(with: traits)
        func hex(_ color: UIColor) -> JSONValue { .string(Self.hex(color.resolvedColor(with: traits), over: ground)) }
        let accent = UIColor(named: "AccentColor") ?? .systemBlue
        let colors: JSONValue = [
            "background": hex(.systemBackground), "foreground": hex(.label),
            "card": hex(.secondarySystemBackground), "cardForeground": hex(.label),
            "popover": hex(.systemBackground), "popoverForeground": hex(.label),
            "primary": hex(accent), "primaryForeground": hex(.white),
            "muted": hex(.tertiarySystemBackground), "mutedForeground": hex(.secondaryLabel),
            "accent": hex(.systemGray5), "border": hex(.opaqueSeparator),
            "destructive": hex(.systemRed), "success": hex(.systemGreen), "warning": hex(.systemOrange),
        ]
        return [
            "colors": colors,
            "fonts": [
                "sans": "-apple-system, system-ui, \"Helvetica Neue\", sans-serif",
                "serif": "ui-serif, \"New York\", Georgia, serif",
                "mono": "ui-monospace, Menlo, monospace",
            ],
            "radius": 10,
        ]
    }

    static func mode(_ traits: UITraitCollection) -> String { traits.userInterfaceStyle == .dark ? "dark" : "light" }

    /// #rrggbb, with any transparency laid over the ground (the renderer reads opaque colors).
    static func hex(_ color: UIColor, over ground: UIColor) -> String {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        var gr: CGFloat = 1, gg: CGFloat = 1, gb: CGFloat = 1, ga: CGFloat = 1
        guard color.getRed(&r, green: &g, blue: &b, alpha: &a) else { return "#808080" }
        _ = ground.getRed(&gr, green: &gg, blue: &gb, alpha: &ga)
        let mix = { (c: CGFloat, under: CGFloat) in min(1, max(0, c * a + under * (1 - a))) }
        let bytes = [mix(r, gr), mix(g, gg), mix(b, gb)].map { Int(($0 * 255).rounded()) }
        return String(format: "#%02x%02x%02x", bytes[0], bytes[1], bytes[2])
    }
}

extension JSONValue {
    /// A whole number, for the realtime payloads Visual Chat reads.
    var vcInt: Int? {
        guard case .number(let value) = self, value.isFinite, value.rounded() == value, abs(value) < 1e15 else { return nil }
        return Int(value)
    }

    var vcBool: Bool? {
        if case .bool(let value) = self { return value }
        return nil
    }
}
