import Foundation

// Studio Design: UI prototypes an agent writes as HTML screens, in rounds of
// options ("1a", "1b", then "2a" …). The phone shows each screen live.

public typealias StudioDesign = Design.GetDesignOutputDesign
public typealias DesignScreen = Design.GetDesignOutputDesignRoundsItemScreensItem

extension StudioDesign {
    public var displayName: String {
        let trimmed = (name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "Untitled design" : trimmed
    }

    /// Every screen, newest round first, as the web canvas stacks them.
    public var screens: [DesignScreen] { (rounds ?? []).flatMap { $0.screens ?? [] } }
}

/// The plugin's `VIEWPORTS` presets (packages/bb-studio-design/src/shared.ts).
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
        if case .string(let text) = viewport { return designFrameSize(text) }
        return designFrameSize(nil)
    }
}

extension BBClient {
    public func design(_ id: String) async throws -> StudioDesign? {
        let result: Design.GetDesignOutput = try await rpc("design", Design.Method.getDesign, ["id": .string(id)])
        return result.design
    }

    /// One screen's HTML, sandboxed by the plugin. `v` changes with each revision so a cached copy never goes stale.
    public func designScreenURL(_ designId: String, _ screen: DesignScreen, step: String? = nil) -> URL {
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        components.path = "/api/v1/plugins/design/http/screen"
        components.queryItems = [
            URLQueryItem(name: "design", value: designId),
            URLQueryItem(name: "screen", value: screen.id ?? ""),
            URLQueryItem(name: "v", value: String(Int(screen.updatedAt ?? 0))),
            URLQueryItem(name: "s", value: "2"),
        ]
        if let step, !step.isEmpty { components.fragment = step }
        return components.url!
    }

    public static func isDesignId(_ value: String) -> Bool { value.wholeMatch(of: /dsn_[0-9a-f]{16}/) != nil }
}
