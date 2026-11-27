import SwiftUI
import UIKit

/// Rectangles in points for desktop's scene uniforms on the phone: the scene
/// fades under the list (`column`), and its focal object sits in the open band
/// above it, where design 10d puts Event Horizon's disk.
struct SceneLight: Hashable {
    var x: CGFloat
    var y: CGFloat

    static let scale: CGFloat = 0.6

    var key: String { "-L\(Int(x.rounded()))x\(Int(y.rounded()))" }

    func shifted(by amount: CGFloat) -> SceneLight { SceneLight(x: x + amount, y: y + amount) }
}

struct PhoneSceneLayout: Equatable {
    var size: CGSize
    var light: SceneLight? = nil
    static let header: CGFloat = 186
    static let footer: CGFloat = 84
    static let margin: CGFloat = 16

    func rect(_ r: CGRect) -> [String: Double] {
        ["left": r.minX, "top": r.minY, "right": r.maxX, "bottom": r.maxY]
    }

    var column: CGRect {
        CGRect(x: Self.margin, y: Self.header, width: max(1, size.width - 2 * Self.margin), height: max(1, size.height - Self.header - Self.footer))
    }
    var open: CGRect { CGRect(x: 0, y: 0, width: size.width, height: Self.header) }

    func arguments(theme: String, mode: LookTheme.Mode, scale: CGFloat, live: Bool, signals: [String: Any]?) -> [String: Any] {
        var out: [String: Any] = [
            "themeId": theme, "mode": mode.rawValue, "width": size.width, "height": size.height, "dpr": scale,
            "live": live, "fps": LookStore.sceneFPS, "column": rect(column), "open": rect(open), "cards": [rect(column)],
        ]
        if let signals { out["signals"] = signals }
        if let light { out["light"] = ["x": light.x, "y": light.y, "scale": SceneLight.scale] }
        return out
    }
}

/// Tonight's Sky stays night at every hour: its day is too bright behind the
/// room. Its look is the dark variant (`LookRoot.fixedScheme`), and its scene's
/// page reads a clock set to tonight, so the sky driver draws the night and
/// never asks for the light variant.
enum SceneNight {
    static let themes: Set<String> = ["tonights-sky"]

    /// 23:00 local today, moving on from there and back every four hours, before dawn.
    static let clock = """
    if (!Date.bbNight) {
        const real = Date.now.bind(Date), start = real(), base = new Date();
        base.setHours(23, 0, 0, 0);
        const night = base.getTime();
        Date.now = () => night + ((real() - start) % 14400000);
        Date.bbNight = true;
    }
    """

    /// Sets the night clock on a scene's page before the scene starts, for these themes.
    static func prepare(_ host: LookWebView, theme: String) async {
        guard themes.contains(theme) else { return }
        _ = try? await host.call(clock)
    }
}

/// Desktop's scene signals from a Bot's threads view: workers and conversations.
enum SceneSignals {
    static func payload(botId: String?, view: BotThreadsView?) -> [String: Any] {
        let id: Any = (botId ?? view?.botId).map { $0 as Any } ?? NSNull()
        guard let view else { return ["botId": id, "workers": [], "conversations": []] }
        let workers: [[String: Any]] = view.workers.map { worker in
            let status = switch worker.status {
            case .running: "running"
            case .needsYou: "needs-you"
            case .failed: "failed"
            case .done, .other: "done"
            }
            return ["threadId": worker.threadId, "status": status]
        }
        let conversations: [[String: Any]] = view.conversations.map {
            ["threadId": $0.threadId, "running": $0.running, "needsYou": $0.needsYou != nil]
        }
        return ["botId": id, "workers": workers, "conversations": conversations]
    }
}

/// Renders each scene theme's still once (per theme, mode and size; per hour for
/// the clock- and weather-driven scenes) with desktop's own renderer and drivers
/// in a sandboxed web view, and caches it in memory and on disk.
@MainActor
final class SceneStills {
    static let shared = SceneStills()

