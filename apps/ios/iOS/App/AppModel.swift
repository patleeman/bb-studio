import Foundation
import SwiftUI
import UIKit
import UserNotifications

enum Route: Hashable {
    case thread(id: String)
    case pages
    case page(id: String)
    case automations
    case automation(Automation)
    case usage
    case archived
    /// A Space's archived threads.
    case spaceArchived(id: String)
    case drawings
    case drawing(id: String)
    case recording(id: String)
    case artifact(id: String)
    case table(id: String)
    case design(id: String)
    case terminals(scope: TerminalScope, title: String)
}

extension Route {
    /// A Studio add-on's BB web path: `/plugins/pages/pages/<id>` and the like.
    init?(href: String) {
        let parts = (URL(string: href)?.path() ?? href).split(separator: "/").map(String.init)
        guard parts.count == 4, parts[0] == "plugins" else { return nil }
        let id = parts[3]
        switch (parts[1], parts[2]) {
        case ("pages", "pages"): self = .page(id: id)
        case ("artifacts", "artifacts"): self = .artifact(id: id)
        case ("excalidraw", "drawings"): self = .drawing(id: id)
        case ("talk", "recordings"): self = .recording(id: id)
        case ("studio-tables", "tables"): self = .table(id: id)
        case ("design", "designs"): self = .design(id: id)
        default: return nil
        }
    }
}

enum Sheet: Identifiable, Hashable {
    case capture
    case dictation(threadId: String?, autoStart: Bool)
    case recording
    case voiceChat(threadId: String)
    case write

    var id: String {
        switch self {
        case .capture: "capture"
        case .dictation(let threadId, _): "dictation:\(threadId ?? "")"
        case .recording: "recording"
        case .voiceChat(let threadId): "voice:\(threadId)"
        case .write: "write"
        }
    }
}

enum Tab: Hashable {
    case inbox, studio, chief, settings
}

@MainActor
final class AppModel: ObservableObject {
    static let shared = AppModel()

    @Published private(set) var client: BBClient
    @Published private(set) var realtime: BBRealtime
    @Published var tab: Tab = .inbox
    @Published var path: [Route] = []
    @Published var studioPath: [Route] = []
    /// The Studio tab's kind filter; nil for everything.
    @Published var studioKind: String?
    /// The Studio tab's space filter; nil for every space.
    @Published var studioSpace: String?
    /// The Space Home shows in By space: a Space id, `all`, or nil to follow the web sidebar's.
    @Published var homeSpace: String? {
        didSet { UserDefaults.standard.set(homeSpace, forKey: ServerScope.key("homeSpace", serverURL: serverURL)) }
    }
    /// The project New Thread starts in, set by a Space's New Thread Here.
    @Published var newThreadSpace: String?
    @Published var sheet: Sheet?
    @Published var notificationError: String?
    /// A brief message over the whole app for something that went partly wrong, like Studio's flash.
    @Published private(set) var notice: String?
    /// Opens the new-thread composer, optionally prefilled.
    @Published var newThreadDraft: String?
    /// Set by `bbstudio://reply/<id>`; that thread focuses its composer.
    @Published var replyThreadId: String?

