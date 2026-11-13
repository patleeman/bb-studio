import SwiftUI
import UIKit

/// The phone's look choice and the conditions that allow a live scene.
///
/// - The theme is the phone's own choice, On Air by default. "Follow each Bot"
///   uses the shown Bot's desktop theme instead (`appearance.themeId`).
/// - A scene theme shows a still with parallax. "Live scene" is opt-in and runs
///   only in the foreground, never in Low Power Mode, at serious or critical
///   thermal state or with Reduce Motion, at `LookStore.liveFPS` at most.
@MainActor
final class LookStore: ObservableObject {
    static let shared = LookStore()
    static let liveFPS = 30

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

    /// A live scene runs: opted in, in the foreground, and motion is allowed.
    func liveSceneRuns(foreground: Bool) -> Bool { liveScene && foreground && motionAllowed }

    nonisolated static func motionAllowed(lowPower: Bool, thermal: ProcessInfo.ThermalState, reduceMotion: Bool) -> Bool {
        !lowPower && !reduceMotion && thermal != .serious && thermal != .critical
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
        let chosen = store.sceneModes[theme.id].flatMap { theme.modes[$0.rawValue] != nil ? $0 : nil }
        let fixed: ColorScheme? = chosen.map { $0 == .dark ? .dark : .light } ?? theme.fixedScheme
        let look = Look(theme: theme, scheme: fixed ?? scheme, showsScene: theme.kind == .scene)
        content
            .environment(\.look, look)
            .tint(look.accent)
            .preferredColorScheme(fixed)
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
