import SwiftUI

/// "Work with this page": starts an agent thread that knows the page, or hands it
/// to a bot the message @mentions, then opens that thread.
struct PageWorkBar: View {
    let page: PageMeta?
    let pageId: String
    @Binding var notice: String?
    var started: () async -> Void
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }
    @ObservedObject private var store = PagesStore.shared
    @AppStorage(ServerScope.key("newThreadProjectId"), store: AppGroup.defaults) private var lastProjectId = ""
    @State private var text = ""
    @State private var chosenProjectId: String?
    @State private var sending = false
    @FocusState private var focused: Bool

    /// A project page's own project; global pages need one picked.
    private var projectId: String? {
        page?.projectId ?? chosenProjectId ?? (lastProjectId.isEmpty ? nil : lastProjectId)
    }

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            if page != nil, page?.projectId == nil {
                Menu {
                    ForEach(store.projectNames.sorted { $0.value < $1.value }, id: \.key) { id, name in
                        Button(name) { chosenProjectId = id }
                    }
                } label: {
                    Image(systemName: "folder").frame(width: 36, height: 36)
                }
                .accessibilityLabel(projectId.flatMap { store.projectNames[$0] } ?? "Pick a project")
            }
            TextField("Work with this page…", text: $text, axis: .vertical)
                .lineLimit(1...5)
                .focused($focused)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .accessibilityIdentifier("pageWorkField")
            Button { Task { await send() } } label: {
                Image(systemName: sending ? "ellipsis" : "arrow.up.circle.fill").font(.title2)
            }
            .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || projectId == nil || sending)
            .accessibilityLabel("Start")
            .padding(.trailing, 6)
            .padding(.bottom, 4)
        }
        .background(.regularMaterial, in: .rect(cornerRadius: 22))
        .padding(.horizontal, 12)
        .padding(.bottom, 6)
    }

    private func send() async {
        guard let projectId else { return }
        let message = text.trimmingCharacters(in: .whitespacesAndNewlines)
        sending = true
        defer { sending = false }
        do {
            let defaults = (try? await client.projectDefaults(projectId)) ?? nil
            let result = try await client.workWithPage(
                pageId, projectId: projectId, text: message, choice: defaults ?? ExecutionChoice())
            text = ""
            focused = false
            if let bot = result.botName { notice = "\(bot) is on it" }
            guard client.baseURL == app.serverURL else { return }
            await started()
            operation.complete(on: app) { app.push(.thread(id: result.threadId)) }
        } catch {
            notice = BBClient.describe(error, server: client.baseURL)
        }
    }
}

/// A page's saved versions, with restore.
struct PageHistorySheet: View {
    let pageId: String
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }
    @Environment(\.dismiss) private var dismiss
    @State private var snapshots: [PageSnapshot]?
    @State private var error: String?
    @State private var restoring: PageSnapshot?
    @State private var naming = false
    @State private var label = ""

    var body: some View {
        NavigationStack {
            List {
                if let error { Text(error).font(.footnote).foregroundStyle(.red) }
                Section {
                    Button { naming = true } label: { Label("Save a Version Now", systemImage: "plus.circle") }
                }
                if let snapshots {
                    Section {
                        ForEach(snapshots) { snapshot in
                            Button { restoring = snapshot } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(snapshot.label.isEmpty ? "Saved version" : snapshot.label).foregroundStyle(.primary)
                                    HStack(spacing: 4) {
                                        Text(Date(timeIntervalSince1970: snapshot.createdAt / 1000), format: .dateTime.month().day().hour().minute())
                                        if !snapshot.actor.isEmpty { Text("· \(snapshot.actor)") }
                                    }
                                    .font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            .tint(.primary)
                        }
                    } footer: {
                        if snapshots.isEmpty { Text("No saved versions yet. BB saves one before big changes, like a restore.") }
                    }
                } else if error == nil {
                    ProgressView().frame(maxWidth: .infinity)
                }
            }
            .navigationTitle("Version History")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { operation.complete(on: app) { dismiss() } } } }
            .task { await load() }
            .confirmationDialog(
                "Restore this version?", isPresented: .init(get: { restoring != nil }, set: { if !$0 { restoring = nil } }),
                titleVisibility: .visible, presenting: restoring
            ) { snapshot in
                Button("Restore") { Task { await restore(snapshot) } }
            } message: { _ in
                Text("The page goes back to this version. Its current text is saved as a version first.")
            }
            .alert("Save a version", isPresented: $naming) {
                TextField("Label (optional)", text: $label)
                Button("Cancel", role: .cancel) {}
                Button("Save") { Task { await snapshot() } }
            }
        }
    }

    private func load() async {
        do {
            snapshots = try await client.pageSnapshots(pageId).sorted { $0.createdAt > $1.createdAt }
            error = nil
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
    }

    private func snapshot() async {
        do {
            try await client.snapshotPage(pageId, label: label)
            label = ""
            await load()
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
    }

    private func restore(_ snapshot: PageSnapshot) async {
        do {
            try await client.restorePage(snapshotId: snapshot.id)
            operation.complete(on: app) { dismiss() }
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
    }
}
