import SwiftUI
import UIKit
import CryptoKit

/// What a presence draws: the form (one of desktop's 8, or an agent-made one's
/// module from `presences_list`), its colors, state and size.
struct PresenceSpec: Hashable {
    static let roomHeadroom: CGFloat = 1.35
    static let builtinForms = ["orb", "tesseract", "knot", "swarm", "mobius", "poly", "attractor", "klein"]
    static let defaultForms = ["tesseract", "orb", "poly"]
    static let fallbackForm = "tesseract"

    var form: String
    var code: String?
    var themeId: String
    var mode: LookTheme.Mode
    var customHex: String?
    var motion: Double
    var state: BotPresenceState
    var workers: Int
    var size: CGFloat
    var room: CGFloat = 1
    var time: Double?
    var canvas: CGFloat { size * max(1, room) }
    var scale: CGFloat
    var ink: String
    var surfaceLight: Bool

    /// Desktop's `defaultForm`: a primary Bot is a tesseract; others hash their id.
    static func defaultForm(botId: String, primary: Bool) -> String {
        if primary { return fallbackForm }
        var value: UInt32 = 0
        for scalar in botId.unicodeScalars { value = value &* 31 &+ scalar.value }
        return defaultForms[Int(value % UInt32(defaultForms.count))]
    }

    init(bot: BotSpace, state: BotPresenceState, workers: Int, look: Look, size: CGFloat, scale: CGFloat, custom: PresenceCatalog.Entry? = nil) {
        let presence = bot.presence
        let form = presence?.form ?? Self.defaultForm(botId: bot.id, primary: bot.primary)
        let builtin = Self.builtinForms.contains(form)
        self.form = builtin || custom?.code != nil ? form : Self.fallbackForm
        code = builtin ? nil : custom?.code
        themeId = look.theme.id
        mode = look.mode
        customHex = presence?.customColor
        motion = presence?.motion ?? 1
        self.state = state
        self.workers = workers
        self.size = size
        self.scale = min(3, scale)
        ink = look.tokens.ink
        surfaceLight = look.mode == .light
    }

    var arguments: [String: Any] {
        var out: [String: Any] = [
            "form": form, "themeId": themeId, "mode": mode.rawValue, "motion": motion, "state": state.rawValue,
            "workers": workers, "size": size, "room": max(1, room), "dpr": scale, "ink": ink, "surfaceLight": surfaceLight,
        ]
        if let code { out["code"] = code }
        if let time { out["time"] = time }
        if let customHex { out["customHex"] = customHex }
        return out
    }

    /// A file-safe key for the still cache.
    var stillKey: String {
        let parts = [form, code.map { Self.digest($0) } ?? "-", themeId, mode.rawValue, customHex ?? "-", state.rawValue,
                     "\(state == .working ? workers : 0)", "\(Int(size))", "\(Int(scale))", ink, surfaceLight ? "l" : "d"] + (room > 1 ? ["r\(Int(room * 100))"] : []) + (time.map { ["t\($0)"] } ?? [])
        return Self.digest(parts.joined(separator: "|"))
    }

    static func digest(_ text: String) -> String { PresenceStillFiles.digest(text) }
}

/// Agent-made presences from `presences_list`, by id. Their code only ever runs
/// inside desktop's sandbox in a look web view.
@MainActor
final class PresenceCatalog: ObservableObject {
    static let shared = PresenceCatalog()

    struct Entry: Codable, Hashable {
        var id: String
        var name: String
        var code: String?
    }

    @Published private(set) var entries: [String: Entry] = [:]
    private var loadedAt: Date?

    func entry(_ form: String?) -> Entry? { form.flatMap { entries[$0] } }

    func refresh(client: BBClient, force: Bool = false) async {
        if !force, let loadedAt, Date().timeIntervalSince(loadedAt) < 300 { return }
        guard let output: Studio.PresencesListOutput = try? await client.rpc("studio", Studio.Method.presences_list, .object([:])) else { return }
        var next: [String: Entry] = [:]
        for item in output.presences ?? [] {
            guard let id = item.id, let code = item.code, !code.isEmpty else { continue }
            next[id] = Entry(id: id, name: item.name ?? id, code: code)
        }
        loadedAt = Date()
        if next != entries { entries = next }
    }
}

/// Renders presence stills (one per form, state, colors and size) with desktop's
/// forms, in one shared sandboxed web view, and caches them. Widgets and the
/// Dynamic Island read the per-Bot copies from the app group.
@MainActor
final class PresenceStills {
    static let shared = PresenceStills()

    private var memory: [String: UIImage] = [:]
    private var host: LookWebView?
    private var queue: Task<Void, Never>?
    private(set) var renders = 0
    private(set) var failures: [String: String] = [:]
    let directory: URL

