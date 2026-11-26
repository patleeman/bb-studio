import SwiftUI

/// One design, kept fresh: agents write a round a screen at a time, and the
/// Studio `design` signal says when; a reconnect may have missed some, so
/// that reloads too. The view, the player and the comments share it.
@MainActor
final class DesignModel: ObservableObject {
    let id: String
    @Published private(set) var design: StudioDesign?
    @Published private(set) var missing = false
    @Published private(set) var error: String?
    private let client: BBClient
    private var listener: UUID?
    private weak var realtime: BBRealtime?
    /// Each signal starts a load; only the newest one may show its answer.
    private var loads = 0

    init(id: String, client: BBClient? = nil) {
        self.id = id
        self.client = client ?? ServerOperation().client
    }

    var comments: [DesignComment] { design?.allComments ?? [] }
    var openComments: [DesignComment] { comments.filter { !$0.resolved } }

    func attach(_ realtime: BBRealtime) {
        detach()
        self.realtime = realtime
        listener = realtime.listen { [weak self] event in
            guard let self else { return }
            switch event {
            case .pluginSignal("studio", "design", let payload) where payload["designId"]?.stringValue == id: Task { await self.load() }
            case .connected: Task { await self.load() }
            default: break
            }
        }
    }

    func detach() {
        if let listener { realtime?.removeListener(listener) }
        listener = nil
    }

    func load() async {
        loads += 1
        let load = loads
        do {
            let found = try await client.design(id)
            guard load == loads else { return }
            if let found {
                if found != design { design = found }
                error = nil
            } else {
                missing = true
            }
        } catch {
            guard load == loads else { return }
            if design == nil { self.error = BBClient.describe(error, server: client.baseURL) }
        }
    }

    /// Runs a change and reloads; the error's text when it failed.
    @discardableResult
    func run(_ change: (BBClient) async throws -> Void) async -> String? {
        do {
            try await change(client)
            await load()
            return nil
        } catch {
            return BBClient.describe(error, plugin: "Studio", server: client.baseURL)
        }
    }

    func screenURL(_ screen: DesignScreen, step: String? = nil) -> URL { client.designScreenURL(id, screen, step: step) }
    var api: BBClient { client }
}
