import XCTest
import SwiftUI
import UIKit
@testable import BBStudio

@MainActor
final class LookTests: XCTestCase {
    static let classics = ["bb-default", "one-dark", "dracula", "solarized-light", "github-light", "github-dark", "nord", "catppuccin-mocha"]
    static let scenes = ["miami-1985", "event-horizon", "grid", "kyoto-garden", "forest", "aurora-fjord", "tonights-sky", "data-city", "deep-sea"]
    static let driven = ["forest", "kyoto-garden", "tonights-sky", "data-city", "deep-sea", "grid"]

    private func bot(_ id: String = "bot_abc", form: String? = nil, primary: Bool = false) throws -> BotSpace {
        let presence = form.map { #","presence":{"form":"\#($0)","color":{"source":"theme"},"motion":1}"# } ?? ""
        let json = #"{"bots":[{"id":"\#(id)","name":"Test","primary":\#(primary)\#(presence)}]}"#
        return try XCTUnwrap(BotSpaces(try JSONDecoder().decode(Studio.BotSpacesOutput.self, from: Data(json.utf8))).bots.first)
    }

    // MARK: Catalog

    func testCatalogHasOnAirEveryClassicAndEveryScene() {
        let catalog = LookCatalog.shared
        XCTAssertEqual(catalog.defaultTheme, LookTheme.onAirId)
        XCTAssertEqual(catalog.classics.map(\.id), [LookTheme.onAirId] + Self.classics)
        XCTAssertEqual(catalog.sceneThemes.map(\.id), Self.scenes)
        XCTAssertEqual(catalog.scenes, Self.scenes)
        for theme in catalog.sceneThemes {
            XCTAssertNotNil(theme.scene, theme.id)
            XCTAssertEqual(theme.scene?.driver, Self.driven.contains(theme.id), theme.id)
        }
        XCTAssertEqual(catalog.theme("zen-garden").id, "kyoto-garden")
        XCTAssertEqual(catalog.theme("nope").id, LookTheme.onAirId)
    }

    func testOnAirIsGraphiteAndDarkOnly() {
        let theme = LookCatalog.shared.theme(LookTheme.onAirId)
        XCTAssertEqual(theme.fixedScheme, .dark)
        let look = Look(theme: theme, scheme: .light)
        XCTAssertEqual(look.mode, .dark)
        XCTAssertEqual(look.tokens.canvas, "#111316")
        XCTAssertEqual(look.tokens.needsYou, "#f2b04a")
        XCTAssertEqual(look.tokens.accent, "#9db8ff")
        XCTAssertFalse(look.showsScene)
    }

    func testClassicTokensComeFromDesktop() {
        let dracula = LookCatalog.shared.theme("dracula")
        let look = Look(theme: dracula, scheme: .dark)
        XCTAssertEqual(look.tokens.canvas, "#282a36")
        XCTAssertEqual(look.tokens.accent, "#bd93f9")
        XCTAssertEqual(look.tokens.alpha.transcript, 1)
        XCTAssertEqual(LookCatalog.shared.theme("bb-default").fixedScheme, nil)
        XCTAssertEqual(LookCatalog.shared.theme("github-light").fixedScheme, .light)
    }

    func testSceneTranscriptStaysNearlyOpaqueAndDenserThanTheList() {
        for theme in LookCatalog.shared.sceneThemes {
            for scheme in [ColorScheme.light, .dark] {
                let look = Look(theme: theme, scheme: scheme, showsScene: true)
                XCTAssertTrue(look.showsScene)
                XCTAssertGreaterThanOrEqual(look.transcriptOpacity, 0.9, theme.id)
                XCTAssertLessThanOrEqual(look.tokens.alpha.sidebar, look.tokens.alpha.transcript, theme.id)
            }
        }
    }

    func testLiveSceneNeedsOptInForegroundAndHeadroom() {
        let defaults = UserDefaults(suiteName: "LookTests-\(UUID())")!
        let store = LookStore(defaults: defaults)
        XCTAssertEqual(store.themeId, LookTheme.onAirId)
        XCTAssertFalse(store.liveScene)
        XCTAssertFalse(store.liveSceneRuns(foreground: true))
        store.liveScene = true
        XCTAssertEqual(store.liveSceneRuns(foreground: false), false)
        XCTAssertFalse(LookStore.motionAllowed(lowPower: true, thermal: .nominal, reduceMotion: false))
        XCTAssertFalse(LookStore.motionAllowed(lowPower: false, thermal: .serious, reduceMotion: false))
        XCTAssertFalse(LookStore.motionAllowed(lowPower: false, thermal: .critical, reduceMotion: false))
        XCTAssertFalse(LookStore.motionAllowed(lowPower: false, thermal: .nominal, reduceMotion: true))
        XCTAssertTrue(LookStore.motionAllowed(lowPower: false, thermal: .fair, reduceMotion: false))
        XCTAssertEqual(LookStore(defaults: defaults).liveScene, true)
    }

    func testFollowBotUsesTheBotsDesktopTheme() throws {
        let defaults = UserDefaults(suiteName: "LookTests-\(UUID())")!
        let store = LookStore(defaults: defaults)
        var bot = try bot()
        bot.appearance = Studio.BotSpacesOutputBotsItemAppearance(themeId: "nord")
        XCTAssertEqual(store.theme(for: bot).id, LookTheme.onAirId)
        store.followBot = true
        XCTAssertEqual(store.theme(for: bot).id, "nord")
        store.themeId = "forest"
        XCTAssertEqual(store.theme(for: nil).id, "forest")
    }

    // MARK: Sandbox

    func testSandboxAllowsOnlyItsOwnPagesAndTwoReadOnlyRPCs() {
        XCTAssertTrue(LookWebView.allows(URL(string: "bblook://look/scene.html"), mainFrame: true))
        XCTAssertFalse(LookWebView.allows(URL(string: "https://example.com"), mainFrame: true))
        XCTAssertFalse(LookWebView.allows(URL(string: "about:blank"), mainFrame: true))
        XCTAssertTrue(LookWebView.allows(URL(string: "about:srcdoc"), mainFrame: false))
        XCTAssertFalse(LookWebView.allows(URL(string: "https://example.com/x"), mainFrame: false))
        XCTAssertFalse(LookWebView.allows(URL(string: "blob:bblook://look/1"), mainFrame: false))
        XCTAssertEqual(LookSchemeHandler.rpcMethod(path: "/api/v1/plugins/studio/rpc/theme.weather", page: .scene), "theme.weather")
        XCTAssertEqual(LookSchemeHandler.rpcMethod(path: "/api/v1/plugins/studio/rpc/theme.sky", page: .scene), "theme.sky")
        XCTAssertNil(LookSchemeHandler.rpcMethod(path: "/api/v1/plugins/studio/rpc/theme.weather", page: .presence))
        XCTAssertNil(LookSchemeHandler.rpcMethod(path: "/api/v1/plugins/studio/rpc/bot_set_presence", page: .scene))
        XCTAssertNil(LookSchemeHandler.rpcMethod(path: "/api/v1/plugins/studio/rpc/theme.options.set", page: .scene))
        XCTAssertTrue(LookWebView.blockRulesJSON.contains("https?|wss?|ftp|file"))
    }

    func testDefaultFormMatchesDesktop() {
        XCTAssertEqual(PresenceSpec.defaultForm(botId: "bot_abc", primary: false), "tesseract")
        XCTAssertEqual(PresenceSpec.defaultForm(botId: "bot_research", primary: false), "orb")
        XCTAssertEqual(PresenceSpec.defaultForm(botId: "b", primary: false), "poly")
        XCTAssertEqual(PresenceSpec.defaultForm(botId: "b", primary: true), "tesseract")
    }

    func testUnknownFormWithoutCodeFallsBackToTesseract() throws {
        let spec = PresenceSpec(bot: try bot(form: "made-up"), state: .idle, workers: 0, look: .onAir, size: 36, scale: 3)
        XCTAssertEqual(spec.form, "tesseract")
        XCTAssertNil(spec.code)
        let custom = PresenceCatalog.Entry(id: "made-up", name: "Made up", code: "function draw(){}")
        let withCode = PresenceSpec(bot: try bot(form: "made-up"), state: .idle, workers: 0, look: .onAir, size: 36, scale: 3, custom: custom)
        XCTAssertEqual(withCode.form, "made-up")
        XCTAssertNotNil(withCode.code)
        XCTAssertNotEqual(spec.stillKey, withCode.stillKey)
    }

    // MARK: Rendering (desktop's code in the sandboxed web view)

    private func scratch(_ name: String) -> URL {
        FileManager.default.temporaryDirectory.appending(path: "LookTests-\(name)-\(UUID())", directoryHint: .isDirectory)
    }

    /// Distinct colors in a coarse sample: a blank or one-color image has 1.
    private func distinctColors(_ image: UIImage) -> Int {
        guard let cg = image.cgImage else { return 0 }
        let w = 16, h = 16
        var pixels = [UInt8](repeating: 0, count: w * h * 4)
        let ctx = CGContext(data: &pixels, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(),
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        var seen = Set<UInt32>()
        for i in stride(from: 0, to: pixels.count, by: 4) {
            seen.insert(UInt32(pixels[i] >> 3) << 15 | UInt32(pixels[i + 1] >> 3) << 10 | UInt32(pixels[i + 2] >> 3) << 5 | UInt32(pixels[i + 3] >> 3))
        }
        return seen.count
    }

    private func centerPixel(_ image: UIImage) -> (r: UInt8, g: UInt8, b: UInt8, a: UInt8) {
        let cg = image.cgImage!
        var pixel = [UInt8](repeating: 0, count: 4)
        let ctx = CGContext(data: &pixel, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4, space: CGColorSpaceCreateDeviceRGB(),
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        ctx.draw(cg, in: CGRect(x: -CGFloat(cg.width) / 2 + 0.5, y: -CGFloat(cg.height) / 2 + 0.5, width: CGFloat(cg.width), height: CGFloat(cg.height)))
        return (pixel[0], pixel[1], pixel[2], pixel[3])
    }

    func testEverySceneRendersAStillWithDesktopsRendererAndCachesIt() async throws {
        let stills = SceneStills(directory: scratch("scenes"))
        let size = CGSize(width: 180, height: 390)
        for id in Self.scenes {
            let theme = LookCatalog.shared.theme(id)
            let image = await stills.still(theme: theme, mode: theme.variant(.dark).mode, size: size, scale: 1)
            let still = try XCTUnwrap(image, "\(id): \(stills.lastError ?? "no still")")
            XCTAssertEqual(still.size.width, size.width, accuracy: 1, id)
            XCTAssertGreaterThan(distinctColors(still), 3, "\(id) rendered a flat still")
        }
        XCTAssertEqual(stills.renders, Self.scenes.count)
        let again = await stills.still(theme: LookCatalog.shared.theme("event-horizon"), mode: .dark, size: size, scale: 1)
        XCTAssertNotNil(again)
        XCTAssertEqual(stills.renders, Self.scenes.count, "A second ask is served from the cache")
        stills.clearMemory()
        XCTAssertNotNil(stills.cached(SceneStills.key(theme: LookCatalog.shared.theme("event-horizon"), mode: .dark, size: size, scale: 1)), "and from disk")
    }

    func testEveryFormRendersEveryStateAsAStill() async throws {
        let stills = PresenceStills(directory: scratch("presence"))
        defer { stills.tearDown() }
        for form in PresenceSpec.builtinForms {
            for state in [BotPresenceState.idle, .thinking, .working, .needs] {
                let spec = PresenceSpec(bot: try bot(form: form), state: state, workers: 2, look: .onAir, size: 40, scale: 2)
                let rendered = await stills.still(spec)
                let image = try XCTUnwrap(rendered, "\(form) \(state)")
                XCTAssertEqual(image.size.width, 40, accuracy: 0.5)
                XCTAssertGreaterThan(distinctColors(image), 2, "\(form) \(state) is blank")
            }
        }
        XCTAssertEqual(stills.renders, PresenceSpec.builtinForms.count * 4)
    }

    func testLightThemeHaloAndAmberNeeds() async throws {
        let stills = PresenceStills(directory: scratch("halo"))
        defer { stills.tearDown() }
        let light = Look(theme: LookCatalog.shared.theme("github-light"), scheme: .light)
        let spec = PresenceSpec(bot: try bot(form: "orb"), state: .needs, workers: 0, look: light, size: 40, scale: 2)
        XCTAssertTrue(spec.surfaceLight)
        let rendered = await stills.still(spec)
        let image = try XCTUnwrap(rendered)
        let center = centerPixel(image)
        XCTAssertGreaterThan(Int(center.r), Int(center.b), "Needs you is amber")
    }

    /// An agent-made form runs in desktop's sandbox: a Worker with fetch,
    /// XMLHttpRequest, WebSocket and the rest removed, under connect-src 'none'.
    func testAgentMadeFormRunsSandboxedWithoutNetwork() async throws {
        let code = """
        function draw(ctx, t, state, palette, size) {
          var open = typeof fetch !== "undefined" || typeof XMLHttpRequest !== "undefined" || typeof WebSocket !== "undefined" || typeof importScripts !== "undefined";
          ctx.fillStyle = open ? "#ff0000" : "#00ff00";
          ctx.fillRect(0, 0, size, size);
        }
        """
        let stills = PresenceStills(directory: scratch("custom"))
        defer { stills.tearDown() }
        let entry = PresenceCatalog.Entry(id: "probe", name: "Probe", code: code)
        let spec = PresenceSpec(bot: try bot(form: "probe"), state: .idle, workers: 0, look: .onAir, size: 20, scale: 1, custom: entry)
        let rendered = await stills.still(spec)
        let image = try XCTUnwrap(rendered)
        let center = centerPixel(image)
        XCTAssertNil(stills.failures["probe"], "the module ran (no fallback)")
        XCTAssertGreaterThan(center.g, 200, "The sandbox drew; no network API was reachable")
        XCTAssertLessThan(center.r, 40)
    }

    func testABrokenAgentMadeFormFallsBackToTheTesseract() async throws {
        let stills = PresenceStills(directory: scratch("broken"))
        defer { stills.tearDown() }
        let entry = PresenceCatalog.Entry(id: "broken", name: "Broken", code: "function draw() { throw new Error('no') }")
        let spec = PresenceSpec(bot: try bot(form: "broken"), state: .working, workers: 1, look: .onAir, size: 30, scale: 1, custom: entry)
        let rendered = await stills.still(spec)
        let image = try XCTUnwrap(rendered)
        XCTAssertGreaterThan(distinctColors(image), 2)
        XCTAssertNotNil(stills.failures["broken"])
    }

    func testWidgetStillsAreWrittenPerBotAndState() async throws {
        let bot = try bot("bot_widget_test", form: "poly")
        let folder = PresenceStills.widgetFolder(botId: bot.id)
        try? FileManager.default.removeItem(at: folder)
        let stills = PresenceStills(directory: scratch("widgets"))
        defer { stills.tearDown(); try? FileManager.default.removeItem(at: folder) }
        await stills.exportForWidgets(bot: bot, look: .onAir, custom: nil, size: 20, scale: 2)
        for state in ["idle", "thinking", "working", "needs"] {
            XCTAssertTrue(FileManager.default.fileExists(atPath: folder.appending(path: state + ".png").path), state)
        }
        let before = stills.renders
        await stills.exportForWidgets(bot: bot, look: .onAir, custom: nil, size: 20, scale: 2)
        XCTAssertEqual(stills.renders, before, "Unchanged stills are not rendered again")
    }

    // MARK: Performance

    private func cpuSeconds() -> Double {
        var usage = rusage()
        getrusage(RUSAGE_SELF, &usage)
        return Double(usage.ru_utime.tv_sec) + Double(usage.ru_utime.tv_usec) / 1e6 + Double(usage.ru_stime.tv_sec) + Double(usage.ru_stime.tv_usec) / 1e6
    }

    private func pause(_ seconds: Double) async {
        try? await Task.sleep(for: .seconds(seconds))
    }

    /// A still scene is a UIImageView with a system motion effect: no web view,
    /// no timers, no frames. Over two idle seconds the app's CPU stays near zero.
    func testIdleStillCostsNearlyNothing() async throws {
        let stills = SceneStills(directory: scratch("idle"))
        let theme = LookCatalog.shared.theme("event-horizon")
        let rendered = await stills.still(theme: theme, mode: .dark, size: CGSize(width: 200, height: 400), scale: 1)
        let image = try XCTUnwrap(rendered)
        let window = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first)
        let host = UIHostingController(rootView: ParallaxImage(image: image, amount: 12).frame(width: 200, height: 400))
        host.view.frame = CGRect(x: 0, y: 0, width: 200, height: 400)
        window.addSubview(host.view)
        defer { host.view.removeFromSuperview() }
        await pause(0.5)
        let start = cpuSeconds(), clock = Date()
        await pause(2)
        let used = cpuSeconds() - start, wall = Date().timeIntervalSince(clock)
        let share = used / wall
        print("LOOK-PERF idle still: \(String(format: "%.1f", share * 100))% of one core over \(String(format: "%.1f", wall)) s")
        XCTAssertLessThan(share, 0.1, "An idle still should cost near zero")
    }

    /// The still renderer draws once and stops; live mode runs at the cap.
    func testSceneFrameTimeAndCap() async throws {
        let host = LookWebView(page: .scene, frame: CGRect(x: 0, y: 0, width: 200, height: 400))
        LookHosting.attach(host.webView)
        defer { host.tearDown() }
        let layout = PhoneSceneLayout(size: CGSize(width: 200, height: 400))
        let started = try await host.call("return BBLook.scene.start(options)", ["options": layout.arguments(theme: "event-horizon", mode: .dark, scale: 1, live: false, signals: nil)]) as? [String: Any]
        XCTAssertEqual(started?["ok"] as? Bool, true, "\(started ?? [:])")
        await pause(1)
        let still = try await host.call("return BBLook.scene.stats()") as? [String: Any]
        XCTAssertEqual(still?["running"] as? Bool, false, "A still has no frame loop")
        let stillFrames = still?["frames"] as? Int ?? -1
        XCTAssertLessThanOrEqual(stillFrames, 2)
        try await host.call("BBLook.scene.setLive(true, 30)")
        await pause(2)
        try await host.call("BBLook.scene.setLive(false)")
        let stats = try await host.call("return BBLook.scene.stats()")
        let live = try XCTUnwrap(stats as? [String: Any])
        let frames = (live["frames"] as? Int ?? 0) - stillFrames - 1
        let ms = (live["drawMs"] as? Double ?? 0) / Double(max(1, frames))
        print("LOOK-PERF live scene: \(frames) frames in 2 s (cap 30/s), \(String(format: "%.2f", ms)) ms of JS per frame (the GPU draws asynchronously)")
        XCTAssertLessThanOrEqual(frames, 66, "Live scenes are capped at 30 frames a second")
        XCTAssertGreaterThan(frames, 0, "Live mode draws")
    }

    static func edgeAlpha(_ image: UIImage) -> UInt8 {
        guard let cg = image.cgImage else { return 255 }
        let w = cg.width, h = cg.height
        var pixels = [UInt8](repeating: 0, count: w * h * 4)
        let ctx = CGContext(data: &pixels, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        var top: UInt8 = 0
        for x in 0..<w { for y in [0, h - 1] { top = max(top, pixels[(y * w + x) * 4 + 3]) } }
        for y in 0..<h { for x in [0, w - 1] { top = max(top, pixels[(y * w + x) * 4 + 3]) } }
        return top
    }

    func testNoFormIsCutOffAtTheRoomsHeadroom() async throws {
        let stills = PresenceStills(directory: scratch("room"))
        defer { stills.tearDown() }
        var report: [String] = []
        for room in ProcessInfo.processInfo.environment["PRESENCE_ROOMS"].map({ $0.split(separator: ",").compactMap { Double($0) } }) ?? [Double(PresenceSpec.roomHeadroom)] {
            var clipped: [String] = []
            for form in PresenceSpec.builtinForms {
                for state in [BotPresenceState.idle, .thinking, .working, .needs] {
                    for time in stride(from: 0.0, to: 30, by: 2.1) {
                        var spec = PresenceSpec(bot: try bot(form: form), state: state, workers: 2, look: .onAir, size: 120, scale: 1)
                        spec.room = CGFloat(room)
                        spec.time = time
                        let rendered = await stills.still(spec)
                        let image = try XCTUnwrap(rendered, "\(form) \(state) \(time)")
                        XCTAssertEqual(image.size.width, 120 * CGFloat(room), accuracy: 1)
                        if Self.edgeAlpha(image) > 8 { clipped.append("\(form)/\(state)@\(time)"); break }
                    }
                }
            }
            report.append("room \(room): \(clipped.isEmpty ? "none cut off" : clipped.joined(separator: " "))")
            if room == Double(PresenceSpec.roomHeadroom) { XCTAssertEqual(clipped, [], "cut off at the room's headroom") }
        }
        print("PRESENCE-ROOM " + report.joined(separator: " | "))
    }
}