    private let memory: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.totalCostLimit = 48 << 20
        return cache
    }()
    private var inFlight: [String: Task<UIImage?, Never>] = [:]
    private(set) var renders = 0
    private(set) var lastError: String?
    let directory: URL

    init(directory: URL = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appending(path: "LookStills", directoryHint: .isDirectory)) {
        self.directory = directory
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    private static func imageCost(_ image: UIImage) -> Int {
        Int(image.size.width * image.size.height * image.scale * image.scale * 4)
    }

    static func key(theme: LookTheme, mode: LookTheme.Mode, size: CGSize, scale: CGFloat, now: Date = Date(), light: SceneLight? = nil) -> String {
        let hour = theme.scene?.driver == true ? "-" + Self.hourStamp(now) : ""
        return "\(theme.id)-\(mode.rawValue)-\(Int(size.width.rounded()))x\(Int(size.height.rounded()))@\(Int(scale))\(light?.key ?? "")\(hour)"
    }

    static func hourStamp(_ date: Date) -> String {
        let parts = Calendar.current.dateComponents([.year, .month, .day, .hour], from: date)
        return String(format: "%04d%02d%02d%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0, parts.hour ?? 0)
    }

    /// Remembers a driver's chosen mode with its still, and hands it to the look.
    static func chose(_ mode: LookTheme.Mode, theme: String, key: String) {
        guard !SceneNight.themes.contains(theme) else { return }
        UserDefaults.standard.set(mode.rawValue, forKey: "look.sceneMode." + key)
        if LookStore.shared.sceneModes[theme] != mode { LookStore.shared.sceneModes[theme] = mode }
    }

    static func chosenMode(key: String) -> LookTheme.Mode? {
        UserDefaults.standard.string(forKey: "look.sceneMode." + key).flatMap(LookTheme.Mode.init(rawValue:))
    }

    func cached(_ key: String) -> UIImage? {
        let cacheKey = key as NSString
        if let image = memory.object(forKey: cacheKey) { return image }
        guard let data = try? Data(contentsOf: directory.appending(path: key + ".jpg")), let image = UIImage(data: data) else { return nil }
        memory.setObject(image, forKey: cacheKey, cost: Self.imageCost(image))
        return image
    }

    func still(theme: LookTheme, mode: LookTheme.Mode, size: CGSize, scale: CGFloat, now: Date = Date(), light: SceneLight? = nil) async -> UIImage? {
        guard theme.kind == .scene, size.width > 1, size.height > 1 else { return nil }
        let key = Self.key(theme: theme, mode: mode, size: size, scale: scale, now: now, light: light)
        if let image = cached(key) { return image }
        if let running = inFlight[key] { return await running.value }
        let task = Task { @MainActor in await self.render(theme: theme, mode: mode, size: size, scale: scale, light: light, key: key) }
        inFlight[key] = task
        let image = await task.value
        inFlight[key] = nil
        return image
    }

    private func render(theme: LookTheme, mode: LookTheme.Mode, size: CGSize, scale: CGFloat, light: SceneLight?, key: String) async -> UIImage? {
        let host = LookWebView(page: .scene, frame: CGRect(origin: .zero, size: size))
        LookHosting.attach(host.webView)
        defer { host.tearDown() }
        host.onMessage = { message in
            guard message["kind"] as? String == "scene-mode", let raw = message["mode"] as? String, let mode = LookTheme.Mode(rawValue: raw) else { return }
            Self.chose(mode, theme: theme.id, key: key)
        }
        await SceneNight.prepare(host, theme: theme.id)
        do {
            let layout = PhoneSceneLayout(size: size, light: light)
            let started = try await host.call("return BBLook.scene.start(options)",
                                              ["options": layout.arguments(theme: theme.id, mode: mode, scale: scale, live: false, signals: nil)]) as? [String: Any]
            guard started?["ok"] as? Bool == true else {
                lastError = started?["error"] as? String ?? "The scene did not start."
                return nil
            }
            guard let url = try await host.call("return await BBLook.scene.still()") as? String, let image = Self.decode(url) else {
                lastError = "The scene gave no still."
                return nil
            }
            try await host.call("BBLook.scene.stop()")
            renders += 1
            memory.setObject(image, forKey: key as NSString, cost: Self.imageCost(image))
            let target = directory.appending(path: key + ".jpg")
            await Task.detached(priority: .utility) {
                if let data = image.jpegData(compressionQuality: 0.9) { try? data.write(to: target, options: .atomic) }
            }.value
            return image
        } catch {
            lastError = error.localizedDescription
            return nil
        }
    }

    static func decode(_ dataURL: String) -> UIImage? {
        guard let comma = dataURL.firstIndex(of: ","), dataURL.hasPrefix("data:image/"),
              let data = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...])) else { return nil }
        return UIImage(data: data, scale: 1)
    }

    func clearMemory() { memory.removeAllObjects() }
}

