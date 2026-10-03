import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Share sheet entry point: send shared text, links, photos, and files to a new or existing BB thread.
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
    enum Destination: Hashable {
        case new(projectId: String)
        case thread(String)
    }

    @Published var text = ""
    @Published var files: [SharedFile] = []
    @Published var projects: [Project] = []
    @Published var threads: [ThreadEntry] = []
    @Published var destination: Destination?
    @Published var sending = false
    @Published var error: String?
    @Published private(set) var attachmentErrors: [String] = []

    private let context: NSExtensionContext?
    private let client = BBClient()
    private static let lastProjectKey = "newThreadProjectId"

    init(context: NSExtensionContext?) {
        self.context = context
    }

    func load() async {
        await loadShared()
        guard checkServer() else { return }
        if let snapshot = DiskCache.load(InboxSnapshot.self, key: InboxSnapshot.cacheKey, serverURL: client.baseURL) {
            threads = snapshot.threads
        }
        do {
            async let projects = client.projects()
            threads = try await client.threads(limit: 60).filter { $0.parentThreadId == nil }
            self.projects = try await projects
        } catch {
            self.error = BBClient.describe(error)
        }
        guard checkServer() else { return }
        let last = AppGroup.defaults.string(forKey: ServerScope.key(Self.lastProjectKey, serverURL: client.baseURL))
        let projectId = projects.first(where: { $0.id == last })?.id ?? projects.first?.id
        if destination == nil, let projectId { destination = .new(projectId: projectId) }
    }

    func send() async {
        guard checkServer(), canSend, let destination else { return }
        sending = true
        defer { sending = false }
        do {
            let message = text.trimmingCharacters(in: .whitespacesAndNewlines)
            switch destination {
            case .new(let projectId):
                AppGroup.defaults.set(projectId, forKey: ServerScope.key(Self.lastProjectKey, serverURL: client.baseURL))
                let inputs = try await upload(to: projectId)
                _ = try await client.createThread(projectId: projectId, text: message, attachments: inputs)
            case .thread(let id):
                let known = threads.first(where: { $0.id == id })?.projectId
                let projectId: String
                if let known { projectId = known } else { projectId = try await client.thread(id).projectId }
                let inputs = try await upload(to: projectId)
                try await client.send(id, text: message, attachments: inputs)
            }
            context?.completeRequest(returningItems: nil)
        } catch {
            self.error = BBClient.describe(error)
        }
    }

    private func checkServer() -> Bool {
        guard client.baseURL == ServerScope.selectedURL else {
            projects = []; threads = []; destination = nil
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
                                        } else {
                                            Label(file.name, systemImage: "doc").font(.caption2).padding(4)
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
                Section("Send to") {
                    Picker("Destination", selection: $model.destination) {
                        ForEach(model.projects) { project in
                            Label("New thread in \(project.name)", systemImage: "square.and.pencil")
                                .tag(ShareModel.Destination?.some(.new(projectId: project.id)))
                        }
                        ForEach(model.threads.prefix(20)) { thread in
                            Text(thread.displayTitle).lineLimit(1).tag(ShareModel.Destination?.some(.thread(thread.id)))
                        }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
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
            .navigationTitle("Send to BB")
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
