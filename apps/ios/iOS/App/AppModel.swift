import Foundation
import SwiftUI

enum Route: Hashable {
    case thread(id: String)
    case savedView(id: String)
    case pages
    case page(id: String)
    case automations
    case automation(Automation)
    case usage
    case archived
    case drawings
    case drawing(id: String)
    case recording(id: String)
    case artifact(id: String)
    case tasks
    case task(id: String)
    case table(id: String)
    case terminals(scope: TerminalScope, title: String)
    case bot(id: String)
    /// A Studio space, which opens its page.
    case space(id: String)
    case feed
    case feedPost(id: String)
    /// Every Studio item, filtered by kind; reached from Work and Search.
    case studioCollection
    /// A bot's desk in the office: its DM, tasks and profile.
    case botDesk(id: String)
    /// The Space's Home: what needs you, what the team is doing, what came back.
    case officeHome
    /// The Space's bots and conversations.
    case officeTeam
}

extension Route {
    /// A Studio add-on's BB web path: `/plugins/pages/pages/<id>` and the like.
    init?(href: String) {
        let parts = (URL(string: href)?.path() ?? href).split(separator: "/").map(String.init)
        if parts.count == 2, parts[0] == "threads" {
            self = .thread(id: parts[1])
            return
        }
        if (parts == ["plugins", "feed", "feed"] || parts == ["plugins", "studio", "feed"]) {
            self = .feed
            return
        }
        if parts.count == 5, parts[0] == "plugins", parts[1...3] == ["studio", "studio", "space"] {
            self = .space(id: parts[4].removingPercentEncoding ?? parts[4])
            return
        }
        guard parts.count == 4, parts[0] == "plugins" else { return nil }
        let id = parts[3]
        switch (parts[1], parts[2]) {
        case ("pages", "pages"): self = .page(id: id)
        case ("studio", "artifacts"), ("artifacts", "artifacts"): self = .artifact(id: id)
        case ("excalidraw", "drawings"): self = .drawing(id: id)
        case ("studio", "recordings"), ("talk", "recordings"): self = .recording(id: id)
        case ("studio-tasks", "tasks"), ("studio", "tasks"): self = .task(id: id)
        case ("studio-tables", "tables"), ("studio", "tables"): self = .table(id: id)
        case ("bot-teams", "bots"), ("studio", "bots"): self = .bot(id: id)
        // Channels lived at /views/<id>; both open the same channel.
        case ("bot-teams", "channels"), ("bot-teams", "views"), ("studio", "channels"), ("studio", "views"): self = .savedView(id: id)
        case ("feed", "feed"), ("studio", "feed"): self = .feedPost(id: id)
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
    case newTasks

    var id: String {
        switch self {
        case .capture: "capture"
        case .dictation(let threadId, _): "dictation:\(threadId ?? "")"
        case .recording: "recording"
        case .voiceChat(let threadId): "voice:\(threadId)"
        case .write: "write"
        case .newTasks: "newTasks"
        }
    }
}

/// The office: Inbox (every Space), then the current Space's Home, Work and
/// Team. See docs/office-model.md.
/// Inbox (every Space), the current Space's tabs, and Settings. Home, Work
/// and Team folded into Tabs: bots and Home open from there or from search.
enum Tab: Hashable {
    case inbox, tabs, settings
}

@MainActor
final class AppModel: ObservableObject {
    static let shared = AppModel()

    @Published private(set) var client: BBClient
    @Published private(set) var realtime: BBRealtime
    @Published var tab: Tab = .tabs
    /// The Tabs stack: threads and items open here unless another tab is showing.
    @Published var path: [Route] = []
    @Published var inboxPath: [Route] = []
    /// Studio used to be its own tab; its routes now open in Work.
    var studioPath: [Route] {
        get { path }
        set { path = newValue }
    }
    /// The Studio tab's kind filter; nil for everything.
    @Published var studioKind: String?
    /// The Studio tab's space filter; nil for every space.
    @Published var studioSpace: String?
    @Published var sheet: Sheet?
    @Published var notificationError: String?
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
        // Started when the scene becomes active, so a background launch (a watch
        // relay, a Live Activity token) doesn't open a socket.
        realtime.subscribeThreadList()
        flushOutboxOnConnect()
        #if DEBUG
        // `simctl launch <device> nyc.plee.bbgo -officeTab work` opens a tab, for screenshots.
        switch UserDefaults.standard.string(forKey: "officeTab") {
        case "inbox": tab = .inbox
        case "tabs", "work", "team", "home": tab = .tabs
        case "settings": tab = .settings
        default: break
        }
        #endif
    }

    var serverURL: URL { client.baseURL }

    func setServerURL(_ url: URL) {
        guard url != serverURL else { return }
        // Load legacy queues so their unknown origins are quarantined.
        _ = Outbox.shared
        _ = TalkOutbox.shared
        BBClient.storedServerURL = url
        StudioStore.shared = StudioStore()
        SpaceWidgets.shared = SpaceWidgets()
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
        realtime = BBRealtime(client: client)
        realtime.start()
        realtime.subscribeThreadList()
        flushOutboxOnConnect()
        path = []
        inboxPath = []
        lastThreadId = ""
        newThreadDraft = nil
        replyThreadId = nil
        Outbox.shared.flush()
        TalkOutbox.shared.kick()
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

    /// `bbstudio://thread/<id>`, `bbstudio://reply/<id>`, `bbstudio://page/<id>`, `bbstudio://automations`, `bbstudio://usage`, `bbstudio://archived`, `bbstudio://drawing[/<id>]`, `bbstudio://artifact/<id>`, `bbstudio://bot/<id>`, `bbstudio://space/<id>`, `bbstudio://feed`, `bbstudio://post/<id>`,
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
        case "task": openStudio(kind: nil, id.map { .task(id: $0) } ?? .tasks)
        case "tasks": openStudio(kind: nil, .tasks)
        case "bot": if let id { openStudio(kind: "bot", .bot(id: id)) }
        case "space": if let id { openStudio(kind: nil, .space(id: id)) }
        case "feed": open(.feed)
        case "post": if let id { openFeedPost(id) }
        case "dictate": startDictation(threadId: id)
        case "record": sheet = .recording
        case "write": sheet = .write
        case "new-task", "new-tasks": sheet = .newTasks
        case "voice": startVoiceChat(threadId: id)
        case "new": newThread()
        case "studio", "talk": openStudio(kind: nil)
        case "inbox": tab = .inbox
        case "tabs", "work", "team", "home": tab = .tabs
        case "web", "settings": tab = .settings
        case "file": break  // Opened by the thread view, which knows the workspace.
        default: tab = .tabs
        }
    }

