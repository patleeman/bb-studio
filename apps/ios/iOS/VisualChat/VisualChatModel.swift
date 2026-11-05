import Foundation
import SwiftUI

/// One Visual Chat, kept current as the desktop page keeps it (use-canvas.ts):
/// canvas.get on open, on every `canvas:updated` and when a stream ends; the
/// page being written from `canvas:stream`; older answers never replace newer
/// ones. A new chat has no thread until its first message (canvas.create).
@MainActor
final class VisualChatModel: ObservableObject {
    typealias Canvas = VisualChat.CanvasGetOutputCanvas
    typealias Version = VisualChat.CanvasVersionOutputVersion

    let client: BBClient
    @Published private(set) var threadId: String?
    @Published private(set) var canvas: Canvas?
    @Published private(set) var loaded = false
    @Published private(set) var stream: VisualChatStream?
    @Published private(set) var viewing: Int?
    @Published private(set) var snapshots: [Int: Version] = [:]
    @Published private(set) var renderer: VisualChatRenderer?
    @Published private(set) var pending: String?
    @Published var error: String?

    private var listener: UUID?
    private weak var realtime: BBRealtime?
    private var ticket = 0
    private var seenRev = -1
    private var started = false

    init(client: BBClient, threadId: String?) {
        self.client = client
        self.threadId = threadId
        loaded = threadId == nil
    }

    // MARK: Loading

    func attach(_ realtime: BBRealtime) {
        guard self.realtime !== realtime else { return }
        if let listener { self.realtime?.removeListener(listener) }
        self.realtime = realtime
        listener = realtime.listen { [weak self] event in
            guard let self else { return }
            switch event {
            case .pluginSignal(VisualChatPlugin.id, VisualChatPlugin.channel, let payload):
                self.signal(payload)
            case .connected:
                Task { await self.load() }
            default:
                break
            }
        }
    }

    func detach() {
        if let listener { realtime?.removeListener(listener) }
        listener = nil
    }

    func signal(_ payload: JSONValue) {
        guard let threadId, payload["threadId"]?.stringValue == threadId else { return }
        switch payload["type"]?.stringValue {
        case VisualChatPlugin.updated:
            Task { await load() }
        case VisualChatPlugin.stream:
            stream = VisualChatStream.reduce(stream, signal: payload)
            if payload["done"]?.vcBool == true { Task { await load() } }
        default:
            break
        }
    }

    func load() async {
        guard let threadId else { return }
        ticket += 1
        let mine = ticket
        do {
            let output: VisualChat.CanvasGetOutput = try await client.rpc(VisualChatPlugin.id, VisualChat.Method.canvas_get, ["threadId": .string(threadId)])
            guard threadId == self.threadId else { return }
            let rev = output.canvas?.rev.map(Int.init) ?? -1
            // Never back a revision; a stale answer for the same one only when it's the latest asked.
            if output.canvas != nil, rev < seenRev || (rev == seenRev && mine != ticket) { return }
            seenRev = max(seenRev, rev)
            canvas = output.canvas
            if !started, let canvas = output.canvas {
                // Open where the user left it (the server remembers), once per chat.
                started = true
                viewing = canvas.viewing.map(Int.init)
            }
            stream = VisualChatStream.settle(stream, rev: rev, working: working)
            error = nil
        } catch where BBClient.isCancellation(error) {
        } catch {
            if canvas == nil { self.error = BBClient.describe(error, server: client.baseURL) }
        }
        loaded = true
        await fetchShown()
    }

    /// The board renderer, from the kept copy or the server (canvas.renderer).
    func loadRenderer(cache: VisualChatRendererCache = .standard) async {
        guard renderer == nil else { return }
        do {
            let client = client
            renderer = try await cache.resolve(server: client.baseURL) { have in
                let output: VisualChat.CanvasRendererOutput = try await client.rpc(
                    VisualChatPlugin.id, VisualChat.Method.canvas_renderer, .object(omittingNil: ["version": have.map(JSONValue.string)]))
                guard let version = output.version else { throw VisualChatError("The server sent no renderer version.") }
                return (version, output.js)
            }
        } catch {
            self.error = "Couldn't load the board: \(BBClient.describe(error, server: client.baseURL))"
        }
    }

    // MARK: What shows

    var working: Bool { canvas?.status == .working || pending != nil }

    var timeline: VisualChatTimeline {
        let versions = (canvas?.versions ?? []).compactMap { version -> VisualChatTimeline.Version? in
            guard let n = version.n, let rev = version.rev else { return nil }
            return .init(n: Int(n), rev: Int(rev), prompt: version.prompt, caption: version.caption)
        }
        return VisualChatTimeline(versions: versions, liveRev: canvas?.rev.map(Int.init) ?? 0, working: working, viewing: viewing)
    }

