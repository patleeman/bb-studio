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

    public static func isDesignId(_ value: String) -> Bool { value.wholeMatch(of: /dsn_[0-9a-f]{16}/) != nil }
}
