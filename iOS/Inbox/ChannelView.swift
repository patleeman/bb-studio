import SwiftUI

/// A Bot Teams channel. Channels live in the bot-teams plugin's own store,
/// so this reads and writes through its RPC rather than core threads.
struct ChannelView: View {
    @EnvironmentObject private var app: AppModel
    let room: Room
    @State private var name: String?
    @State private var renaming = false
    @State private var newName = ""
    @State private var messages: [RoomMessage] = []
    @State private var draft = ""
    @State private var error: String?
    @State private var listener: UUID?
    @State private var dictating = false
    /// Tool approvals and questions from bots working on this channel's jobs.
    @State private var approvals: [PendingInteraction] = []

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                ForEach(messages) { message in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(message.speaker)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(message.isOwner ? Color.accentColor : .secondary)
                        MarkdownText(message.text).textSelection(.enabled)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                ForEach(approvals) { interaction in
                    InteractionCard(
                        interaction: interaction,
                        resolve: { value in
                            do {
                                try await app.client.settle(interaction, value)
                                approvals.removeAll { $0.id == interaction.id }
                                return true
                            } catch {
                                self.error = error.localizedDescription
                                return false
                            }
                        },
                        cancel: {
                            try? await app.client.cancel(interaction)
                            approvals.removeAll { $0.id == interaction.id }
                        },
                        openWeb: { app.path.append(.thread(id: interaction.threadId)) })
                }
            }
            .padding()
        }
        .defaultScrollAnchor(.bottom)
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) {
            HStack(alignment: .bottom, spacing: 8) {
                Button { dictating = true } label: { Image(systemName: "mic.fill").font(.title3) }
                TextField("Message #\(room.name)", text: $draft, axis: .vertical)
                    .lineLimit(1...6)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(.fill.tertiary, in: .rect(cornerRadius: 18))
                Button {
                    let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !text.isEmpty else { return }
                    Task {
                        do {
                            try await app.client.sendToRoom(room.id, text: text)
                            draft = ""
                            await load()
                        } catch { self.error = error.localizedDescription }
                    }
                } label: { Image(systemName: "arrow.up.circle.fill").font(.title) }
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
            .background(.bar)
        }
        .overlay(alignment: .top) {
            if let error { Text(error).font(.caption).padding(8).background(.red.opacity(0.15), in: .capsule) }
        }
        .sheet(isPresented: $dictating) {
            DictationView(threadId: nil, autoStart: true) { text in draft += (draft.isEmpty ? "" : " ") + text }
        }
        .navigationTitle("#\(name ?? room.name)")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        newName = name ?? room.name
                        renaming = true
                    } label: { Label("Rename channel", systemImage: "pencil") }
                } label: { Image(systemName: "ellipsis") }
                .accessibilityLabel("More")
            }
        }
        .alert("Rename channel", isPresented: $renaming) {
            TextField("Name", text: $newName)
            Button("Cancel", role: .cancel) {}
            Button("Rename") {
                let next = newName.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !next.isEmpty, next != (name ?? room.name) else { return }
                Task {
                    do {
                        name = try await app.client.renameRoom(room.id, name: next).name
                    } catch {
                        self.error = error.localizedDescription
                    }
                }
            }
        }
        .task {
            listener = app.realtime.listen { event in
                if case .pluginSignal(let pluginId, _, _) = event, pluginId == "bot-teams" {
                    Task { await load() }
                }
            }
            await load()
        }
        .onDisappear { if let listener { app.realtime.removeListener(listener) } }
    }

    private func load() async {
        do {
            let page = try await app.client.room(room.id)
            messages = page.messages
            error = nil
            let wanted = Set((page.approvals ?? []).map(\.id))
            var pending: [PendingInteraction] = []
            for thread in Set((page.approvals ?? []).map(\.threadId)) {
                pending += (try? await app.client.interactions(thread))?.filter { wanted.contains($0.id) } ?? []
            }
            approvals = pending.sorted { $0.id < $1.id }
        } catch {
            self.error = error.localizedDescription
        }
    }
}
