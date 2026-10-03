import SwiftUI

/// A Bot Teams bot, opened from Studio: who it is, the threads that work as
/// it, and the channels it's in.
struct BotView: View {
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }
    let id: String
    @State private var teams: BotTeamsList?
    @State private var threads: [ProfileThread] = []
    @State private var starting = false
    @State private var error: String?

    var body: some View {
        List {
            if let bot = teams?.bots.first(where: { $0.id == id }) {
                Section {
                    HStack(spacing: 14) {
                        Text(bot.avatar ?? "🤖").font(.system(size: 44))
                        VStack(alignment: .leading, spacing: 4) {
                            Text(bot.name).font(.title3.weight(.semibold))
                            if bot.retired == true {
                                Text("Retired").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                            } else if teams?.directThreads[bot.id]?.status == "active" {
                                Text("Working").font(.caption.weight(.semibold)).foregroundStyle(.green)
                            }
                        }
                    }
                    if let description = bot.description, !description.isEmpty {
                        Text(description).foregroundStyle(.secondary)
                    }
                }
                Section {
                    NavigationLink { BotDocumentView(bot: bot, file: "MISSION.md") } label: {
                        Label("Mission", systemImage: "scope")
                    }
                    NavigationLink { BotDocumentView(bot: bot, file: "MEMORY.md") } label: {
                        Label("Memory", systemImage: "brain")
                    }
                }
                Section {
                    if bot.retired != true {
                        Button { Task { await message() } } label: {
                            Label("Message", systemImage: "bubble.left.and.text.bubble.right")
                        }
                        .disabled(starting)
                    }
                    ForEach(threads) { thread in
                        NavigationLink(value: Route.thread(id: thread.threadId)) {
                            HStack {
                                Text(thread.title).lineLimit(1)
                                Spacer()
                                if thread.archived {
                                    Text("Archived").font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                } header: {
                    Text("Threads")
                } footer: {
                    Text("Threads working as \(bot.name). Choose Work as bot in any thread's menu.")
                }
                let rooms = teams?.views.filter { !$0.archived && $0.members.contains { $0.kind == "bot" && $0.id == id } } ?? []
                if !rooms.isEmpty {
                    Section("Channels") {
                        ForEach(rooms) { room in
                            NavigationLink(value: Route.savedView(id: room.id)) { Label(room.name, systemImage: "rectangle.stack") }
                        }
                    }
                }
            } else if teams != nil {
                ContentUnavailableView("Bot Not Found", systemImage: "person.crop.circle.badge.questionmark")
            }
            if let error { Text(error).font(.footnote).foregroundStyle(.red) }
        }
        .overlay { if teams == nil, error == nil { ProgressView() } }
        .navigationTitle(teams?.bots.first { $0.id == id }?.name ?? "Bot")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load() }
    }

    private func load() async {
        do {
            async let list = client.botTeams()
            async let profileThreads = client.profileThreads(id)
            (teams, threads) = try await (list, profileThreads)
            error = nil
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
    }

    /// Starts a new thread working as this bot, like Message on the web.
    private func message() async {
        starting = true
        defer { starting = false }
        do {
            let threadId = try await client.newProfileThread(id)
            operation.complete(on: app) { app.push(.thread(id: threadId)) }
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
    }
}
