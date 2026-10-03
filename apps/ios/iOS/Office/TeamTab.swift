import SwiftUI

/// Who you work with in this Space: bots as faces, then the conversations you
/// have with them. A face opens the bot's desk; a channel opens the channel.
struct TeamTab: View {
    @EnvironmentObject private var app: AppModel
    @Environment(OfficeContext.self) private var office

    var body: some View {
        NavigationStack(path: $app.teamPath) {
            Group {
                if let team = office.team {
                    TeamList(store: team)
                } else {
                    ProgressView()
                }
            }
            .toolbar { ToolbarItem(placement: .principal) { SpaceSwitcher() } }
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: Route.self) { RouteDestination(route: $0) }
            .navigationDestination(for: BotDeskRoute.self) { BotDeskView(botId: $0.botId) }
        }
    }
}

struct BotDeskRoute: Hashable { var botId: String }

private struct TeamList: View {
    @Environment(OfficeContext.self) private var office
    let store: TeamStore

    private let columns = [GridItem(.adaptive(minimum: 76), spacing: 12)]

    var body: some View {
        List {
            if let error = store.error, store.bots.isEmpty {
                Section { ConnectionBanner(message: error) { await store.refresh() } }
            }
            Section("Team") {
                if store.bots.isEmpty {
                    if !store.isLoading {
                        Text("No bots work in this space yet.").foregroundStyle(.secondary)
                    }
                } else {
                    LazyVGrid(columns: columns, spacing: 16) {
                        ForEach(store.bots) { bot in
                            NavigationLink(value: BotDeskRoute(botId: bot.id)) {
                                VStack(spacing: 6) {
                                    Face(bot, size: 52)
                                    Text(bot.name).font(.caption).lineLimit(1)
                                }
                                .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.vertical, 8)
                }
            }
            let channels = store.conversations.filter { !$0.isDirect }
            if !channels.isEmpty {
                Section("Conversations") {
                    ForEach(channels) { conversation in
                        NavigationLink(value: Route.savedView(id: conversation.id)) {
                            HStack(spacing: 10) {
                                Text("#").font(.body.weight(.semibold)).foregroundStyle(.secondary).frame(width: 18)
                                Text(conversation.title)
                                    .fontWeight(conversation.unread ? .semibold : .regular)
                                    .lineLimit(1)
                                if conversation.needsYou {
                                    Circle().fill(.orange).frame(width: 7, height: 7).accessibilityLabel("Needs you")
                                }
                                Spacer()
                                HStack(spacing: -6) {
                                    ForEach(conversation.memberBotIds.prefix(3), id: \.self) { id in
                                        if let bot = office.bot(id) {
                                            Face(name: bot.name, avatar: bot.avatar, size: 20)
                                                .overlay(Circle().stroke(Color(.systemBackground), lineWidth: 1.5))
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await store.refresh() }
        .task(id: store.spaceId) { await store.load() }
    }
}

/// A bot's desk: the ongoing DM, the tasks you've handed it, and its profile.
struct BotDeskView: View {
    @EnvironmentObject private var app: AppModel
    @Environment(OfficeContext.self) private var office
    let botId: String
    @State private var desk: OfficeBotDesk?
    @State private var error: String?
    @State private var tab = "chat"
    @State private var delegating = false

    var body: some View {
        VStack(spacing: 0) {
            if let desk {
                header(desk.bot)
                Picker("Section", selection: $tab) {
                    Text("Chat").tag("chat")
                    Text("Tasks").tag("tasks")
                    Text("Profile").tag("profile")
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
                .padding(.bottom, 8)
                switch tab {
                case "tasks": tasks(desk)
                case "profile": profile(desk)
                default: chat(desk)
                }
            } else if let error {
                ContentUnavailableView("Couldn't load this bot", systemImage: "exclamationmark.triangle", description: Text(error))
            } else {
                ProgressView().frame(maxHeight: .infinity)
            }
        }
        .navigationTitle(desk?.bot.name ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { delegating = true } label: { Label("Give a Task", systemImage: "paperplane") }
                    .disabled(desk == nil)
            }
        }
        .sheet(isPresented: $delegating, onDismiss: { Task { await load() } }) {
            DelegateSheet(bots: office.team?.bots ?? desk.map { [$0.bot] } ?? [], initialBotId: botId)
        }
        .task(id: botId) { await load() }
    }

    private func load() async {
        do {
            desk = try await app.client.officeBotDesk(botId)
            error = nil
        } catch {
            if !BBClient.isCancellation(error) { self.error = BBClient.describe(error) }
        }
    }

    private func header(_ bot: OfficeTeamBot) -> some View {
        HStack(spacing: 14) {
            Face(bot, size: 52)
            VStack(alignment: .leading, spacing: 2) {
                Text(bot.name).font(.title3.weight(.semibold))
                Text([bot.role, stateLabel(bot.state)].compactMap { $0 }.joined(separator: " · "))
                    .font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
            }
            Spacer()
        }
        .padding()
    }

    private func stateLabel(_ state: OfficeBotState) -> String {
        switch state {
        case .idle: "Idle"
        case .working: "Working"
        case .needsYou: "Needs you"
        }
    }

    @ViewBuilder
    private func chat(_ desk: OfficeBotDesk) -> some View {
        if let threadId = desk.directThreadId {
            ThreadView(threadId: threadId).id(threadId)
        } else {
            VStack(spacing: 12) {
                Text("You haven't talked with \(desk.bot.name) directly yet.").foregroundStyle(.secondary)
                Button("Message \(desk.bot.name)") {
                    Task {
                        _ = try? await app.client.officePendingCall("talk_dm", ["botId": .string(botId)])
                        await load()
                    }
                }
                .buttonStyle(.borderedProminent)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func tasks(_ desk: OfficeBotDesk) -> some View {
        List {
            if desk.tasks.isEmpty {
                Text("No tasks yet. Give \(desk.bot.name) a task and it reports back to your Inbox.")
                    .foregroundStyle(.secondary)
            }
            ForEach(desk.tasks) { task in OfficeTaskRow(task: task, bot: desk.bot) }
        }
    }

    private func profile(_ desk: OfficeBotDesk) -> some View {
        List {
            Section {
                LabeledContent("Role", value: desk.bot.role ?? "Not set")
                LabeledContent("Model", value: desk.bot.model ?? "Space default")
                LabeledContent("Trust", value: trustLabel(desk.bot.trust))
            }
            if let memory = desk.memory {
                Section("Mission") { Text(memory.mission.isEmpty ? "No mission yet." : memory.mission).font(.callout) }
                Section("Memory") { Text(memory.memory.isEmpty ? "Nothing remembered yet." : memory.memory).font(.callout) }
            }
            Section {
                NavigationLink(value: Route.bot(id: botId)) { Label("Edit Profile", systemImage: "pencil") }
            }
        }
    }

    private func trustLabel(_ trust: OfficeTrust?) -> String {
        switch trust {
        case .readOnly: "Read only"
        case .act: "Acts and reports"
        default: "Asks first"
        }
    }
}
