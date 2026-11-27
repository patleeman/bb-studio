import Foundation

// Studio Design: UI prototypes an agent writes as HTML screens, in rounds of
// options ("1a", "1b", then "2a" …). The phone shows each screen live.
// Designs are built into Studio (`designs.*`).

public typealias StudioDesign = Studio.DesignsGetDesignOutputDesign
public typealias DesignScreen = Studio.DesignsGetDesignOutputDesignRoundsItemScreensItem

extension StudioDesign {
    public var displayName: String {
        let trimmed = (name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "Untitled design" : trimmed
    }

    /// Every screen, newest round first, as the web canvas stacks them.
    public var screens: [DesignScreen] { (rounds ?? []).flatMap { $0.screens ?? [] } }
}

/// A comment on a design, open or resolved, with its pin's number: pins
/// count in the order comments were made, as on the desktop canvas.
public struct DesignComment: Identifiable, Hashable, Sendable {
    public var id: String
    public var screenId: String
    public var step: String
    public var selector: String
    public var elementText: String
    public var body: String
    public var createdAt: Double
    public var sent: Bool
    public var resolved: Bool
    public var number: Int
}

extension StudioDesign {
    /// Every comment, open and resolved, numbered by when it was made.
    public var allComments: [DesignComment] {
        let open = (comments ?? []).map {
            DesignComment(id: $0.id ?? "", screenId: $0.screenId ?? "", step: $0.step ?? "", selector: $0.selector ?? "",
                          elementText: $0.elementText ?? "", body: $0.body ?? "", createdAt: $0.createdAt ?? 0,
                          sent: $0.sent == true, resolved: false, number: 0)
        }
        let resolved = (resolvedComments ?? []).map {
            DesignComment(id: $0.id ?? "", screenId: $0.screenId ?? "", step: $0.step ?? "", selector: $0.selector ?? "",
                          elementText: $0.elementText ?? "", body: $0.body ?? "", createdAt: $0.createdAt ?? 0,
                          sent: $0.sent == true, resolved: true, number: 0)
        }
        return (open + resolved).sorted { ($0.createdAt, $0.id) < ($1.createdAt, $1.id) }.enumerated().map { index, comment in
            var numbered = comment
            numbered.number = index + 1
            return numbered
        }
    }

    /// The round a screen is in, newest first like `rounds`.
    public func round(of screenId: String) -> Studio.DesignsGetDesignOutputDesignRoundsItem? {
        rounds?.first { $0.screens?.contains { $0.id == screenId } == true }
    }

    public func screen(_ id: String) -> DesignScreen? { screens.first { $0.id == id } }
}

/// Studio's `VIEWPORTS` presets (packages/bb-studio/src/design/shared.ts).
let designViewports: [String: (width: Double, height: Double)] = [
    "desktop": (1280, 800), "tablet": (834, 1112), "mobile": (390, 844),
    "slide": (1920, 1080), "square": (1080, 1080), "story": (1080, 1920),
    "a4": (794, 1123), "letter": (816, 1056), "email": (600, 900),
]

/// A frame's size from its viewport: a preset name, or a custom "WIDTHxHEIGHT"
/// with sides from 200 to 4000. Anything else is desktop, as on the web.
func designFrameSize(_ viewport: String?) -> (width: Double, height: Double) {
    let text = (viewport ?? "").trimmingCharacters(in: .whitespaces).lowercased().replacingOccurrences(of: "×", with: "x")
    if let preset = designViewports[text] { return preset }
    let sides = text.split(separator: "x").compactMap { Double($0) }
    if sides.count == 2, sides.allSatisfy({ (200...4000).contains($0) }) { return (sides[0], sides[1]) }
    return designViewports["desktop"]!
}

extension DesignScreen {
    /// The width and height the screen was written for.
    public var size: (width: Double, height: Double) {
        designFrameSize(viewport)
    }
}

/// An element the design screen script picked: the anchor of a comment.
public struct DesignPick: Hashable, Sendable {
    public var selector: String
    public var html: String
    public var text: String
    public var rect: CGRect

    public init(selector: String, html: String, text: String, rect: CGRect) {
        self.selector = selector
        self.html = html
        self.text = text
        self.rect = rect
    }
}

extension BBClient {
    public func design(_ id: String) async throws -> StudioDesign? {
        let input: JSONValue = ["id": .string(id)]
        let result: Studio.DesignsGetDesignOutput = try await self.rpc("studio", Studio.Method.designs_getDesign, input)
        return result.design
    }

