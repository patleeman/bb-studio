import SwiftUI

/// The bot a thread works as, like Work as bot beside the web composer. A
/// thread works as one bot; inviting another opens a new channel with both,
/// its draft linked back to this thread.
struct ThreadProfileSheet: View {
    let thread: ThreadEntry
    /// The attached bot's id, or nil for an ordinary thread.
    let botId: String?
    let onChange: (String?) -> Void
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }
    @Environment(\.dismiss) private var dismiss
    @State private var bots: [Bot] = []
    @State private var loaded = false
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                if !loaded {
                    ProgressView().frame(maxWidth: .infinity)
                } else if let botId {
                    let bot = bots.first { $0.id == botId }
                    Section {
                        if let bot { BotRow(bot: bot) } else { Text("Archived bot").foregroundStyle(.secondary) }
                        Button("Stop working as \(bot?.name ?? "this bot")", role: .destructive) { Task { await attach(nil) } }
                            .disabled(busy)
                    } header: {
                        Text("Working as")
                    } footer: {
                        Text(busy ? "Change the bot after this response." : "Changing the model keeps the thread working as the bot.")
                    }
                    let others = bots.filter { $0.id != botId }
                    if !others.isEmpty {
                        Section {
                            ForEach(others) { other in
                                Button { Task { await handoff(with: other, current: bot) } } label: { BotRow(bot: other) }
                                    .foregroundStyle(.primary)
                            }
                        } header: {
                            Text("Create a channel")
                        } footer: {
                            Text("Keep this thread and another bot together in a channel.")
                        }
                    }
                } else if bots.isEmpty {
                    ContentUnavailableView("No Bots", systemImage: "person.crop.circle",
                        description: Text("Create a bot in Studio to have threads work as it."))
                } else {
                    Section {
                        ForEach(bots) { bot in
                            Button { Task { await attach(bot.id) } } label: { BotRow(bot: bot) }
                                .foregroundStyle(.primary)
                        }
                        .disabled(busy)
                    } header: {
                        Text("Work as a bot")
                    } footer: {
                        Text(busy
                            ? "Work as a bot after this response."
                            : "The thread works as the bot in its own project, with the bot's mission and memory.")
                    }
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
            }
            .disabled(saving)
            .navigationTitle("Work as bot")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { operation.complete(on: app) { dismiss() } } }
            }
            .task { await load() }
        }
        .presentationDetents([.medium, .large])
    }

    private var busy: Bool { thread.isRunning }

    private func load() async {
        do {
            bots = try await client.profiles()
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
        loaded = true
    }

    private func attach(_ id: String?) async {
        saving = true
        defer { saving = false }
        do {
            try await client.setThreadProfile(thread.id, botId: id)
            operation.complete(on: app) { onChange(id) }
            operation.complete(on: app) { dismiss() }
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
    }

    private func handoff(with other: Bot, current: Bot?) async {
        saving = true
        defer { saving = false }
        do {
            let view = try await client.createSavedView(name: thread.displayTitle, members: [SavedViewMember(kind: "thread", id: thread.id), SavedViewMember(kind: "bot", id: other.id)])
            operation.complete(on: app) { dismiss() }
            operation.complete(on: app) { app.push(.savedView(id: view.id)) }
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
    }
}