/// Look web views that render off screen sit under the app's root view, so
/// WebKit treats them as in a window without them ever showing.
enum LookHosting {
    @MainActor static func attach(_ view: UIView) {
        let window = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow ?? ($0 as? UIWindowScene)?.windows.first }.first
        guard let window else { return }
        view.isUserInteractionEnabled = false
        window.insertSubview(view, at: 0)
    }
}

/// The scene behind the Bot's list: a cached still that shifts a few points
/// with tilt (a system motion effect; it wakes the app at the display's rate,
/// so it rests while the app is idle),
/// or, when Live scene is on and allowed, desktop's renderer running live at a
/// capped frame rate. It pauses (keeping its frame) while the app is idle or the
/// keyboard is up. Never put this behind a transcript.
struct SceneBackdrop: View {
    let theme: LookTheme
    var botId: String?
    var view: BotThreadsView?
    var stillOnly = false
    var light: SceneLight?
    var paused = false
    var motion = true
    @Environment(\.look) private var look
    @Environment(\.scenePhase) private var phase
    @Environment(\.displayScale) private var scale
    @ObservedObject private var store = LookStore.shared
    @ObservedObject private var gate = EnergyGate.shared
    @State private var image: UIImage?
    @State private var hour = SceneStills.hourStamp(Date())

    static let parallax: CGFloat = 12

    static func stillSize(_ size: CGSize) -> CGSize {
        CGSize(width: size.width + 2 * parallax, height: size.height + 2 * parallax)
    }

