import Foundation
import SwiftUI

/// Every theme the phone can show: On Air (the phone's default, design 10a), the
/// 8 desktop Classic themes and the 9 scene themes. The colors come from
/// `looks.json`, which `scripts/build-look.mjs` writes with desktop's own
/// `resolveLook`, so a theme reads the same here as on the Mac.
public struct LookCatalog: Decodable, Sendable {
    public var format: Int
    public var defaultTheme: String
    public var scenes: [String]
    public var themes: [LookTheme]

    public static let shared: LookCatalog = load(Bundle.main) ?? LookCatalog(format: 1, defaultTheme: LookTheme.onAirId, scenes: [], themes: [.fallback])

    public static func load(_ bundle: Bundle) -> LookCatalog? {
        guard let url = bundle.url(forResource: "looks", withExtension: "json"), let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(LookCatalog.self, from: data)
    }

    public func theme(_ id: String?) -> LookTheme {
        let id = id.map(LookTheme.canonical)
        return themes.first { $0.id == id } ?? themes.first { $0.id == defaultTheme } ?? themes.first ?? .fallback
    }

    public var classics: [LookTheme] { themes.filter { $0.kind == .classic } }
    public var sceneThemes: [LookTheme] { themes.filter { $0.kind == .scene } }
}

public struct LookTheme: Decodable, Hashable, Sendable, Identifiable {
    public enum Kind: String, Decodable, Sendable { case classic, scene }
    public enum Mode: String, Decodable, Sendable { case light, dark }

    public struct Scene: Decodable, Hashable, Sendable {
        /// The scene time desktop draws when motion is off; the phone's still.
        public var still: Double
        public var fallback: String
        public var fallbackImage: Bool
        /// One of desktop's six JS drivers (weather, sky, atlases) feeds this scene.
        public var driver: Bool
        public var motion: Double
    }

    public static let onAirId = "on-air"
    static let aliases = ["cabin-aurora": "aurora-fjord", "zen-garden": "kyoto-garden"]
    public static func canonical(_ id: String) -> String { aliases[id] ?? id }

    public var id: String
    public var name: String
    public var kind: Kind
    public var palette: [String]
    public var modes: [String: LookTokens]
    public var scene: Scene?

    /// Desktop's `variantFor`: the app's mode if the theme has it, else its only one.
    public func variant(_ scheme: ColorScheme) -> (mode: Mode, tokens: LookTokens) {
        let wanted: Mode = scheme == .dark ? .dark : .light
        if let own = modes[wanted.rawValue] { return (wanted, own) }
        let other: Mode = wanted == .dark ? .light : .dark
        return (other, modes[other.rawValue] ?? LookTokens.onAir)
    }

    /// A theme with one variant sets the app's color scheme; one with both follows the system.
    public var fixedScheme: ColorScheme? {
        guard modes.count == 1, let only = modes.keys.first else { return nil }
        return only == Mode.light.rawValue ? .light : .dark
    }

    static let fallback = LookTheme(id: onAirId, name: "On Air", kind: .classic, palette: ["#111316", "#9db8ff", "#f2b04a", "#63c98b"],
                                    modes: ["dark": .onAir], scene: nil)
}

public struct LookTokens: Decodable, Hashable, Sendable {
    public struct Surfaces: Decodable, Hashable, Sendable {
        public var sidebar: Double
        public var main: Double
        public var transcript: Double
        public var composer: Double
        public var hud: Double
    }
    public struct Presence: Decodable, Hashable, Sendable {
        public var palette: [String]
        public var light: Bool
    }

    public var canvas: String
    public var ink: String
    public var sidebar: String
    public var accent: String
    public var accentInk: String
    public var selection: String
    public var error: String
    public var warning: String
    public var success: String
    public var worker: String
    public var needsYou: String
    public var finished: String
    public var ripple: String
    public var sceneTone: String
    public var muted: String
    public var subtle: String
    public var errorText: String
    public var warningText: String
    public var successText: String
    public var accentText: String
    public var selectionAlpha: Double
    /// Desktop's glass opacity per surface, already raised to its readable floor.
    public var alpha: Surfaces
    public var blur: Surfaces
    public var saturate: Double
    public var edge: String?
    public var halo: Double
    public var radius: Double
    public var presence: Presence

