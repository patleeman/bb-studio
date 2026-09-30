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
}

enum Sheet: Identifiable, Hashable {
    case dictation(threadId: String?, autoStart: Bool)
    case voiceChat(threadId: String)

    var id: String {
        switch self {
        case .dictation(let threadId, _): "dictation:\(threadId ?? "")"
        case .voiceChat(let threadId): "voice:\(threadId)"
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
        realtime.start()
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

    private func flushOutboxOnConnect() {
        _ = realtime.listen { event in
            if case .connected = event { Outbox.shared.flush() }
        }
    }

    /// `bbgo://thread/<id>`, `bbgo://page/<id>`, `bbgo://automations`, `bbgo://queue`, `bbgo://usage`, `bbgo://archived`, `bbgo://attention`, `bbgo://drawing[/<id>]`,
    /// `bbgo://dictate`, `bbgo://voice[/<id>]`, `bbgo://studio` (or `talk`), `bbgo://web`.
    func handle(_ url: URL) {
        guard url.scheme == "bbgo" else { return }
        let id = url.pathComponents.dropFirst().first
        switch url.host() {
        case "thread": if let id { openThread(id) }
        case "page": if let id { openPage(id) }
        case "automations": open(.automations)
        case "queue": open(.queue)
        case "usage": open(.usage)
        case "archived": open(.archived)
        case "attention": open(.attention)
        case "drawing", "drawings": openStudio(kind: "drawing", id.map { .drawing(id: $0) })
        case "pages": openStudio(kind: "page")
        case "dictate": startDictation(threadId: id)
        case "voice": startVoiceChat(threadId: id)
        case "new": newThread()
        case "studio", "talk": openStudio(kind: nil)
        case "web": tab = .web
        case "settings": tab = .settings
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