    /// The last thread opened, so the action button can resume a voice chat with it.
    var lastThreadId: String {
        get { UserDefaults.standard.string(forKey: ServerScope.key("lastThreadId", serverURL: serverURL)) ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: ServerScope.key("lastThreadId", serverURL: serverURL)) }
    }

    private init() {
        let client = BBClient()
        self.client = client
        realtime = BBRealtime(client: client)
        homeSpace = UserDefaults.standard.string(forKey: ServerScope.key("homeSpace", serverURL: client.baseURL))
        // Started when the scene becomes active, so a background launch (a watch
        // relay, a Live Activity token) doesn't open a socket.
        realtime.subscribeThreadList()
        flushOutboxOnConnect()
    }

    var serverURL: URL { client.baseURL }

    func setServerURL(_ url: URL) {
        guard url != serverURL else { return }
        // Load legacy queues so their unknown origins are quarantined.
        _ = Outbox.shared
        _ = TalkOutbox.shared
        BBClient.storedServerURL = url
        StudioStore.shared = StudioStore()
        PagesStore.shared = PagesStore()
        MutedThreads.shared = MutedThreads()
        ThreadTitles.store.titles = [:]
        Spotlight.reset()
        StatusWidgets.reset()
        PhoneRelay.shared.pushStatus([])
        studioKind = nil
        studioSpace = nil
        sheet = nil
        realtime.stop()
        client = BBClient(baseURL: url)
        homeSpace = UserDefaults.standard.string(forKey: ServerScope.key("homeSpace", serverURL: url))
        realtime = BBRealtime(client: client)
        realtime.start()
        realtime.subscribeThreadList()
        flushOutboxOnConnect()
        path = []
        studioPath = []
        newThreadDraft = nil
        newThreadSpace = nil
        replyThreadId = nil
        Outbox.shared.flush()
        TalkOutbox.shared.kick()
        registerPushWithNewServer()
    }

    /// The phone registers its push token at launch, with the server selected then.
    /// Register again so the new server can notify this phone before the next launch.
    private func registerPushWithNewServer() {
        #if !targetEnvironment(simulator)
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            guard [UNAuthorizationStatus.authorized, .provisional, .ephemeral].contains(settings.authorizationStatus) else { return }
            DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
        }
        #endif
    }

    /// The socket keeps the radio awake, and nothing shows its updates in the
    /// background: close it there and reconnect (which refetches) on return.
    /// Voice chat keeps it, since it waits on replies with the screen locked.
    func scenePhaseChanged(_ phase: ScenePhase) {
        switch phase {
        case .background:
            if case .voiceChat = sheet { return }
            realtime.stop()
        case .active:
            realtime.start()
        default:
            break
        }
    }

    private func flushOutboxOnConnect() {
        _ = realtime.listen { event in
            if case .connected = event { Outbox.shared.flush() }
        }
    }

    /// `bbstudio://thread/<id>`, `bbstudio://reply/<id>`, `bbstudio://page/<id>`, `bbstudio://automations`, `bbstudio://usage`, `bbstudio://archived`, `bbstudio://drawing[/<id>]`, `bbstudio://artifact/<id>`, `bbstudio://space/<id>`,
    /// `bbstudio://capture`, `bbstudio://dictate`, `bbstudio://voice[/<id>]`, `bbstudio://studio` (or `talk`), `bbstudio://web`.
    func handle(_ url: URL) {
        guard AppLink.handles(url), AppLink.acceptsOrigin(url, serverURL: serverURL) else { return }
        let id = url.pathComponents.dropFirst().first
        switch url.host() {
        case "capture": sheet = .capture
        case "thread": if let id { openThread(id) }
        case "reply":
            if let id {
                openThread(id)
                replyThreadId = id
            }
        case "page": if let id { openPage(id) }
        case "automations": open(.automations)
        case "usage": open(.usage)
        case "archived": open(.archived)
        case "drawing", "drawings": openStudio(kind: "drawing", id.map { .drawing(id: $0) })
        case "pages": openStudio(kind: "page")
        case "recording", "recordings": openStudio(kind: "recording", id.map { .recording(id: $0) })
        case "artifact", "artifacts": openStudio(kind: "artifact", id.map { .artifact(id: $0) })
        case "design", "designs": openStudio(kind: "design", id.map { .design(id: $0) })
        case "space": if let id { openSpace(id) }
        case "dictate": startDictation(threadId: id)
        case "record": sheet = .recording
        case "write": sheet = .write
        case "voice": startVoiceChat(threadId: id)
        case "new": newThread()
        case "studio", "talk": openStudio(kind: nil)
        case "chief", "web": tab = .chief
        case "settings": tab = .settings
        case "file": break  // Opened by the thread view, which knows the workspace.
        default: tab = .inbox
        }
    }

    /// `space` starts it in that Space's project and puts it in the Space.
    func newThread(text: String = "", space: String? = nil) {
        tab = .inbox
        newThreadSpace = space
        newThreadDraft = text
    }

    /// The Space in By space Home (its lead, open items and threads); otherwise Studio
    /// filtered to it, since Home shows Spaces only in By space. An id Studio doesn't
    /// know opens Home without remembering it.
    func openSpace(_ id: String) {
        let client = client
        spaceLink?.cancel()
        spaceLink = Task {
            async let preferences = try? client.sidebarPreferences()
            async let spaces = try? client.studioSpaces()
            let target = Self.spaceLinkTarget(id, organizationMode: await preferences?.organizationMode, spaces: await spaces)
            guard !Task.isCancelled, client.baseURL == serverURL else { return }
            switch target {
            case .home(let id):
                tab = .inbox
                path = []
                homeSpace = id
            case .studio(let id):
                openStudio(space: id)
            case .unknown:
                tab = .inbox
                path = []
            }
        }
    }

    private var spaceLink: Task<Void, Never>?

    enum SpaceLinkTarget: Equatable {
        case home(String), studio(String), unknown
    }

    /// Home in By space (as the web sidebar decides), Studio otherwise; nil `spaces` means Studio didn't answer.
    static func spaceLinkTarget(_ id: String, organizationMode: String?, spaces: [StudioSpace]?) -> SpaceLinkTarget {
        guard let spaces, !spaces.isEmpty else { return .unknown }
        let known = spaces.contains { $0.id == id }
        if organizationMode == "space" { return known || id == "all" ? .home(id) : .unknown }
        return known ? .studio(id) : .unknown
    }

    func openThread(_ id: String) {
        tab = .inbox
        path = [.thread(id: id)]
    }

    func open(_ route: Route) {
        tab = .inbox
        path = [route]
    }

    /// Onto the stack of the tab showing, so Back returns where you were.
    func push(_ route: Route) {
        if tab == .studio {
            studioPath.append(route)
        } else {
            tab = .inbox
            path.append(route)
        }
    }

    func openPage(_ id: String) {
        openStudio(kind: nil, .page(id: id))
    }

    func openStudio(kind: String?, _ route: Route? = nil) {
        tab = .studio
        if let kind { studioKind = kind }
        studioPath = route.map { [$0] } ?? []
    }

    /// Studio's collection, showing only what a space holds.
    func openStudio(space id: String) {
        studioKind = nil
        studioSpace = id
        openStudio(kind: nil)
    }

    /// Shows `message` at the bottom of the app for a few seconds.
    func flash(_ message: String) {
        notice = message
        Task {
            try? await Task.sleep(for: .seconds(4))
            if notice == message { notice = nil }
        }
    }

    func startDictation(threadId: String? = nil) {
        sheet = .dictation(threadId: threadId, autoStart: true)
    }

    func startVoiceChat(threadId: String? = nil) {
        guard let id = threadId ?? (lastThreadId.isEmpty ? nil : lastThreadId) else {
            tab = .inbox
            return
        }
        sheet = .voiceChat(threadId: id)
    }
}
