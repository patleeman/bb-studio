import SwiftUI

/// "Chat About This" for a Studio item's ⋯ menu, when Studio Chat is running.
struct StudioChatMenuButton: View {
    @ObservedObject private var store = StudioStore.shared
    @Binding var isPresented: Bool

    var body: some View {
        if store.plugins.contains("studio-chat") {
            Button { isPresented = true } label: { Label("Chat About This", systemImage: "bubble.left.and.text.bubble.right") }
        }
    }
}

extension View {
    /// The Studio Chat sheet for an item; `projectId` nil asks for one.
    func studioChat(isPresented: Binding<Bool>, pluginId: String, itemId: String, title: String, projectId: String?) -> some View {
        sheet(isPresented: isPresented) {
            StudioChatSheet(pluginId: pluginId, itemId: itemId, title: title, projectId: projectId)
                .presentationDetents([.medium, .large])
        }
    }
}

/// Picks up the item's last chat, or starts one that knows the item.
private struct StudioChatSheet: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var store = StudioStore.shared
    @AppStorage(ServerScope.key("newThreadProjectId"), store: AppGroup.defaults) private var lastProjectId = ""
    let pluginId: String
    let itemId: String
    let title: String
    let projectId: String?
    @State private var lastThread: String?
    @State private var text = ""
    @State private var chosenProjectId = ""
    @State private var starting = false
    @State private var error: String?
    @FocusState private var focused: Bool

    private var project: String? {
        projectId ?? (chosenProjectId.isEmpty ? nil : chosenProjectId)
    }

    var body: some View {
        NavigationStack {
            Form {
                if let lastThread {
                    Section {
                        Button { open(lastThread) } label: {
                            Label("Continue Last Chat", systemImage: "arrow.uturn.forward")
                        }
                    }
                }
                Section {
                    TextField("Ask about \u{201C}\(title)\u{201D}…", text: $text, axis: .vertical)
                        .lineLimit(2...8)
                        .focused($focused)
                        .accessibilityIdentifier("studioChatField")
                    if projectId == nil {
                        Picker("Project", selection: $chosenProjectId) {
                            Text("Choose…").tag("")
                            ForEach(store.projectNames.sorted { $0.value.localizedStandardCompare($1.value) == .orderedAscending }, id: \.key) {
                                Text($0.value).tag($0.key)
                            }
                        }
                    }
                } footer: {
                    Text("Starts a thread with the project's default agent. It's told which item you mean and how to read it.")
                }
                if let error {
                    Text(error).font(.footnote).foregroundStyle(.red)
                }
            }
            .navigationTitle("Chat About This")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Start") { Task { await start() } }
                        .disabled(starting || project == nil || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .task {
                if chosenProjectId.isEmpty, store.projectNames[lastProjectId] != nil { chosenProjectId = lastProjectId }
                lastThread = try? await app.client.lastStudioChat(pluginId: pluginId, itemId: itemId)
            }
            .onAppear { focused = true }
        }
    }

    private func open(_ threadId: String) {
        dismiss()
        app.push(.thread(id: threadId))
    }

    private func start() async {
        guard let project else { return }
        starting = true
        defer { starting = false }
        do {
            let threadId = try await app.client.startStudioChat(
                pluginId: pluginId, itemId: itemId, projectId: project, text: text.trimmingCharacters(in: .whitespacesAndNewlines))
            open(threadId)
        } catch {
            self.error = (error as? BBError)?.message ?? BBClient.describe(error, server: app.client.baseURL)
        }
    }
}
