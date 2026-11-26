import SwiftUI
import UIKit

/// The Workbenches of the conversations on screen: each one's tabs from
/// Studio (`threadWorkbenchGet`), refetched on `workbench-changed`, changed
/// with `threadWorkbenchMutate` (a conflict re-reads and tries once more).
@MainActor @Observable
final class WorkbenchStore {
    static let shared = WorkbenchStore()

    private(set) var states: [String: WorkspaceState] = [:]
    /// Studio without the Workbench answers "unknown method": no tabs, and New tab says so.
    private(set) var unsupported = false
    /// The tab each conversation shows, picked on this phone.
    private var picked: [String: String] = [:]
    /// Heavy tab views kept loaded, newest first (at most two).
    private(set) var mounted: [String] = []
    var lastError: String?
    @ObservationIgnored private var listener: UUID?
    @ObservationIgnored private weak var realtime: BBRealtime?
    private var client: BBClient { AppModel.shared.client }

    /// `phone:<device>`: Studio tells this phone's own changes from others'.
    static var origin: String { "phone:" + (UIDevice.current.identifierForVendor?.uuidString ?? "unknown") }

    func tabs(_ threadId: String) -> [WorkspaceTab] { states[threadId]?.tabs ?? [] }
    func count(_ threadId: String) -> Int { tabs(threadId).count }

    /// The tab shown: picked here, else Studio's active one, else the first.
    func selected(_ threadId: String) -> WorkspaceTab? {
        Self.selected(tabs(threadId), picked: picked[threadId], active: states[threadId]?.activeTabId)
    }

    nonisolated static func selected(_ tabs: [WorkspaceTab], picked: String?, active: String?) -> WorkspaceTab? {
        tabs.first { $0.id == picked } ?? tabs.first { $0.id == active } ?? tabs.first
    }

    func attach(_ realtime: BBRealtime) {
        guard realtime !== self.realtime else { return }
        if let listener { self.realtime?.removeListener(listener) }
        self.realtime = realtime
        listener = realtime.listen { [weak self] event in
            guard let self else { return }
            switch event {
            case .pluginSignal("studio", Studio.Channel.workbench_changed, let payload):
                guard let threadId = payload["threadId"]?.stringValue, self.states[threadId] != nil else { return }
                let version = payload["version"]?.numberValue.map { Int($0) } ?? .max
                if version > (self.states[threadId]?.version ?? -1) { Task { await self.load(threadId) } }
            case .connected:
                for threadId in self.states.keys { Task { await self.load(threadId) } }
            default:
                break
            }
        }
    }

    func load(_ threadId: String) async {
        guard !unsupported else { return }
        #if DEBUG
        if let demo = WorkbenchDemo.state(threadId) {
            if states[threadId] == nil { states[threadId] = demo }
            return
        }
        #endif
        do {
            guard let next = try await client.workspace(threadId: threadId) else { return }
            if states[threadId] != next { states[threadId] = next }
            prune(threadId)
        } catch where BBClient.isUnknownRPC(error) {
            unsupported = true
        } catch {}
    }

    /// Shows a tab; a heavy one joins the loaded views, pushing out the oldest.
    func select(_ id: String, in threadId: String) {
        guard let tab = tabs(threadId).first(where: { $0.id == id }) else { return }
        picked[threadId] = id
        mounted = WorkspaceMounted.touch(mounted, id, heavy: tab.heavy)
        Task { await mutate(threadId, op: "focus", tabId: id) }
    }

    func close(_ id: String, in threadId: String) {
        let tabs = tabs(threadId)
        if selected(threadId)?.id == id, let at = tabs.firstIndex(where: { $0.id == id }) {
            // The neighbour takes its place, as on the desktop.
            let rest = tabs.filter { $0.id != id }
            picked[threadId] = rest.isEmpty ? nil : rest[min(at, rest.count - 1)].id
        }
        mounted.removeAll { $0 == id }
        if var state = states[threadId] {
            state.tabs.removeAll { $0.id == id }
            if state.activeTabId == id { state.activeTabId = nil }
            states[threadId] = state
        }
        Task { await mutate(threadId, op: "close", tabId: id) }
    }

    /// Opens a Studio item as a tab, and shows it.
    func open(_ ref: WorkspaceTab.Ref, title: String, in threadId: String) {
        Task {
            if let (_, tabId) = await mutate(threadId, op: "open", ref: ref, title: title, focus: true), let tabId {
                select(tabId, in: threadId)
            }
        }
    }

