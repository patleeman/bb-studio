import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Share sheet entry point: send shared text, links, photos, and files to a Bot's conversation (Main by default),
/// one of its open conversations, or a new one.
final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        let model = ShareModel(context: extensionContext)
        let host = UIHostingController(rootView: ShareView(model: model))
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)
        Task { await model.load() }
    }
}

@MainActor
final class ShareModel: ObservableObject {
    /// A Bot's conversation (Main by default), a new one, or, on a Studio
    /// without Bot spaces, a BB thread or a new thread in the remembered project.
    enum Destination: Hashable {
        case conversation(botId: String, threadId: String)
        case newConversation(botId: String)
        case thread(String)
        case newThread
    }

    @Published var text = ""
    @Published var files: [SharedFile] = []
    @Published var bots: [BotSpace] = []
    @Published var botId: String?
    @Published var view: BotThreadsView?
    @Published var threads: [ThreadEntry] = []
    @Published var destination: Destination?
    @Published var sending = false
    @Published var error: String?
    @Published private(set) var attachmentErrors: [String] = []

    private let context: NSExtensionContext?
    private let client = BBClient()
    private static let lastProjectKey = "newThreadProjectId"
    private static let lastBotKey = "shareBotId"

    init(context: NSExtensionContext?) {
        self.context = context
    }

    var usesSpaces: Bool { !bots.isEmpty }
    var bot: BotSpace? { bots.first { $0.id == botId } }

    /// Main first, then the Bot's other open conversations, newest first.
    var conversations: [BotConversation] {
        guard let view else { return [] }
        let rest = view.conversations.filter { !$0.isMain && !$0.mirrored }.sorted { $0.updatedAt > $1.updatedAt }
        return (view.main.map { [$0] } ?? []) + rest
    }

    func load() async {
        await loadShared()
        guard checkServer() else { return }
        let serverURL = client.baseURL
        if BotWidgetData.usesSpaces(serverURL: serverURL), let cached = BotSpacesCache.loadSpaces(serverURL: serverURL), !cached.bots.isEmpty {
            show(cached)
        }
        do {
            let spaces = try await client.botSpaces()
            guard checkServer() else { return }
            if spaces.bots.isEmpty { return await loadThreads() }
            show(spaces)
            await loadView()
        } catch where BBClient.isUnknownRPC(error) {
            bots = []
            await loadThreads()
        } catch {
            if bots.isEmpty { await loadThreads() } else { await loadView() }
        }
    }

    private func show(_ spaces: BotSpaces) {
        bots = spaces.bots
        if botId == nil || bot == nil {
            let last = AppGroup.defaults.string(forKey: ServerScope.key(Self.lastBotKey, serverURL: client.baseURL))
            botId = spaces.bots.first(where: { $0.id == last })?.id ?? spaces.current?.id
        }
        if view == nil, let botId { view = BotSpacesCache.loadView(botId, serverURL: client.baseURL) }
        defaultDestination()
    }

    /// Main, the Bot's own conversation.
    private func defaultDestination() {
        guard let bot else { return }
        switch destination {
        case .conversation(let id, _)? where id == bot.id: return
        case .newConversation(let id)? where id == bot.id: return
        default: break
        }
        if let main = bot.mainThreadId(in: view) {
            destination = .conversation(botId: bot.id, threadId: main)
        } else {
            destination = .newConversation(botId: bot.id)
        }
    }

    func choose(bot id: String) {
        guard id != botId else { return }
        botId = id
        view = BotSpacesCache.loadView(id, serverURL: client.baseURL)
        destination = nil
        defaultDestination()
        Task { await loadView() }
    }

    private func loadView() async {
        guard let botId else { return }
        do {
            let next = try await client.botThreadsView(botId: botId)
            guard checkServer(), botId == self.botId else { return }
            view = next
            BotSpacesCache.saveView(next, botId: botId, serverURL: client.baseURL)
            defaultDestination()
        } catch {
            if view == nil { self.error = BBClient.describe(error, plugin: "Studio", server: client.baseURL) }
        }
    }

    /// An older Studio: recent BB threads, or a new thread in the remembered project.
    private func loadThreads() async {
        if let snapshot = DiskCache.load(InboxSnapshot.self, key: InboxSnapshot.cacheKey, serverURL: client.baseURL) {
            threads = snapshot.threads.filter { $0.parentThreadId == nil }
        }
        do {
            threads = try await client.threads(limit: 60).filter { $0.parentThreadId == nil }
        } catch {
            self.error = BBClient.describe(error)
        }
        guard checkServer() else { return }
        if destination == nil { destination = .newThread }
    }

