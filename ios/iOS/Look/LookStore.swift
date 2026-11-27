import SwiftUI
import UIKit

/// The phone's look choice and the conditions that allow a live scene.
///
/// - The theme is the phone's own choice, On Air by default. "Follow each Bot"
///   uses the shown Bot's desktop theme instead (`appearance.themeId`).
/// - A scene theme shows a still with parallax. "Live scene" is opt-in and runs
///   only in the foreground, never in Low Power Mode, with Reduce Motion or once
///   the phone is warm (thermal state fair or above), at `LookStore.sceneFPS`.
/// - A live presence runs at `presenceFPS` (half that when the phone is warm)
///   and stops at serious or critical thermal state.
/// - Both pause, keeping their frame, while `EnergyGate` says the app is idle.
@MainActor
final class LookStore: ObservableObject {
    static let shared = LookStore()
    /// The live presence's frame rate on a cool phone.
    nonisolated static let liveFPS = 30
    /// The live scene's frame rate: its motion is slow, so 15 looks the same.
    nonisolated static let sceneFPS = 15

    enum Key {
        static let theme = "look.theme"
        static let live = "look.liveScene"
        static let followBot = "look.followBot"
    }

    let catalog: LookCatalog
    private let defaults: UserDefaults

    @Published var themeId: String { didSet { defaults.set(themeId, forKey: Key.theme) } }
    @Published var liveScene: Bool { didSet { defaults.set(liveScene, forKey: Key.live) } }
    @Published var followBot: Bool { didSet { defaults.set(followBot, forKey: Key.followBot) } }
    /// The mode a scene's driver chose (Tonight's Sky goes light by day), as desktop's engine follows it.
    @Published var sceneModes: [String: LookTheme.Mode] = [:]
    @Published private(set) var lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled
    @Published private(set) var thermal = ProcessInfo.processInfo.thermalState
    @Published private(set) var reduceMotion = UIAccessibility.isReduceMotionEnabled
    private var observers: [NSObjectProtocol] = []

    init(defaults: UserDefaults = AppGroup.defaults, catalog: LookCatalog = .shared) {
        self.defaults = defaults
        self.catalog = catalog
        themeId = defaults.string(forKey: Key.theme) ?? catalog.defaultTheme
        liveScene = defaults.bool(forKey: Key.live)
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        if let at = arguments.firstIndex(of: "-qaLookTheme"), arguments.indices.contains(at + 1) { themeId = arguments[at + 1] }
        if arguments.contains("-qaLiveScene") { liveScene = true }
        #endif
        followBot = defaults.bool(forKey: Key.followBot)
        let center = NotificationCenter.default
        observers = [
            center.addObserver(forName: .NSProcessInfoPowerStateDidChange, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled }
            },
            center.addObserver(forName: ProcessInfo.thermalStateDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.thermal = ProcessInfo.processInfo.thermalState }
            },
            center.addObserver(forName: UIAccessibility.reduceMotionStatusDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.reduceMotion = UIAccessibility.isReduceMotionEnabled }
            },
        ]
    }

    func theme(for bot: BotSpace?) -> LookTheme {
        if followBot, let id = bot?.appearance?.themeId { return catalog.theme(id) }
        return catalog.theme(themeId)
    }

    /// Motion of any kind (live scene, live presence) is allowed in this state.
    var motionAllowed: Bool { Self.motionAllowed(lowPower: lowPower, thermal: thermal, reduceMotion: reduceMotion) }

    /// A live scene runs: opted in, in the foreground, and the phone is cool.
    func liveSceneRuns(foreground: Bool) -> Bool {
        liveScene && foreground && Self.sceneAllowed(lowPower: lowPower, thermal: thermal, reduceMotion: reduceMotion)
    }

    /// The live presence's frame rate now.
    var presenceFPS: Int { Self.presenceFPS(thermal: thermal) }

    nonisolated static func motionAllowed(lowPower: Bool, thermal: ProcessInfo.ThermalState, reduceMotion: Bool) -> Bool {
        !lowPower && !reduceMotion && thermal != .serious && thermal != .critical
    }

    /// The live scene is the costliest motion: it stops as soon as the phone is warm.
    nonisolated static func sceneAllowed(lowPower: Bool, thermal: ProcessInfo.ThermalState, reduceMotion: Bool) -> Bool {
        motionAllowed(lowPower: lowPower, thermal: thermal, reduceMotion: reduceMotion) && thermal == .nominal
    }

    nonisolated static func presenceFPS(thermal: ProcessInfo.ThermalState) -> Int {
        thermal == .nominal ? liveFPS : liveFPS / 2
    }
}

/// Puts the look in the environment, with its tint and, for a one-mode theme, its color scheme.
struct LookRoot: ViewModifier {
    @ObservedObject var store: LookStore
    var bot: BotSpace?
    var theme: LookTheme?
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        let theme = theme ?? store.theme(for: bot)
        let fixed = Self.fixedScheme(theme, store: store)
        let look = Self.look(theme, store: store, scheme: scheme)
        content
            .environment(\.look, look)
            .tint(look.accent)
            .preferredColorScheme(fixed)
    }

    #if DEBUG
    /// `-qaSceneMode light|dark`: a two-mode scene theme's variant whatever its driver chooses for the hour (not a `SceneNight` one).
    private static let qaSceneMode: LookTheme.Mode? = {
        let arguments = ProcessInfo.processInfo.arguments
        return arguments.firstIndex(of: "-qaSceneMode").flatMap { arguments.indices.contains($0 + 1) ? LookTheme.Mode(rawValue: arguments[$0 + 1]) : nil }
    }()
    #endif

    static func fixedScheme(_ theme: LookTheme, store: LookStore) -> ColorScheme? {
        if SceneNight.themes.contains(theme.id), theme.modes[LookTheme.Mode.dark.rawValue] != nil { return .dark }
        var chosen = store.sceneModes[theme.id].flatMap { theme.modes[$0.rawValue] != nil ? $0 : nil }
        #if DEBUG
        if let pinned = qaSceneMode, theme.kind == .scene, theme.modes[pinned.rawValue] != nil { chosen = pinned }
        #endif
        return chosen.map { $0 == .dark ? .dark : .light } ?? theme.fixedScheme
    }

    static func look(_ theme: LookTheme, store: LookStore, scheme: ColorScheme) -> Look {
        Look(theme: theme, scheme: fixedScheme(theme, store: store) ?? scheme, showsScene: theme.kind == .scene)
    }
}

extension View {
    func lookRoot(_ store: LookStore = .shared, bot: BotSpace?, theme: LookTheme? = nil) -> some View {
        modifier(LookRoot(store: store, bot: bot, theme: theme))
    }

    /// Desktop's halo for bare text over a scene: the canvas color in three soft layers.
    @ViewBuilder func lookHalo(_ look: Look) -> some View {
        if look.showsScene && look.tokens.halo > 0 {
            shadow(color: look.canvas.opacity(0.9), radius: 1).shadow(color: look.canvas.opacity(0.9), radius: 1).shadow(color: look.canvas.opacity(0.55), radius: 4)
        } else {
            self
        }
    }

    /// Liquid Glass tinted by the look's surface color at desktop's glass opacity.
    func lookGlass(_ look: Look, _ surface: KeyPath<LookTokens.Surfaces, Double> = \.sidebar, in shape: some Shape = .rect(cornerRadius: 24), interactive: Bool = false) -> some View {
        glassEffect(interactive ? .regular.tint(look.glassTint(surface)).interactive() : .regular.tint(look.glassTint(surface)), in: shape)
    }
}
