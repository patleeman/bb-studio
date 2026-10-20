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
    case drawings
    case drawing(id: String)
    case recording(id: String)
    case artifact(id: String)
    case design(id: String)
    case dashboard(id: String)
    case terminals(scope: TerminalScope, title: String)
}

extension Route {
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
            case "dashboards": self = .dashboard(id: parts[4])
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

    var id: String {
        switch self {
        case .capture: "capture"
        case .dictation(let threadId, _): "dictation:\(threadId ?? "")"
        case .recording: "recording"
        case .write: "write"
        }
    }
}

/// Where the Bots tab goes: its list, the primary bot, or one bot by id.
enum BotRoute: Hashable {
    case list, primary, bot(String)
}

enum Tab: Hashable {
    case inbox, studio, bot, settings
}

@MainActor
final class AppModel: ObservableObject {
    static let shared = AppModel()

    @Published private(set) var client: BBClient
    @Published private(set) var realtime: BBRealtime
    /// Bot is the primary tab: every launch opens on it. Links, notification
    /// taps, widgets and Siri set their own tab after this, so they always win.
    @Published var tab: Tab = .bot
    @Published var path: [Route] = []
    @Published var studioPath: [Route] = []
    /// Set by the Action button until the Bot tab starts or stops talking.
    @Published var botTalkPending = false
    /// What the Bots tab should show next, set by links and the Action button.
    @Published var botRoute: BotRoute?
    /// The Studio tab's kind filter; nil for everything.
    @Published var studioKind: String?
    @Published var sheet: Sheet?
    @Published var notificationError: String?
    /// A brief message over the whole app for something that went partly wrong, like Studio's flash.
    @Published private(set) var notice: String?
    /// Opens the new-thread composer, optionally prefilled.
    @Published var newThreadDraft: String?
    /// Set by `bbstudio://reply/<id>`; that thread focuses its composer.
    @Published var replyThreadId: String?

    /// The last thread opened.
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
        sheet = nil
        botTalkPending = false
        realtime.stop()
        client = BBClient(baseURL: url)
        realtime = BBRealtime(client: client)
        realtime.start()
        realtime.subscribeThreadList()
        flushOutboxOnConnect()
        path = []
        studioPath = []
        newThreadDraft = nil
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
    /// An open thread in voice mode keeps it, since it waits on replies to speak
    /// with the screen locked, until it has been quiet a while.
    func scenePhaseChanged(_ phase: ScenePhase) {
        switch phase {
        case .background:
            let realtime = realtime
            if VoiceBackground.shared.enteredBackground(release: { realtime.stop() }) { return }
            realtime.stop()
        case .active:
            VoiceBackground.shared.becameActive()
            realtime.start()
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

    /// `bbstudio://thread/<id>`, `bbstudio://reply/<id>`, `bbstudio://page/<id>`, `bbstudio://automations`, `bbstudio://usage`, `bbstudio://archived`, `bbstudio://drawing[/<id>]`, `bbstudio://artifact/<id>`, `bbstudio://dashboard[/<id>]`,
    /// `bbstudio://capture`, `bbstudio://dictate`, `bbstudio://voice[/<id>]`, `bbstudio://studio` (or `talk`), `bbstudio://bots` (the list), `bbstudio://bot[/<id>]` (also `chief` and the old `web`, the primary), `bbstudio://bot-talk` (also `chief-talk`).
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
        case "dashboard", "dashboards": openStudio(kind: "dashboard", id.map { .dashboard(id: $0) })
        case "dictate": startDictation(threadId: id)
        case "record": sheet = .recording
        case "write": sheet = .write
        case "voice": if let id { openWithVoice(id) } else { startVoiceChat() }
        case "new": newThread()
        case "studio", "talk": openStudio(kind: nil)
        case "bots": openBots(.list)
        case "bot": openBots(id.map { .bot($0) } ?? .primary)
        case "chief", "web": openBots(.primary)
        case "bot-talk", "chief-talk": toggleBotTalk()
        case "settings": tab = .settings
        case "file": break  // Opened by the thread view, which knows the workspace.
        default: tab = .inbox
        }
    }

    func newThread(text: String = "") {
        tab = .inbox
        newThreadDraft = text
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

    func toggleBotTalk() {
        sheet = nil
        openBots(.primary)
        botTalkPending = true
    }

    func openBots(_ route: BotRoute) {
        botRoute = route
        tab = .bot
    }

    /// Set while `voice.new` runs, so a second tap doesn't start a second chat.
    @Published private(set) var startingVoiceChat = false

    /// A new voice chat (Studio's `voice.new`): a thread on a fast model with
    /// voice mode on, whose agent greets you. Opens it; without a project it
    /// goes in BB's personal project, as on desktop.
    func startVoiceChat(projectId: String? = nil) {
        guard !startingVoiceChat else { return }
        startingVoiceChat = true
        sheet = nil
        let client = client
        Task {
            defer { startingVoiceChat = false }
            do {
                let threadId = try await client.newVoiceChat(projectId: projectId)
                guard client.baseURL == serverURL else { return }
                ThreadVoice.startedOn.insert(threadId)
                openThread(threadId)
            } catch {
                flash("Couldn't start a voice chat: \(BBClient.describe(error, plugin: "Studio", server: client.baseURL))")
            }
        }
    }

    /// `bbstudio://voice/<id>`: the thread, with voice mode turned on.
    func openWithVoice(_ threadId: String) {
        sheet = nil
        let client = client
        Task {
            if (try? await client.setVoice(threadId, on: true))?.on == true { ThreadVoice.startedOn.insert(threadId) }
            guard client.baseURL == serverURL else { return }
            openThread(threadId)
        }
    }
}