    init(directory: URL = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appending(path: "PresenceStills", directoryHint: .isDirectory)) {
        self.directory = directory
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    func cached(_ spec: PresenceSpec) -> UIImage? {
        let key = spec.stillKey
        if let image = memory[key] { return image }
        guard let data = try? Data(contentsOf: directory.appending(path: key + ".png")), let image = UIImage(data: data, scale: spec.scale) else { return nil }
        memory[key] = image
        return image
    }

    /// Renders one at a time; a failing agent-made form falls back to the tesseract, as on desktop.
    func still(_ spec: PresenceSpec) async -> UIImage? {
        if let image = cached(spec) { return image }
        let previous = queue
        let task = Task { @MainActor () -> UIImage? in
            await previous?.value
            if let image = self.cached(spec) { return image }
            return await self.render(spec)
        }
        queue = Task { _ = await task.value }
        return await task.value
    }

    private func render(_ spec: PresenceSpec) async -> UIImage? {
        let host = self.host ?? {
            let made = LookWebView(page: .presence)
            LookHosting.attach(made.webView)
            self.host = made
            return made
        }()
        do {
            guard let url = try await host.call("return await BBLook.presence.still(spec)", ["spec": spec.arguments]) as? String,
                  let image = SceneStills.decode(url).flatMap({ $0.cgImage }).map({ UIImage(cgImage: $0, scale: spec.scale, orientation: .up) })
            else { return nil }
            renders += 1
            memory[spec.stillKey] = image
            if let data = image.pngData() { try? data.write(to: directory.appending(path: spec.stillKey + ".png"), options: .atomic) }
            return image
        } catch {
            failures[spec.form] = error.localizedDescription
            guard spec.code != nil else { return nil }
            var fallback = spec
            fallback.code = nil
            fallback.form = PresenceSpec.fallbackForm
            return await render(fallback)
        }
    }

    /// Writes a Bot's four state stills to the app group for widgets and the
    /// Live Activity: `Look/presence/<botId>/<state>.png`, plus `workers` for working.
    func exportForWidgets(bot: BotSpace, look: Look, custom: PresenceCatalog.Entry?, size: CGFloat = 40, scale: CGFloat = 3) async {
        let folder = Self.widgetFolder(botId: bot.id)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        for state in [BotPresenceState.idle, .thinking, .working, .needs] {
            let spec = PresenceSpec(bot: bot, state: state, workers: 2, look: look, size: size, scale: scale, custom: custom)
            let target = folder.appending(path: state.rawValue + ".png")
            let marker = folder.appending(path: state.rawValue + ".key")
            if (try? String(contentsOf: marker, encoding: .utf8)) == spec.stillKey, FileManager.default.fileExists(atPath: target.path) { continue }
            guard let image = await still(spec), let data = image.pngData() else { continue }
            try? data.write(to: target, options: .atomic)
            try? spec.stillKey.write(to: marker, atomically: true, encoding: .utf8)
        }
    }

    nonisolated static func widgetFolder(botId: String) -> URL {
        PresenceStillFiles.folder(botId: botId)
    }

    func tearDown() {
        host?.tearDown()
        host = nil
    }
}

/// A Bot's presence. A still (rendered once and cached) while the Bot is idle or
/// motion isn't allowed; desktop's form running live, at a capped frame rate,
/// while it thinks, works or needs you.
struct PresenceView: View {
    let bot: BotSpace
    let state: BotPresenceState
    let workers: Int
    var size: CGFloat = 36
    var room: CGFloat = 1
    @Environment(\.look) private var look
    @Environment(\.displayScale) private var scale
    @Environment(\.scenePhase) private var phase
    @ObservedObject private var store = LookStore.shared
    @ObservedObject private var catalog = PresenceCatalog.shared
    @State private var image: UIImage?

    private var spec: PresenceSpec {
        var spec = PresenceSpec(bot: bot, state: state, workers: workers, look: look, size: size, scale: scale, custom: catalog.entry(bot.presence?.form))
        spec.room = room
        return spec
    }

    var live: Bool { state != .idle && phase == .active && store.motionAllowed }

    var body: some View {
        let spec = spec
        ZStack {
            if live {
                LivePresenceView(spec: spec)
            } else if let image {
                Image(uiImage: image).resizable().interpolation(.high)
            } else {
                Circle().fill(Color(lookHex: look.tokens.presence.palette.first ?? look.tokens.accent).opacity(0.35)).padding(size * 0.2)
            }
        }
        .frame(width: size * max(1, room), height: size * max(1, room))
        .task(id: spec) {
            image = PresenceStills.shared.cached(spec)
            if image == nil { image = await PresenceStills.shared.still(spec) }
        }
        .accessibilityHidden(true)
        .accessibilityIdentifier("Presence")
    }
}

/// Desktop's presence, live, in its own sandboxed web view.
struct LivePresenceView: UIViewRepresentable {
    let spec: PresenceSpec

    final class Coordinator {
        var host: LookWebView?
        var mounted: PresenceSpec?
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> UIView {
        let container = UIView()
        container.isUserInteractionEnabled = false
        container.backgroundColor = .clear
        container.clipsToBounds = true
        let host = LookWebView(page: .presence, frame: CGRect(x: 0, y: 0, width: spec.canvas, height: spec.canvas))
        host.webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        container.addSubview(host.webView)
        context.coordinator.host = host
        return container
    }

    func updateUIView(_ container: UIView, context: Context) {
        let coordinator = context.coordinator
        guard let host = coordinator.host, coordinator.mounted != spec else { return }
        let first = coordinator.mounted == nil || coordinator.mounted?.form != spec.form || coordinator.mounted?.code != spec.code || coordinator.mounted?.size != spec.size || coordinator.mounted?.room != spec.room
        coordinator.mounted = spec
        let arguments = spec.arguments
        Task {
            if first { _ = try? await host.call("BBLook.presence.mount(spec, true, fps)", ["spec": arguments, "fps": LookStore.liveFPS]) }
            else { _ = try? await host.call("BBLook.presence.update(spec)", ["spec": arguments]) }
        }
    }

    static func dismantleUIView(_ container: UIView, coordinator: Coordinator) {
        coordinator.host?.tearDown()
        coordinator.host = nil
    }
}
