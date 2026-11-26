import Combine
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
    case drawing(id: String)
    case recording(id: String)
    case artifact(id: String)
    case design(id: String)
    case mini(id: String)
    case terminals(scope: TerminalScope, title: String)
    /// Visual Chat (the studio-visual-chat plugin): its chats, and one chat (nil: a new one).
    case visualChats
    case visualChat(threadId: String?)
    case memoryRecord(id: String)
    /// A Bot conversation, over Home (in Chat or its Workbench).
    case conversation(id: String)
    /// One of the Bot's places: Memory, Library, Schedules, Archive.
    case place(BotPage)
    /// Studio's list of everything made.
    case studio
    case settings
    /// The Bot's theme picker.
    case theme
}

extension Route {
    var isVisualChatBoard: Bool {
        if case .visualChat = self { return true }
        return false
    }

    /// A Studio add-on's BB web path: `/plugins/pages/pages/<id>` and the like.
    init?(href: String) {
        let parts = (URL(string: href)?.path() ?? href).split(separator: "/").map(String.init)
        // Kinds built into Studio live under its panel: /plugins/studio/studio/<segment>/<id>.
        // A page's chat (/plugins/studio/studio/pages/<id>/chat/<thread>) opens the page.
        if parts.count == 7, parts[0] == "plugins", parts[1] == "studio", parts[2] == "studio", parts[3] == "pages", parts[5] == "chat" {
            self = .page(id: parts[4])
            return
        }
        if parts.count == 5, parts[0] == "plugins", parts[1] == "studio", parts[2] == "studio" {
            switch parts[3] {
            case "pages": self = .page(id: parts[4])
            case "artifacts": self = .artifact(id: parts[4])
            case "drawings": self = .drawing(id: parts[4])
            case "designs": self = .design(id: parts[4])
            case "minis": self = .mini(id: parts[4])
            case "recordings": self = .recording(id: parts[4])
            default: return nil
            }
            return
        }
        guard parts.count == 4, parts[0] == "plugins" else { return nil }
        let id = parts[3]
        switch (parts[1], parts[2]) {
        case ("pages", "pages"): self = .page(id: id)
        case ("artifacts", "artifacts"): self = .artifact(id: id)
        case ("excalidraw", "drawings"): self = .drawing(id: id)
        case ("talk", "recordings"): self = .recording(id: id)
        case ("design", "designs"): self = .design(id: id)
        default: return nil
        }
    }
}

enum Sheet: Identifiable, Hashable {
    case capture
    case dictation(threadId: String?, autoStart: Bool)
    case recording
    case write
    /// Hands-free voice (iOS/VoiceLive); `autoStart` starts the session as it opens (Talk to Bot).
    /// `threadId`: the thread it was launched from, which the session speaks as; none means the Chief of Staff.
    case handsFree(autoStart: Bool = false, threadId: String? = nil)

    var id: String {
        switch self {
        case .capture: "capture"
        case .dictation(let threadId, _): "dictation:\(threadId ?? "")"
        case .recording: "recording"
        case .write: "write"
        case .handsFree(_, let threadId): "hands-free:\(threadId ?? "")"
        }
    }
}

@MainActor
final class AppModel: ObservableObject {
    static let shared = AppModel()

    @Published private(set) var client: BBClient
    @Published private(set) var realtime: BBRealtime
    /// All navigation state; `open` is the one way in.
    let router = Router.shared
    @Published var notificationError: String?
    /// A brief message over the whole app for something that went partly wrong, like Studio's flash.
    @Published private(set) var notice: String?
    private var idleWatch: AnyCancellable?

    /// The last thread opened.
    var lastThreadId: String {
        get { UserDefaults.standard.string(forKey: ServerScope.key("lastThreadId", serverURL: serverURL)) ?? "" }
        set {
            let key = ServerScope.key("lastThreadId", serverURL: serverURL)
            if UserDefaults.standard.string(forKey: key) != newValue {
                UserDefaults.standard.set(newValue, forKey: key)
            }
        }
    }