    /// The old version on screen (nil: the live board, or one still loading).
    var snapshot: Version? { timeline.shown.flatMap { snapshots[$0] } }

    var title: String { snapshot?.title ?? canvas?.title ?? "New visual chat" }

    /// The caption under the board: an old version's, else what's being worked on while a turn works, else the
    /// agent's latest. `asking`: it's the user's own words, shown while the agent answers.
    var caption: (text: String, asking: Bool)? {
        if timeline.shown != nil { return (snapshot?.caption ?? snapshot?.prompt).map { ($0, false) } }
        if let pending { return (pending, true) }
        if working, let asked = (canvas?.history ?? []).last(where: { $0.role == "user" })?.text { return (asked, true) }
        return canvas?.caption.map { ($0, false) }
    }

    /// The page to draw (an old version's, or the live one) and the page being written, on the live board only.
    var page: String? { timeline.shown != nil ? snapshot?.page : canvas?.page }
    var livestream: VisualChatStream? { timeline.shown == nil ? stream : nil }

    /// The style to draw in: a page always has one (a board from before styles takes the default).
    var look: String {
        let raw = (timeline.shown != nil ? snapshot?.look.map(Self.lookName) : canvas?.look.map(Self.lookName)) ?? "editorial"
        return ["editorial", "field", "instrument"].contains(raw) ? raw : "editorial"
    }

    /// A board from before pages (items only): the phone doesn't draw those.
    var isItemsBoard: Bool {
        guard timeline.shown == nil, let canvas, canvas.page == nil, stream == nil else { return false }
        return !(canvas.items ?? []).isEmpty
    }

    private static func lookName(_ look: VisualChat.CanvasGetOutputCanvasLook) -> String {
        switch look {
        case .editorial: "editorial"
        case .field: "field"
        case .instrument: "instrument"
        case .classic: "classic"
        case .unknown(let value): value
        }
    }

    private static func lookName(_ look: VisualChat.CanvasVersionOutputVersionLook) -> String {
        switch look {
        case .editorial: "editorial"
        case .field: "field"
        case .instrument: "instrument"
        case .classic: "classic"
        case .unknown(let value): value
        }
    }

    // MARK: Versions

    func step(_ delta: Int) {
        guard let threadId, let target = timeline.step(delta) else { return }
        viewing = target
        let input: JSONValue = ["threadId": .string(threadId), "n": target.map { .from($0) } ?? .null]
        let client = client
        Task {
            let _: VisualChat.CanvasViewOutput? = try? await client.rpc(VisualChatPlugin.id, VisualChat.Method.canvas_view, input)
        }
        Task { await fetchShown() }
    }

    private func fetchShown() async {
        guard let threadId, let n = timeline.shown, snapshots[n] == nil else { return }
        do {
            let output: VisualChat.CanvasVersionOutput = try await client.rpc(
                VisualChatPlugin.id, VisualChat.Method.canvas_version, ["threadId": .string(threadId), "n": .from(n)])
            if let version = output.version, let got = version.n { snapshots[Int(got)] = version }
        } catch {}
    }

    // MARK: Sending

    /// Sends a message: a new chat's first (canvas.create, on the default model), or the next one, continuing
    /// from the version on screen when it's an old one.
    func send(_ text: String, client hint: VisualChatClient) async -> Bool {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return false }
        pending = text
        do {
            if let threadId {
                let from = timeline.shown
                let input = JSONValue.object(omittingNil: [
                    "threadId": .string(threadId), "text": .string(text), "client": hint.json, "fromVersion": from.map { .from($0) },
                ])
                let output: VisualChat.CanvasSendOutput = try await client.rpc(VisualChatPlugin.id, VisualChat.Method.canvas_send, input)
                viewing = nil
                // After a provider switch the chat has a fresh thread: follow it.
                if let next = output.threadId, next != threadId { follow(next) }
            } else {
                let output: VisualChat.CanvasCreateOutput = try await client.rpc(
                    VisualChatPlugin.id, VisualChat.Method.canvas_create, ["text": .string(text), "client": hint.json])
                guard let next = output.threadId else { throw VisualChatError("The chat wasn't made.") }
                follow(next)
            }
            await load()
            pending = nil
            return true
        } catch {
            pending = nil
            self.error = BBClient.describe(error, server: client.baseURL)
            return false
        }
    }

    private func follow(_ next: String) {
        threadId = next
        seenRev = -1
        ticket += 1
        stream = nil
        snapshots = [:]
        started = true
    }

    /// A webpage part's check (canvas.webpage), as the renderer wants it; nil when it can't be asked.
    func webpage(_ url: String) async -> JSONValue? {
        guard let threadId else { return nil }
        return try? await client.rpc(VisualChatPlugin.id, VisualChat.Method.canvas_webpage, ["threadId": .string(threadId), "url": .string(url)])
    }
}