    func send() async {
        guard checkServer(), canSend, let destination else { return }
        sending = true
        defer { sending = false }
        do {
            let message = text.trimmingCharacters(in: .whitespacesAndNewlines)
            switch destination {
            case .conversation(let botId, let id):
                remember(botId)
                let known = view?.conversations.first(where: { $0.threadId == id })?.projectId
                let projectId: String
                if let known { projectId = known } else { projectId = try await client.thread(id).projectId }
                let inputs = try await upload(to: projectId)
                try await client.send(id, text: message, attachments: inputs)
            case .newConversation(let botId):
                remember(botId)
                guard let bot = bots.first(where: { $0.id == botId }) else { return }
                var projectId = view?.main?.projectId
                if projectId == nil, let main = bot.mainThreadId(in: view) { projectId = try await client.thread(main).projectId }
                guard let projectId else { throw BBError(status: 0, message: "\(bot.name) has no Main conversation to start from.") }
                let inputs = try await upload(to: projectId)
                _ = try await client.startConversation(botId: botId, projectId: projectId, text: message, attachments: inputs)
            case .thread(let id):
                let known = threads.first(where: { $0.id == id })?.projectId
                let projectId: String
                if let known { projectId = known } else { projectId = try await client.thread(id).projectId }
                let inputs = try await upload(to: projectId)
                try await client.send(id, text: message, attachments: inputs)
            case .newThread:
                let last = AppGroup.defaults.string(forKey: ServerScope.key(Self.lastProjectKey, serverURL: client.baseURL))
                let projects = try await client.projects()
                guard let projectId = projects.first(where: { $0.id == last })?.id ?? projects.first?.id else {
                    throw BBError(status: 0, message: "BB has no project to start a thread in.")
                }
                let inputs = try await upload(to: projectId)
                _ = try await client.createThread(projectId: projectId, text: message, attachments: inputs)
            }
            context?.completeRequest(returningItems: nil)
        } catch {
            self.error = BBClient.describe(error)
        }
    }

    private func remember(_ botId: String) {
        AppGroup.defaults.set(botId, forKey: ServerScope.key(Self.lastBotKey, serverURL: client.baseURL))
    }

    private func checkServer() -> Bool {
        guard client.baseURL == ServerScope.selectedURL else {
            bots = []; view = nil; threads = []; destination = nil
            error = "The server changed. Close and reopen Share to choose a destination."
            return false
        }
        return true
    }

    func cancel() {
        context?.cancelRequest(withError: CocoaError(.userCancelled))
    }

    private func upload(to projectId: String) async throws -> [JSONValue] {
        var inputs: [JSONValue] = []
        for file in files {
            inputs.append(try await client.upload(projectId: projectId, data: file.data, name: file.name, mimeType: file.mimeType))
        }
        return inputs
    }

    var canSend: Bool {
        destination != nil && !sending && attachmentErrors.isEmpty && !(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && files.isEmpty)
    }

    /// Text and URLs join into the message, one per paragraph; images and files become attachments.
    private func loadShared() async {
        let providers = (context?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
        let content = await SharedContent.load(providers)
        text = content.text
        files = content.files
        attachmentErrors = content.errors
    }

}

struct ShareView: View {
    @ObservedObject var model: ShareModel

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Message", text: $model.text, axis: .vertical).lineLimit(3...10)
                    if !model.files.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack {
                                ForEach(model.files) { file in
                                    Group {
                                        if let thumbnail = file.thumbnail {
                                            Image(uiImage: thumbnail).resizable().scaledToFill()
                                                .accessibilityLabel("Shared image: \(file.name)")
                                        } else {
                                            Label(file.name, systemImage: "doc").font(.caption2).padding(4)
                                                .accessibilityLabel("Shared file: \(file.name)")
                                        }
                                    }
                                    .frame(width: 64, height: 64)
                                    .background(.fill.tertiary)
                                    .clipShape(.rect(cornerRadius: 8))
                                }
                            }
                        }
                    }
                }
                if model.usesSpaces {
                    if model.bots.count > 1 {
                        Section("Bot") {
                            Picker("Bot", selection: Binding(get: { model.botId ?? "" }, set: { model.choose(bot: $0) })) {
                                ForEach(model.bots) { bot in
                                    Text("\(bot.avatar.isEmpty ? "" : bot.avatar + " ")\(bot.name)").tag(bot.id)
                                }
                            }
                            .accessibilityIdentifier("shareBot")
                        }
                    }
                    Section("Send to") {
                        Picker("Conversation", selection: $model.destination) {
                            ForEach(model.conversations) { conversation in
                                Label(conversation.isMain ? "Main" : (conversation.title.isEmpty ? "Conversation" : conversation.title),
                                      systemImage: conversation.isMain ? "star.bubble" : "bubble.left")
                                    .lineLimit(1)
                                    .tag(ShareModel.Destination?.some(.conversation(botId: model.botId ?? "", threadId: conversation.threadId)))
                            }
                            if let botId = model.botId {
                                Label("New conversation", systemImage: "plus.bubble")
                                    .tag(ShareModel.Destination?.some(.newConversation(botId: botId)))
                            }
                        }
                        .pickerStyle(.inline)
                        .labelsHidden()
                    }
                } else {
                    Section("Send to") {
                        Picker("Destination", selection: $model.destination) {
                            Label("New thread", systemImage: "square.and.pencil")
                                .tag(ShareModel.Destination?.some(.newThread))
                            ForEach(model.threads.prefix(20)) { thread in
                                Text(thread.displayTitle).lineLimit(1).tag(ShareModel.Destination?.some(.thread(thread.id)))
                            }
                        }
                        .pickerStyle(.inline)
                        .labelsHidden()
                    }
                }
                if let error = model.error {
                    Text(error).font(.footnote).foregroundStyle(.red)
                }
                if !model.attachmentErrors.isEmpty {
                    Section("Some shared items couldn't be loaded") {
                        ForEach(Array(model.attachmentErrors.enumerated()), id: \.offset) { _, error in
                            Text(error).font(.footnote).foregroundStyle(.red)
                        }
                        Text("Close Share and try again. Nothing has been sent.").font(.footnote)
                    }
                }
            }
            .navigationTitle(model.bot.map { "Send to \($0.name)" } ?? "Send to BB")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { model.cancel() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await model.send() } } label: {
                        if model.sending { ProgressView() } else { Text("Send") }
                    }
                        .disabled(!model.canSend)
                }
            }
        }
    }
}