    /// One screen's HTML, sandboxed by Studio, at the address Studio gives it: that
    /// changes with each revision and each canvas-script version, so a cached copy never goes stale.
    public func designScreenURL(_ designId: String, _ screen: DesignScreen, step: String? = nil) -> URL {
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        if let url = screen.url, let given = URLComponents(string: url), given.path.hasPrefix("/api/v1/plugins/studio/http/designs/") {
            components.path = given.path
            components.percentEncodedQuery = given.percentEncodedQuery
        } else {
            components.path = "/api/v1/plugins/studio/http/designs/screen"
            components.queryItems = [
                URLQueryItem(name: "design", value: designId),
                URLQueryItem(name: "screen", value: screen.id ?? ""),
                URLQueryItem(name: "v", value: String(Int(screen.updatedAt ?? 0))),
            ]
        }
        if let step, !step.isEmpty { components.fragment = step }
        return components.url!
    }

    public func renameDesign(_ id: String, name: String) async throws {
        let _: JSONValue = try await rpc("studio", Studio.Method.designs_renameDesign, ["id": .string(id), "name": .string(name)])
    }

    /// Resolving moves the comment to Resolved, as on desktop; `false` reopens it.
    public func resolveDesignComment(_ id: String, resolved: Bool = true) async throws {
        let _: JSONValue = try await rpc("studio", Studio.Method.designs_resolveComment, ["id": .string(id), "resolved": .bool(resolved)])
    }

    /// A comment pinned to an element the screen script picked; `send` also posts it to the design's conversation.
    @discardableResult
    public func addDesignComment(_ designId: String, screenId: String, step: String, pick: DesignPick, body: String, send: Bool) async throws -> Bool {
        struct Result: Decodable { var sent: Bool }
        let input: JSONValue = [
            "designId": .string(designId), "screenId": .string(screenId), "step": .string(step),
            "selector": .string(String(pick.selector.prefix(2000))), "elementHtml": .string(String(pick.html.prefix(5000))),
            "elementText": .string(String(pick.text.prefix(400))), "body": .string(String(body.prefix(4000))), "send": .bool(send),
        ]
        let result: Result = try await rpc("studio", Studio.Method.designs_addComment, input)
        return result.sent
    }

    /// Saves text typed over a screen's element (inner HTML before and after). Nil when saved, else Studio's reason.
    public func editDesignText(_ designId: String, screenId: String, before: String, after: String) async throws -> String? {
        struct Result: Decodable { var ok: Bool; var reason: String? }
        let result: Result = try await rpc("studio", Studio.Method.designs_editText,
                                           ["designId": .string(designId), "screenId": .string(screenId), "before": .string(before), "after": .string(after)])
        return result.ok ? nil : (result.reason ?? "missing")
    }

    public func deleteDesign(_ id: String) async throws {
        let _: JSONValue = try await rpc("studio", Studio.Method.designs_deleteDesign, ["id": .string(id)])
    }

    /// The screen's raw HTML (`download=1`), or its steps as printable pages (`print`).
    public func designScreenFileURL(_ designId: String, _ screen: DesignScreen, print: Bool) -> URL {
        var components = URLComponents(url: designScreenURL(designId, screen), resolvingAgainstBaseURL: false)!
        if print {
            components.path = "/api/v1/plugins/studio/http/designs/print"
        } else {
            components.queryItems = (components.queryItems ?? []) + [URLQueryItem(name: "download", value: "1")]
        }
        components.fragment = nil
        return components.url!
    }

    public func deleteDesignComment(_ id: String) async throws {
        let _: JSONValue = try await rpc("studio", Studio.Method.designs_deleteComment, ["id": .string(id)])
    }

    /// Sends the comment to the design's conversation for the agent to act on.
    public func sendDesignComment(_ id: String) async throws {
        let _: JSONValue = try await rpc("studio", Studio.Method.designs_sendComment, ["id": .string(id)])
    }

    public static func isDesignId(_ value: String) -> Bool {
        let utf8 = value.utf8
        guard utf8.count == 20, value.hasPrefix("dsn_") else { return false }
        return utf8.dropFirst(4).allSatisfy { ($0 >= 0x30 && $0 <= 0x39) || ($0 >= 0x61 && $0 <= 0x66) }
    }
}
