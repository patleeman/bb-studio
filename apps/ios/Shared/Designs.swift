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

extension DesignScreen {
    /// The width and height the screen was written for, as the plugin's `VIEWPORTS`.
    public var size: (width: Double, height: Double) {
        switch viewport {
        case .mobile: (390, 844)
        case .tablet: (834, 1112)
        default: (1280, 800)
        }
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