    private init() {
        let client = BBClient()
        self.client = client
        // From launch, so an accessibility install before the first
        // transcript still counts (it wakes the transcript's hosted chrome).
        _ = AccessibilityTurnOn.watch()
        realtime = BBRealtime(client: client)
        // Started when the scene becomes active, so a background launch (a watch
        // relay, a Live Activity token) doesn't open a socket.
        realtime.subscribeThreadList()
        flushOutboxOnConnect()
        BotSpacesStore.shared.attach(client: client, realtime: realtime)
        BotLiveActivities.shared.attach(store: BotSpacesStore.shared, client: client)
        idleWatch = EnergyGate.shared.$idle.removeDuplicates().dropFirst().sink { [weak self] idle in
            self?.realtime.pauseThreadList(idle)
        }
        #if DEBUG
        BotSpacesDemo.install(BotSpacesStore.shared)
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
        BotSpacesStore.shared = BotSpacesStore(serverURL: url)
        PagesStore.shared = PagesStore()
        MutedThreads.shared = MutedThreads()
        ThreadTitles.store.titles = [:]
        Spotlight.reset()
        StatusWidgets.reset()
        PhoneRelay.shared.pushStatus([])
        router.reset()
        realtime.stop()
        client = BBClient(baseURL: url)
        realtime = BBRealtime(client: client)
        realtime.start()
        realtime.subscribeThreadList()
        flushOutboxOnConnect()
        BotSpacesStore.shared.attach(client: client, realtime: realtime)
        BotLiveActivities.shared.attach(store: BotSpacesStore.shared, client: client)
        BotSpacesStore.shared.askIfUnknown()
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
    func scenePhaseChanged(_ phase: ScenePhase) {
        switch phase {
        case .background:
            realtime.stop()
        case .active:
            realtime.start()
            BotSpacesStore.shared.askIfUnknown()
        default:
            break
        }
    }

    private func flushOutboxOnConnect() {
        _ = realtime.listen { event in
            if case .connected = event {
                Outbox.shared.flush()
                // Uploads, finishes and deletions of discarded talks waiting for this server.
                TalkOutbox.shared.kick()
            }
        }
    }

    /// `bbstudio://` links. Entity links (`thread`, `page`, `design`, `bot`…)
    /// go through the shared link router; the rest: `reply/<id>`, `capture`,
    /// `dictate`, `record`, `write`, `handsfree`, `new`, `studio` (or `talk`),
    /// `usage`, `archived`, `drawing[s][/<id>]`, `pages`, `recordings`,
    /// `artifacts`, `designs`, `mini[s][/<id>]`, `visual-chat[/<threadId>|/new]`,
    /// `bots`, `chief`/`web`, `bot-talk` (also `chief-talk`), `strands` (also
    /// `loops`) and `settings`. Anything else opens the conversation list.
    func handle(_ url: URL) {
        guard AppLink.handles(url), AppLink.acceptsOrigin(url, serverURL: serverURL) else { return }
        let id = url.pathComponents.dropFirst().first
        if let target = Self.linkTarget(url) {
            openLink(target)
            return
        }
        switch url.host() {
        case "bot-talk", "chief-talk": toggleBotTalk(botId: id)
        case "dashboard", "dashboards": flash("Dashboards open in BB on your Mac.")
        case "visual-chat":
            // The list under the chat, so Back goes to it.
            open(.studio(kind: nil, .visualChats))
            if let id { router.open(.route(.visualChat(threadId: id == "new" ? nil : id))) }
        default:
            if let destination = Self.destination(url, id: id) { open(destination) }
            if url.host() == "reply", let id { router.replyThreadId = id }
        }
    }

    /// Where a `bbstudio://` link that isn't an entity goes.
    static func destination(_ url: URL, id: String?) -> Destination? {
        switch url.host() {
        case "capture": .sheet(.capture)
        case "reply": id.map(Destination.conversation)
        // The link router doesn't take these: a Studio item's own screen.
        case "page": id.map { .studio(kind: nil, .page(id: $0)) }
        case "automations": .route(.automations)
        case "usage": .route(.usage)
        case "archived": .route(.archived)
        case "drawing", "drawings": .studio(kind: "drawing", id.map { .drawing(id: $0) })
        case "pages": .studio(kind: "page", nil)
        case "recording", "recordings": .studio(kind: "recording", id.map { .recording(id: $0) })
        case "artifact", "artifacts": .studio(kind: "artifact", id.map { .artifact(id: $0) })
        case "design", "designs": .studio(kind: "design", id.map { .design(id: $0) })
        case "bot": .bot(id)
        case "mini", "minis": .studio(kind: "mini", id.map { .mini(id: $0) })
        case "visual-chat": .studio(kind: nil, .visualChats)
        case "dictate": .sheet(.dictation(threadId: id, autoStart: true))
        case "record": .sheet(.recording)
        case "write": .sheet(.write)
        case "handsfree", "hands-free": .sheet(.handsFree(threadId: id))
        case "new": .compose("")
        case "studio", "talk": .studio(kind: nil, nil)
        case "bots": .list
        case "chief", "web": .bot(nil)
        case "bot-talk", "chief-talk": nil
        case "settings": .settings
        default: .list
        }
    }

    /// A link the shared link router opens: `thread` and every entity kind
    /// but `file`, which the thread view opens in its workspace.
    nonisolated static func linkTarget(_ url: URL) -> LinkTarget? {
        let host = url.host() ?? ""
        guard host == "thread" || LinkKind(rawValue: host).map({ $0 != .file }) == true else { return nil }
        let text = host == "thread" ? "bb://conversation" + url.path(percentEncoded: true) : url.absoluteString
        guard case .entity(let ref)? = Links.parse(text) else { return nil }
        return .entity(ref)
    }

    func openLink(_ target: LinkTarget, threadId: String? = nil, push: ((Route) -> Void)? = nil) {
        switch target {
        case .external(let url):
            UIApplication.shared.open(url)
        case .action:
            flash("That opens on your Mac.")
        case .entity(let ref):
            guard Links.needsResolution(ref) else { return follow(Links.destination(ref), push: push) }
            let client = client
            Task {
                let resolution = try? await client.resolveLink(ref, threadId: threadId)
                guard client.baseURL == self.client.baseURL else { return }
                if resolution?.found == false { return flash("Not found: \(ref.link)") }
                follow(Links.destination(ref), push: push)
            }
        }
    }

    func follow(_ destination: LinkDestination, push: ((Route) -> Void)? = nil) {
        switch destination {
        case .thread(let id, let worker):
            let store = BotSpacesStore.shared
            open(worker || store.views.values.contains { $0.workers.contains { $0.threadId == id } } ? .worker(id) : .conversation(id))
        case .bot(let id):
            open(.bot(id))
        case .botPage(let page, let botId):
            open(.place(page, botId: botId))
        case .automation:
            open(.place(.automations, botId: nil))
        case .record:
            // Memory records are retired (Links.destination sends old record links to Memory); kept for older callers.
            open(.place(.memory, botId: nil))
        case .route(let route):
            if let push { push(route) } else { open(.route(route)) }
        case .safari(let url):
            UIApplication.shared.open(url)
        case .threadFiles:
            flash("Open files and diffs from their thread.")
        case .elsewhere(let message):
            flash(message)
        }
    }

    /// The one way in (`Router.open`).
    func open(_ destination: Destination) { router.open(destination) }

    /// Onto the stack showing, so Back returns where you were.
    func push(_ route: Route) { router.push(route) }

    /// Shows `message` at the bottom of the app for a few seconds.
    func flash(_ message: String) {
        notice = message
        Task {
            try? await Task.sleep(for: .seconds(4))
            if notice == message { notice = nil }
        }
    }

    /// Talk to Bot (the Action button, Siri, `bbstudio://bot-talk`): hands-free
    /// voice with a Bot's Main (the current Bot's, or `botId`'s), started at
    /// once. Run again, it ends the session.
    func toggleBotTalk(botId: String? = nil) {
        if case .handsFree = router.sheet {
            router.sheet = nil
            return
        }
        router.sheet = .handsFree(autoStart: true, threadId: Self.talkThreadId(store: BotSpacesStore.shared, botId: botId))
    }

    static func talkThreadId(store: BotSpacesStore, botId: String?) -> String? {
        guard store.useSpaces, let spaces = store.spaces else { return nil }
        let bot = spaces.bots.first { $0.id == botId } ?? BotShell.shownBot(spaces, chosen: store.shownBotId)
        guard let bot else { return nil }
        return bot.mainThreadId(in: store.view(for: bot.id))
    }
}