    var body: some View {
        GeometryReader { geo in
            let size = Self.stillSize(geo.size)
            let spot = light?.shifted(by: Self.parallax)
            let shown = theme.kind == .scene ? SceneStills.shared.cached(SceneStills.key(theme: theme, mode: look.mode, size: size, scale: min(2, scale), light: spot)) ?? image : image
            ZStack {
                Color(lookHex: theme.scene?.fallback ?? look.tokens.canvas)
                if !stillOnly, store.liveSceneRuns(foreground: phase == .active) {
                    LiveSceneView(theme: theme.id, mode: look.mode, size: geo.size, light: light, paused: paused || gate.idle || gate.typing, signals: SceneSignals.payload(botId: botId, view: view))
                } else if let image = shown {
                    // The tilt engine wakes the app at the display's rate: it rests while idle.
                    ParallaxImage(image: image, amount: motion && !gate.idle ? Self.parallax : 0)
                        .frame(width: size.width, height: size.height)
                        .offset(x: -Self.parallax, y: -Self.parallax)
                }
            }
            .task(id: "\(theme.id)|\(look.mode)|\(Int(size.width))x\(Int(size.height))|\(hour)\(spot?.key ?? "")") {
                let key = SceneStills.key(theme: theme, mode: look.mode, size: size, scale: min(2, scale), light: spot)
                if let chosen = SceneStills.chosenMode(key: key), store.sceneModes[theme.id] != chosen { store.sceneModes[theme.id] = chosen }
                if let cached = SceneStills.shared.cached(key) {
                    image = cached
                } else {
                    let rendered = await SceneStills.shared.still(theme: theme, mode: look.mode, size: size, scale: min(2, scale), light: spot)
                    withAnimation(.easeOut(duration: 0.3)) { image = rendered }
                }
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .onChange(of: phase) { _, now in
            if now == .active { hour = SceneStills.hourStamp(Date()) }
        }
    }
}

/// A still that shifts with the device's tilt through `UIInterpolatingMotionEffect`.
struct ParallaxImage: UIViewRepresentable {
    let image: UIImage
    let amount: CGFloat

    func makeUIView(context: Context) -> UIImageView {
        let view = UIImageView(image: image)
        view.contentMode = .scaleAspectFill
        view.clipsToBounds = true
        Self.tilt(view, amount)
        #if DEBUG
        // UI tests find the still; VoiceOver never sees it in a release build.
        if ProcessInfo.processInfo.arguments.contains("-qaLookTheme") {
            view.isAccessibilityElement = true
            view.accessibilityIdentifier = "SceneStill"
        }
        #endif
        return view
    }

    func updateUIView(_ view: UIImageView, context: Context) {
        if view.image !== image { view.image = image }
        // Eases to and from the tilted spot rather than jumping.
        if (view.motionEffects.isEmpty) != (amount <= 0) { UIView.animate(withDuration: 0.6) { Self.tilt(view, amount) } }
    }

    static func tilt(_ view: UIImageView, _ amount: CGFloat) {
        view.motionEffects.forEach(view.removeMotionEffect)
        guard amount > 0 else { return }
        let x = UIInterpolatingMotionEffect(keyPath: "center.x", type: .tiltAlongHorizontalAxis)
        x.minimumRelativeValue = -amount
        x.maximumRelativeValue = amount
        let y = UIInterpolatingMotionEffect(keyPath: "center.y", type: .tiltAlongVerticalAxis)
        y.minimumRelativeValue = -amount
        y.maximumRelativeValue = amount
        let group = UIMotionEffectGroup()
        group.motionEffects = [x, y]
        view.addMotionEffect(group)
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UIImageView, context: Context) -> CGSize? {
        proposal.replacingUnspecifiedDimensions(by: image.size)
    }
}

/// Desktop's scene renderer, live, in the sandboxed web view.
struct LiveSceneView: UIViewRepresentable {
    let theme: String
    let mode: LookTheme.Mode
    let size: CGSize
    var light: SceneLight?
    var paused = false
    let signals: [String: Any]

    final class Coordinator {
        var host: LookWebView?
        var key = ""
        var signalsJSON = ""
        var paused = false
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> UIView {
        let container = UIView()
        container.isUserInteractionEnabled = false
        container.accessibilityIdentifier = "LiveScene"
        return container
    }

    func updateUIView(_ container: UIView, context: Context) {
        let coordinator = context.coordinator
        let key = "\(theme)|\(mode.rawValue)|\(Int(size.width))x\(Int(size.height))\(light?.key ?? "")"
        let scale = min(2, container.window?.screen.scale ?? 2)
        if coordinator.key != key {
            coordinator.key = key
            coordinator.host?.tearDown()
            let host = LookWebView(page: .scene, frame: CGRect(origin: .zero, size: size))
            host.webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            host.webView.frame = container.bounds
            container.addSubview(host.webView)
            coordinator.host = host
            let options = PhoneSceneLayout(size: size, light: light).arguments(theme: theme, mode: mode, scale: scale, live: true, signals: signals)
            let paused = paused
            coordinator.paused = paused
            Task {
                await SceneNight.prepare(host, theme: theme)
                _ = try? await host.call("return BBLook.scene.start(options)", ["options": options])
                if paused { _ = try? await host.call("BBLook.scene.pause()") }
            }
        } else if let host = coordinator.host, coordinator.paused != paused {
            coordinator.paused = paused
            Task { _ = try? await host.call(paused ? "BBLook.scene.pause()" : "BBLook.scene.resume()") }
        } else if let host = coordinator.host,
                  let data = try? JSONSerialization.data(withJSONObject: signals, options: [.sortedKeys]),
                  let json = String(data: data, encoding: .utf8), json != coordinator.signalsJSON {
            coordinator.signalsJSON = json
            Task { _ = try? await host.call("BBLook.scene.setSignals(signals)", ["signals": signals]) }
        }
    }

    static func dismantleUIView(_ container: UIView, coordinator: Coordinator) {
        coordinator.host?.tearDown()
        coordinator.host = nil
    }
}
