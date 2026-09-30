import SwiftUI

/// A Bot Teams bot, opened from Studio: who it is, its direct messages and
/// the channels it's in.
struct BotView: View {
    @EnvironmentObject private var app: AppModel
    let id: String
    @State private var teams: BotTeamsList?
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
                let dms = teams?.directMessages.filter { $0.bot.id == id } ?? []
                if !dms.isEmpty {
                    Section("Direct messages") {
                        ForEach(dms, id: \.threadId) { dm in
                            NavigationLink(value: Route.thread(id: dm.threadId)) {
                                BotRow(bot: bot, title: dm.info?.title, unread: dm.info?.unread == true)
                            }
                        }
                    }
                }
                let rooms = teams?.rooms.filter { $0.archived != true && $0.memberIds.contains(id) } ?? []
                if !rooms.isEmpty {
                    Section("Channels") {
                        ForEach(rooms) { room in
                            NavigationLink(value: Route.room(room)) { Label(room.name, systemImage: "number") }
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
            teams = try await app.client.botTeams()
            error = nil
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }
}