    func newThread(text: String = "") {
        if tab == .inbox || tab == .settings { tab = .tabs }
        newThreadDraft = text
    }

    func openThread(_ id: String) {
        tab = .tabs
        path = [.thread(id: id)]
    }

    func open(_ route: Route) {
        tab = .tabs
        path = [route]
    }

    /// Over the feed, so Back reads the rest of it.
    func openFeedPost(_ id: String) {
        tab = .tabs
        path = [.feed, .feedPost(id: id)]
    }

    /// Onto the stack of the tab showing, so Back returns where you were.
    func push(_ route: Route) {
        switch tab {
        case .inbox: inboxPath.append(route)
        case .tabs: path.append(route)
        case .settings:
            tab = .tabs
            path.append(route)
        }
    }

    /// A BB web path from the server (an item, a task, a channel): the native
    /// screen when there is one, else BB web.
    func openHref(_ href: String) {
        if let route = Route(href: href) {
            push(route)
        } else if let url = URL(string: href, relativeTo: serverURL)?.absoluteURL {
            UIApplication.shared.open(url)
        }
    }

    func openPage(_ id: String) {
        openStudio(kind: nil, .page(id: id))
    }

    func openStudio(kind: String?, _ route: Route? = nil) {
        tab = .tabs
        if let kind { studioKind = kind }
        path = [route ?? .studioCollection]
    }

    /// Studio's collection, showing only what a space holds.
    func openStudio(space id: String) {
        studioKind = nil
        studioSpace = id
        openStudio(kind: nil)
    }

    func startDictation(threadId: String? = nil) {
        sheet = .dictation(threadId: threadId, autoStart: true)
    }

    func startVoiceChat(threadId: String? = nil) {
        guard let id = threadId ?? (lastThreadId.isEmpty ? nil : lastThreadId) else {
            tab = .tabs
            return
        }
        sheet = .voiceChat(threadId: id)
    }
}
