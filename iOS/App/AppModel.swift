import Foundation
import SwiftUI

enum Route: Hashable {
    case thread(id: String)
    case room(Room)
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
    case inbox, talk, web, settings
}

@MainActor
final class AppModel: ObservableObject {
    static let shared = AppModel()

    @Published private(set) var client: BBClient
    @Published private(set) var realtime: BBRealtime
    @Published var tab: Tab = .inbox
    @Published var path: [Route] = []
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
    }

    var serverURL: URL { client.baseURL }

    func setServerURL(_ url: URL) {
        BBClient.storedServerURL = url
        realtime.stop()
        client = BBClient(baseURL: url)
        realtime = BBRealtime(client: client)
        realtime.start()
        realtime.subscribeThreadList()
    }

    /// `bbgo://thread/<id>`, `bbgo://dictate`, `bbgo://voice[/<id>]`, `bbgo://talk`, `bbgo://web`.
    func handle(_ url: URL) {
        guard url.scheme == "bbgo" else { return }
        let id = url.pathComponents.dropFirst().first
        switch url.host() {
        case "thread": if let id { openThread(id) }
        case "dictate": startDictation(threadId: id)
        case "voice": startVoiceChat(threadId: id)
        case "new": newThread()
        case "talk": tab = .talk
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