    @discardableResult
    private func mutate(_ threadId: String, op: String, tabId: String? = nil, ref: WorkspaceTab.Ref? = nil, title: String? = nil,
                        focus: Bool? = nil) async -> (WorkspaceResult, String?)? {
        guard !unsupported else { return nil }
        #if DEBUG
        if WorkbenchDemo.state(threadId) != nil { return WorkbenchDemo.mutate(self, threadId, op: op, tabId: tabId, ref: ref, title: title) }
        #endif
        for attempt in 0..<2 {
            let base = states[threadId]?.version ?? 0
            do {
                let (next, result, message) = try await client.mutateWorkspace(
                    threadId: threadId, baseVersion: base, op: op, tabId: tabId, ref: ref, title: title, focus: focus, origin: Self.origin)
                states[threadId] = next
                prune(threadId)
                switch result {
                case .conflict where attempt == 0: continue
                case .refused, .notFound: lastError = message ?? "Studio didn't change the Workbench"
                default: break
                }
                return (result, next.activeTabId ?? tabId)
            } catch {
                lastError = BBClient.describe(error, server: client.baseURL)
                return nil
            }
        }
        return nil
    }

    private func prune(_ threadId: String) {
        let ids = Set(tabs(threadId).map(\.id))
        if let shown = picked[threadId], !ids.contains(shown) { picked[threadId] = nil }
        let all = Set(states.values.flatMap { $0.tabs.map(\.id) })
        mounted = WorkspaceMounted.prune(mounted, keeping: all)
    }

    #if DEBUG
    fileprivate func setDemo(_ state: WorkspaceState) { states[state.threadId] = state }
    #endif
}

/// Tells Studio which conversations this phone shows (`threadWorkbenchShown`),
/// every 6 s while the app is in front and a conversation is on screen, so an
/// agent's `workbench_open` counts the phone as on-screen. Studio forgets after 12 s.
@MainActor
final class WorkbenchShown {
    static let shared = WorkbenchShown()
    private var shown: [String: Int] = [:]
    private var loop: Task<Void, Never>?

    func show(_ threadId: String) {
        shown[threadId, default: 0] += 1
        start()
    }

    func hide(_ threadId: String) {
        guard let count = shown[threadId] else { return }
        if count <= 1 { shown[threadId] = nil } else { shown[threadId] = count - 1 }
        if shown.isEmpty {
            loop?.cancel()
            loop = nil
        }
    }

    private func start() {
        guard loop == nil else { return }
        loop = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                let ids = Array(self.shown.keys)
                if !ids.isEmpty, UIApplication.shared.applicationState == .active, !WorkbenchStore.shared.unsupported {
                    try? await AppModel.shared.client.workspaceShown(threadIds: ids, origin: WorkbenchStore.origin)
                }
                // Not backed off by the idle gate: Studio forgets after 12 s. EnergyGate still holds it while in the background.
                await EnergyGate.shared.pollWait(.seconds(6), backsOff: false)
            }
        }
    }
}

#if DEBUG
/// `-qaWorkbenchDemo` (with `-qaPageDemo` for the page tab): a Workbench
/// offline, two tabs the agent opened and two of yours; open and close
/// change it here.
@MainActor
enum WorkbenchDemo {
    static var on: Bool { ProcessInfo.processInfo.arguments.contains("-qaWorkbenchDemo") }
    private static var states: [String: WorkspaceState] = [:]

    static func state(_ threadId: String) -> WorkspaceState? {
        guard on else { return nil }
        if let state = states[threadId] { return state }
        let state = WorkspaceState(threadId: threadId, tabs: [
            WorkspaceTab(id: "tab-budget", ref: .init(kind: "page", id: "qa-demo"), title: "Lisbon budget", position: 0,
                         openedByAgent: true, support: .native),
            WorkspaceTab(id: "tab-stills", ref: .init(kind: "design", id: "dsn_demo_stills"), title: "Theme stills", position: 1,
                         openedByAgent: true, support: .native),
            WorkspaceTab(id: "tab-site", ref: .init(kind: "browser", url: "https://example.com"), title: "example.com", position: 2,
                         support: .web),
            WorkspaceTab(id: "tab-code", ref: .init(kind: "vscode", path: "ios/README.md"), title: "README.md", position: 3,
                         support: .desktopOnly),
        ], activeTabId: nil, version: 1)
        states[threadId] = state
        return state
    }

    static func mutate(_ store: WorkbenchStore, _ threadId: String, op: String, tabId: String?, ref: WorkspaceTab.Ref?,
                       title: String?) -> (WorkspaceResult, String?) {
        guard var state = states[threadId] else { return (.ok, tabId) }
        switch op {
        case "close": state.tabs.removeAll { $0.id == tabId }
        case "open":
            guard let ref else { break }
            let id = "tab-\(state.version + 1)"
            state.tabs.append(WorkspaceTab(id: id, ref: ref, title: title ?? ref.kind, position: state.tabs.count))
            state.activeTabId = id
            state.version += 1
            states[threadId] = state
            store.setDemo(state)
            return (.ok, id)
        default: break
        }
        state.version += 1
        states[threadId] = state
        store.setDemo(state)
        return (.ok, tabId)
    }
}
#endif
