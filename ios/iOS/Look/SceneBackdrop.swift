import SwiftUI
import UIKit

/// Rectangles in points for desktop's scene uniforms on the phone: the scene
/// fades under the list (`column`), and its focal object sits in the open band
/// above it, where design 10d puts Event Horizon's disk.
struct PhoneSceneLayout: Equatable {
    var size: CGSize
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
            "live": live, "fps": LookStore.liveFPS, "column": rect(column), "open": rect(open), "cards": [rect(column)],
        ]
        if let signals { out["signals"] = signals }
        return out
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

    private var memory: [String: UIImage] = [:]
    private var inFlight: [String: Task<UIImage?, Never>] = [:]
    private(set) var renders = 0
    private(set) var lastError: String?
    let directory: URL

    init(directory: URL = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appending(path: "LookStills", directoryHint: .isDirectory)) {
        self.directory = directory
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    static func key(theme: LookTheme, mode: LookTheme.Mode, size: CGSize, scale: CGFloat, now: Date = Date()) -> String {
        let hour = theme.scene?.driver == true ? "-" + Self.hourStamp(now) : ""
        return "\(theme.id)-\(mode.rawValue)-\(Int(size.width.rounded()))x\(Int(size.height.rounded()))@\(Int(scale))\(hour)"
    }

    static func hourStamp(_ date: Date) -> String {
        let parts = Calendar.current.dateComponents([.year, .month, .day, .hour], from: date)
        return String(format: "%04d%02d%02d%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0, parts.hour ?? 0)
    }

    /// Remembers a driver's chosen mode with its still, and hands it to the look.
    static func chose(_ mode: LookTheme.Mode, theme: String, key: String) {
        UserDefaults.standard.set(mode.rawValue, forKey: "look.sceneMode." + key)
        if LookStore.shared.sceneModes[theme] != mode { LookStore.shared.sceneModes[theme] = mode }
    }

    static func chosenMode(key: String) -> LookTheme.Mode? {
        UserDefaults.standard.string(forKey: "look.sceneMode." + key).flatMap(LookTheme.Mode.init(rawValue:))
    }

    func cached(_ key: String) -> UIImage? {
        if let image = memory[key] { return image }
        guard let data = try? Data(contentsOf: directory.appending(path: key + ".jpg")), let image = UIImage(data: data) else { return nil }
        memory[key] = image
        return image
    }

    func still(theme: LookTheme, mode: LookTheme.Mode, size: CGSize, scale: CGFloat, now: Date = Date()) async -> UIImage? {
        guard theme.kind == .scene, size.width > 1, size.height > 1 else { return nil }
        let key = Self.key(theme: theme, mode: mode, size: size, scale: scale, now: now)
        if let image = cached(key) { return image }
        if let running = inFlight[key] { return await running.value }
        let task = Task { @MainActor in await self.render(theme: theme, mode: mode, size: size, scale: scale, key: key) }
        inFlight[key] = task
        let image = await task.value
        inFlight[key] = nil
        return image
    }

    private func render(theme: LookTheme, mode: LookTheme.Mode, size: CGSize, scale: CGFloat, key: String) async -> UIImage? {
        let host = LookWebView(page: .scene, frame: CGRect(origin: .zero, size: size))
        LookHosting.attach(host.webView)
        defer { host.tearDown() }
        host.onMessage = { message in
            guard message["kind"] as? String == "scene-mode", let raw = message["mode"] as? String, let mode = LookTheme.Mode(rawValue: raw) else { return }
            Self.chose(mode, theme: theme.id, key: key)
        }
        do {
            let layout = PhoneSceneLayout(size: size)
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
            memory[key] = image
            if let data = image.jpegData(compressionQuality: 0.9) { try? data.write(to: directory.appending(path: key + ".jpg"), options: .atomic) }
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

    func clearMemory() { memory.removeAll() }
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
/// with tilt (a system motion effect, so it costs the app nothing while idle),
/// or, when Live scene is on and allowed, desktop's renderer running live at a
/// capped frame rate. Never put this behind a transcript.
struct SceneBackdrop: View {
    let theme: LookTheme
    var botId: String?
    var view: BotThreadsView?
    @Environment(\.look) private var look
    @Environment(\.scenePhase) private var phase
    @Environment(\.displayScale) private var scale
    @ObservedObject private var store = LookStore.shared
    @State private var image: UIImage?
    @State private var hour = SceneStills.hourStamp(Date())

    static let parallax: CGFloat = 12

    var body: some View {
        GeometryReader { geo in
            let size = CGSize(width: geo.size.width + 2 * Self.parallax, height: geo.size.height + 2 * Self.parallax)
            ZStack {
                Color(lookHex: theme.scene?.fallback ?? look.tokens.canvas)
                if store.liveSceneRuns(foreground: phase == .active) {
                    LiveSceneView(theme: theme.id, mode: look.mode, size: geo.size, signals: SceneSignals.payload(botId: botId, view: view))
                } else if let image {
                    ParallaxImage(image: image, amount: Self.parallax)
                        .frame(width: size.width, height: size.height)
                        .offset(x: -Self.parallax, y: -Self.parallax)
                }
            }
            .task(id: "\(theme.id)|\(look.mode)|\(Int(size.width))x\(Int(size.height))|\(hour)") {
                let key = SceneStills.key(theme: theme, mode: look.mode, size: size, scale: min(2, scale))
                if let chosen = SceneStills.chosenMode(key: key), store.sceneModes[theme.id] != chosen { store.sceneModes[theme.id] = chosen }
                image = SceneStills.shared.cached(key)
                if image == nil { image = await SceneStills.shared.still(theme: theme, mode: look.mode, size: size, scale: min(2, scale)) }
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
        let x = UIInterpolatingMotionEffect(keyPath: "center.x", type: .tiltAlongHorizontalAxis)
        x.minimumRelativeValue = -amount
        x.maximumRelativeValue = amount
        let y = UIInterpolatingMotionEffect(keyPath: "center.y", type: .tiltAlongVerticalAxis)
        y.minimumRelativeValue = -amount
        y.maximumRelativeValue = amount
        let group = UIMotionEffectGroup()
        group.motionEffects = [x, y]
        view.addMotionEffect(group)
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
    }
}

/// Desktop's scene renderer, live, in the sandboxed web view.
struct LiveSceneView: UIViewRepresentable {
    let theme: String
    let mode: LookTheme.Mode
    let size: CGSize
    let signals: [String: Any]

    final class Coordinator {
        var host: LookWebView?
        var key = ""
        var signalsJSON = ""
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
        let key = "\(theme)|\(mode.rawValue)|\(Int(size.width))x\(Int(size.height))"
        let scale = min(2, container.window?.screen.scale ?? 2)
        if coordinator.key != key {
            coordinator.key = key
            coordinator.host?.tearDown()
            let host = LookWebView(page: .scene, frame: CGRect(origin: .zero, size: size))
            host.webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            host.webView.frame = container.bounds
            container.addSubview(host.webView)
            coordinator.host = host
            let options = PhoneSceneLayout(size: size).arguments(theme: theme, mode: mode, scale: scale, live: true, signals: signals)
            Task { _ = try? await host.call("return BBLook.scene.start(options)", ["options": options]) }
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
