import SwiftUI

/// A Bot Teams channel. Channels live in the bot-teams plugin's own store,
/// so this reads and writes through its RPC rather than core threads.
struct ChannelView: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    let room: Room
    /// The channel as last loaded, with its members and settings.
    @State private var current: Room?
    @State private var bots: [Bot] = []
    @State private var runs: [RoomRun] = []
    @State private var activeJobs: [RoomJob] = []
    @State private var busy = false
    @State private var stopping = false
    @State private var retrying: String?
    @State private var showingDetails = false
    @State private var name: String?
    @State private var renaming = false
    @State private var newName = ""
    @State private var messages: [RoomMessage] = []
    @State private var draft = ""
    @State private var error: String?
    @State private var listener: UUID?
    @State private var dictating = false
    @State private var showingAutomations = false
    /// Tool approvals and questions from bots working on this channel's jobs.
    @State private var approvals: [PendingInteraction] = []

    var body: some View {
        transcript
        .defaultScrollAnchor(.bottom)
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) { composer }
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
                    Button { showingDetails = true } label: { Label("Members & Settings", systemImage: "person.2") }
                    Button {
                        newName = name ?? room.name
                        renaming = true
                    } label: { Label("Rename channel", systemImage: "pencil") }
                    Button { showingAutomations = true } label: { Label("Automations", systemImage: "clock.arrow.circlepath") }
                } label: { Image(systemName: "ellipsis") }
                .accessibilityLabel("More")
            }
        }
        .sheet(isPresented: $showingAutomations) { ChannelAutomationsSheet(room: room) }
        .sheet(isPresented: $showingDetails) {
            ChannelDetailsSheet(room: current ?? room, bots: bots) { updated in
                if let updated {
                    current = updated
                    name = updated.name
                    if updated.archived == true { dismiss() }
                } else {
                    dismiss()
                }
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
            // A channel opened from a thread's profile starts with a link back to it.
            if draft.isEmpty, let handoff = ChannelHandoff.take(room.id) { draft = handoff + "\n\n" }
            listener = app.realtime.listen { event in
                if case .pluginSignal(let pluginId, _, _) = event, pluginId == "bot-teams" {
                    Task { await load() }
                }
            }
            await load()
            bots = (try? await app.client.botTeams().bots) ?? bots
        }
        .onDisappear { if let listener { app.realtime.removeListener(listener) } }
    }

    private var transcript: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                ForEach(messages) { message in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(message.speaker)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(message.isOwner ? Color.accentColor : .secondary)
                        MarkdownText(message.text).textSelection(.enabled)
                        if let run = failedRouting[message.id] { routingFailure(run) }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                ForEach(runs.filter { $0.routing == "error" && !messages.map(\.id).contains($0.id) }) { run in
                    routingFailure(run)
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
    }

    private var composer: some View {
        VStack(spacing: 0) {
            if busy { workingBar }
            HStack(alignment: .bottom, spacing: 8) {
                Button { dictating = true } label: { Image(systemName: "mic.fill").font(.title3) }
                TextField("Message #\(name ?? room.name)", text: $draft, axis: .vertical)
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
        }
        .background(.bar)
    }

    /// Messages whose routing failed, by message id.
    private var failedRouting: [String: RoomRun] {
        Dictionary(runs.filter { $0.routing == "error" }.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    }

    /// Nobody was picked to answer: the routing model failed. Retry routes the message again.
    private func routingFailure(_ run: RoomRun) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Label(run.routingError ?? "Couldn't choose which bots answer.", systemImage: "exclamationmark.triangle.fill")
                .font(.caption)
                .foregroundStyle(.red)
            Spacer(minLength: 0)
            Button {
                Task {
                    retrying = run.id
                    do {
                        try await app.client.retryRouting(room.id, message: run.id)
                        await load()
                    } catch {
                        self.error = BBClient.describe(error, server: app.client.baseURL)
                    }
                    retrying = nil
                }
            } label: {
                if retrying == run.id { ProgressView() } else { Text("Retry Routing") }
            }
            .font(.caption.weight(.semibold))
            .buttonStyle(.bordered)
            .controlSize(.small)
            .disabled(retrying != nil)
        }
    }

    /// Who's working, and Stop to cancel all of it.
    private var workingBar: some View {
        HStack(spacing: 8) {
            ProgressView().controlSize(.small)
            Text(workingText)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Spacer(minLength: 0)
            Button(role: .destructive) {
                Task {
                    stopping = true
                    do {
                        try await app.client.stopRoom(room.id)
                        await load()
                    } catch {
                        self.error = BBClient.describe(error, server: app.client.baseURL)
                    }
                    stopping = false
                }
            } label: {
                Label("Stop", systemImage: "stop.fill")
            }
            .font(.footnote.weight(.semibold))
            .buttonStyle(.bordered)
            .controlSize(.small)
            .disabled(stopping)
        }
        .padding(.horizontal)
        .padding(.top, 8)
    }

    private var workingText: String {
        let names = Array(Set(activeJobs.map { job in bots.first { $0.id == job.botId }?.name ?? "A bot" })).sorted()
        switch names.count {
        case 0: return "Choosing who answers…"
        case 1: return "\(names[0]) is working…"
        case 2: return "\(names[0]) and \(names[1]) are working…"
        default: return "\(names.count) bots are working…"
        }
    }

    private func load() async {
        do {
            let page = try await app.client.room(room.id)
            messages = page.messages
            if let room = page.room {
                current = room
                name = room.name
            }
            runs = page.runs ?? []
            activeJobs = page.activeJobs
            busy = page.busy
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
