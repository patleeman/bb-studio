import Foundation
import SwiftUI

enum Route: Hashable {
    case thread(id: String)
    case room(Room)
    case pages
    case page(id: String)
    case automations
    case automation(Automation)
    case usage
    case queue
    case archived
    case drawings
    case attention
    case drawing(id: String)
    case recording(id: String)
    case artifact(id: String)
    case tasks
    case task(id: String)
    case terminals(scope: TerminalScope, title: String)
    case machines
    case bot(id: String)
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
        case ("studio-tasks", "tasks"): self = .task(id: id)
        case ("bot-teams", "bots"): self = .bot(id: id)
        default: return nil
        }
    }
}

enum Sheet: Identifiable, Hashable {
    case dictation(threadId: String?, autoStart: Bool)
    case recording
    case voiceChat(threadId: String)
    case write
    case newTasks

    var id: String {
        switch self {
        case .dictation(let threadId, _): "dictation:\(threadId ?? "")"
        case .recording: "recording"
        case .voiceChat(let threadId): "voice:\(threadId)"
        case .write: "write"
        case .newTasks: "newTasks"
        }
    }
}

enum Tab: Hashable {
    case inbox, studio, web, settings
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
    @Published var sheet: Sheet?
    /// Opens the new-thread composer, optionally prefilled.
    @Published var newThreadDraft: String?

    /// The last thread opened, so the action button can resume a voice chat with it.
    @AppStorage("lastThreadId") var lastThreadId: String = ""

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
        BBClient.storedServerURL = url
        realtime.stop()
        client = BBClient(baseURL: url)
        realtime = BBRealtime(client: client)
        realtime.start()
        realtime.subscribeThreadList()
        flushOutboxOnConnect()
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

    /// `bbstudio://thread/<id>`, `bbstudio://page/<id>`, `bbstudio://automations`, `bbstudio://queue`, `bbstudio://usage`, `bbstudio://archived`, `bbstudio://attention`, `bbstudio://drawing[/<id>]`, `bbstudio://artifact/<id>`, `bbstudio://bot/<id>`, `bbstudio://terminals`,
    /// `bbstudio://dictate`, `bbstudio://voice[/<id>]`, `bbstudio://studio` (or `talk`), `bbstudio://web`.
    func handle(_ url: URL) {
        guard AppLink.handles(url) else { return }
        let id = url.pathComponents.dropFirst().first
        switch url.host() {
        case "thread": if let id { openThread(id) }
        case "page": if let id { openPage(id) }
        case "automations": open(.automations)
        case "queue": open(.queue)
        case "usage": open(.usage)
        case "archived": open(.archived)
        case "attention": open(.attention)
        case "terminals", "terminal": open(.machines)
        case "drawing", "drawings": openStudio(kind: "drawing", id.map { .drawing(id: $0) })
        case "pages": openStudio(kind: "page")
        case "recording", "recordings": openStudio(kind: "recording", id.map { .recording(id: $0) })
        case "artifact", "artifacts": openStudio(kind: "artifact", id.map { .artifact(id: $0) })
        case "task": openStudio(kind: nil, id.map { .task(id: $0) } ?? .tasks)
        case "tasks": openStudio(kind: nil, .tasks)
        case "bot": if let id { openStudio(kind: "bot", .bot(id: id)) }
        case "dictate": startDictation(threadId: id)
        case "record": sheet = .recording
        case "write": sheet = .write
        case "new-task", "new-tasks": sheet = .newTasks
        case "voice": startVoiceChat(threadId: id)
        case "new": newThread()
        case "studio", "talk": openStudio(kind: nil)
        case "web": tab = .web
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