    static let onAir = LookTokens(
        canvas: "#111316", ink: "#f2f3f5", sidebar: "#16181c", accent: "#9db8ff", accentInk: "#0c0d0f", selection: "#9db8ff",
        error: "#ff6b6b", warning: "#f2b04a", success: "#63c98b", worker: "#63c98b", needsYou: "#f2b04a", finished: "#63c98b",
        ripple: "#ff6b6b", sceneTone: "#111316", muted: "#abadaf", subtle: "#98999c", errorText: "#ff6b6b", warningText: "#f2b04a",
        successText: "#63c98b", accentText: "#9db8ff", selectionAlpha: 0.32,
        alpha: Surfaces(sidebar: 1, main: 1, transcript: 1, composer: 1, hud: 1), blur: Surfaces(sidebar: 0, main: 0, transcript: 0, composer: 0, hud: 0),
        saturate: 1, edge: nil, halo: 0, radius: 12, presence: Presence(palette: ["#9db8ff", "#33faff", "#f2b04a"], light: false))
}

public extension Color {
    /// `#rrggbb` from a theme; clear when it isn't one.
    init(lookHex hex: String) {
        let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else {
            self = .clear
            return
        }
        self.init(.sRGB, red: Double(value >> 16 & 0xFF) / 255, green: Double(value >> 8 & 0xFF) / 255, blue: Double(value & 0xFF) / 255)
    }
}

/// The shown look: a theme's tokens in one mode, as SwiftUI colors.
public struct Look: Hashable, Sendable {
    public var theme: LookTheme
    public var mode: LookTheme.Mode
    public var tokens: LookTokens
    /// A scene still or live scene is behind the chrome.
    public var showsScene: Bool

    public init(theme: LookTheme, scheme: ColorScheme, showsScene: Bool = false) {
        self.theme = theme
        (mode, tokens) = theme.variant(scheme)
        self.showsScene = showsScene && theme.kind == .scene
    }

    public static let onAir = Look(theme: LookCatalog.shared.theme(LookTheme.onAirId), scheme: .dark)

    public var colorScheme: ColorScheme { mode == .dark ? .dark : .light }
    public var canvas: Color { Color(lookHex: tokens.canvas) }
    public var ink: Color { Color(lookHex: tokens.ink) }
    public var sidebar: Color { Color(lookHex: tokens.sidebar) }
    public var accent: Color { Color(lookHex: tokens.accent) }
    public var accentText: Color { Color(lookHex: tokens.accentText) }
    public var muted: Color { Color(lookHex: tokens.muted) }
    public var subtle: Color { Color(lookHex: tokens.subtle) }
    public var needsYou: Color { Color(lookHex: tokens.needsYou) }
    public var warningText: Color { Color(lookHex: tokens.warningText) }
    public var success: Color { Color(lookHex: tokens.successText) }
    public var error: Color { Color(lookHex: tokens.errorText) }
    public var worker: Color { Color(lookHex: tokens.worker) }
    public var edge: Color? { tokens.edge.map(Color.init(lookHex:)) }
    public var radius: CGFloat { CGFloat(tokens.radius) }

    /// The tint over a glass surface: desktop's surface color at its glass opacity.
    /// Classic themes are solid on desktop; on the phone their controls still use
    /// Liquid Glass, tinted by the canvas at a light share.
    public func glassTint(_ surface: KeyPath<LookTokens.Surfaces, Double>) -> Color {
        guard theme.kind == .scene else { return canvas.opacity(0.18) }
        let base = surface == \LookTokens.Surfaces.sidebar ? sidebar : canvas
        return base.opacity(tokens.alpha[keyPath: surface])
    }

    /// The transcript stays nearly opaque over a scene: desktop's own floor, and never below 0.9.
    public var transcriptOpacity: Double { showsScene ? max(0.9, tokens.alpha.transcript) : 1 }
}

public extension EnvironmentValues {
    @Entry var look: Look = .onAir
}
