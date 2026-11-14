import SwiftUI

struct RoomMenu: View {
    let bot: BotSpace
    @ObservedObject var store: BotSpacesStore
    let view: BotThreadsView?
    let todayCount: Int?
    var close: () -> Void
    var openPlace: (RoomPlace) -> Void
    var openWorker: (String) -> Void
    var theme: () -> Void
    var settings: () -> Void
    var switchBot: (String) -> Void
    @Environment(\.look) private var look

    private var working: BotWorker? {
        view?.workers.filter { $0.status == .running }.max { $0.updatedAt < $1.updatedAt }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                botName
                Spacer()
                Button(action: close) {
                    Image(systemName: "xmark").font(.body.weight(.semibold)).frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .lookGlass(look, \.hud, in: .circle, interactive: true)
                .accessibilityLabel("Back to the room")
                .accessibilityIdentifier("roomMenuClose")
            }
            VStack(alignment: .leading, spacing: 0) {
                ForEach(RoomPlace.menu) { place in
                    Button { openPlace(place) } label: {
                        HStack(alignment: .firstTextBaseline, spacing: 12) {
                            Text(place.title).font(.system(size: 34, weight: .semibold))
                            if place == .todos, let todayCount {
                                Text("\(todayCount) today").font(.subheadline.weight(.medium)).foregroundStyle(.white.opacity(0.55))
                            }
                        }
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
                        .contentShape(.rect)
                        .lookHalo(look)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("roomPlace-\(place.rawValue)")
                }
            }
            .padding(.top, 40)
            Spacer(minLength: 16)
            if let working {
                Button { openWorker(working.threadId) } label: {
                    HStack(spacing: 12) {
                        Circle().fill(look.success).frame(width: 8, height: 8)
                            .background(Circle().fill(look.success.opacity(0.18)).frame(width: 16, height: 16))
                        Text(working.title.isEmpty ? "Worker" : working.title).font(.subheadline.weight(.medium)).lineLimit(1)
                        Spacer(minLength: 8)
                        Text(BotShell.shortAge(working.updatedAt)).font(.footnote).foregroundStyle(.white.opacity(0.5))
                    }
                    .foregroundStyle(.white)
                    .padding(14)
                    .frame(minHeight: 56)
                    .background(look.canvas.opacity(0.82), in: .rect(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.white.opacity(0.08)))
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Working now: \(working.title)")
                .accessibilityIdentifier("roomWorkingNow")
            }
            HStack(spacing: 22) {
                Button(action: theme) { Text("Theme").frame(minHeight: 44).contentShape(.rect) }.accessibilityIdentifier("roomTheme")
                Button(action: settings) { Text("Settings").frame(minHeight: 44).contentShape(.rect) }.accessibilityIdentifier("roomSettings")
            }
            .font(.subheadline)
            .foregroundStyle(.white.opacity(0.65))
            .frame(minHeight: 44)
            .padding(.top, 10)
        }
        .padding(.horizontal, 22)
        .padding(.top, 8)
        .padding(.bottom, 12)
        .frame(maxWidth: 640, maxHeight: .infinity, alignment: .top)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("RoomMenu")
    }

    @ViewBuilder private var botName: some View {
        let bots = store.spaces?.bots ?? []
        if bots.count > 1 {
            Menu {
                ForEach(bots) { each in
                    Button(each.name) { switchBot(each.id) }
                }
            } label: {
                HStack(spacing: 4) {
                    Text(bot.name)
                    Image(systemName: "chevron.down").font(.caption2.weight(.semibold))
                }
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.7))
                .frame(minHeight: 44)
            }
            .accessibilityLabel("\(bot.name), switch Bot")
        } else {
            Text(bot.name).font(.subheadline).foregroundStyle(.white.opacity(0.7))
        }
    }
}

struct RoomPlaceSheet: View {
    static let sliver: CGFloat = 12

    let place: RoomPlace
    let bot: BotSpace
    @ObservedObject var store: BotSpacesStore
    let mainThreadId: String
    let todayCount: Int?
    var open: (BotShellItem) -> Void
    var startedConversation: (String) -> Void
    var closeToRoom: () -> Void
    var theme: String = ""
    var chooseTheme: (String) -> Void = { _ in }
    @EnvironmentObject private var app: AppModel
    @Environment(\.look) private var look

    var body: some View {
        NavigationStack {
            content
                .navigationDestination(for: Route.self) { RouteDestination(route: $0) }
        }
        .tint(look.accent)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("RoomSheet-\(place.rawValue)")
    }

    @ViewBuilder private var content: some View {
        switch place {
        case .todos:
            LoopsView(attention: nil, openChat: { open(.conversation(mainThreadId)) })
                .navigationTitle("Todos")
                .navigationBarTitleDisplayMode(.large)
        case .memory:
            MemoryPageView(botId: bot.id, open: open)
        case .library:
            LibraryPageView(botId: bot.id, open: open, tiles: true)
        case .schedules:
            BotAutomationsSheet(botId: bot.id, botName: bot.name, embedded: true).id(bot.id)
        case .theme:
            RoomThemePicker(bot: bot, current: theme, choose: chooseTheme)
        case .archive:
            ArchivePageView(botId: bot.id, open: open, refresh: { Task { await store.refresh() } })
        case .conversations:
            RoomConversations(bot: bot, store: store, mainThreadId: mainThreadId, open: open,
                              started: startedConversation, closeToRoom: closeToRoom)
        }
    }
}

struct RoomConversations: View {
    let bot: BotSpace
    @ObservedObject var store: BotSpacesStore
    let mainThreadId: String
    var open: (BotShellItem) -> Void
    var started: (String) -> Void
    var closeToRoom: () -> Void
    @EnvironmentObject private var app: AppModel
    @State private var starting = false
    @State private var showsEarlier = false
    @Environment(\.look) private var look

    private var view: BotThreadsView? { store.view(for: bot.id) }

    var body: some View {
        let lines = BotShell.lines(view)
        let split = BotShell.splitWorkers(view?.workers ?? [])
        let today = split.done.filter { Calendar.current.isDateInToday(Date(timeIntervalSince1970: $0.updatedAt / 1000)) }
        let earlier = split.done.filter { !Calendar.current.isDateInToday(Date(timeIntervalSince1970: $0.updatedAt / 1000)) }
        List {
            Section {
                ForEach(lines) { line in
                    Button {
                        if line.threadId == mainThreadId { closeToRoom() } else { open(.conversation(line.threadId)) }
                    } label: {
                        HStack {
                            BotConversationRow(line: line)
                            if line.threadId == mainThreadId {
                                Text("You're here").font(.footnote).foregroundStyle(look.success)
                            }
                        }
                        .contentShape(.rect)
                    }
                    .tint(.primary)
                    .accessibilityIdentifier("roomConversation-\(line.threadId)")
                }
            }
            if !split.active.isEmpty {
                Section("Working now") {
                    ForEach(split.active) { worker in workerRow(worker) }
                }
            }
            if !today.isEmpty {
                Section("Finished today") {
                    ForEach(today) { worker in workerRow(worker) }
                }
            }
            if !earlier.isEmpty {
                Section {
                    if showsEarlier {
                        ForEach(earlier) { worker in workerRow(worker) }
                    } else {
                        Button { withAnimation(.snappy) { showsEarlier = true } } label: {
                            HStack {
                                Text("\(earlier.count) earlier")
                                Spacer()
                                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                            }
                            .foregroundStyle(.secondary)
                            .contentShape(.rect)
                        }
                        .accessibilityIdentifier("roomEarlier")
                    }
                } header: {
                    if showsEarlier { Text("Earlier") }
                }
            }
            Section {
                NavigationLink {
                    ArchivePageView(botId: bot.id, open: open, refresh: { Task { await store.refresh() } })
                } label: {
                    Label("Archive", systemImage: "archivebox")
                }
                .accessibilityIdentifier("roomArchive")
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .refreshable { await store.refresh() }
        .navigationTitle("Conversations")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { starting = true } label: { Image(systemName: "plus") }
                    .accessibilityLabel("New conversation")
                    .accessibilityIdentifier("roomNewConversation")
            }
        }
        .sheet(isPresented: $starting) {
            NewConversationSheet(botName: bot.name) { text in
                let id = try await BotShell.startConversation(text, bot: bot, view: view, client: app.client)
                await store.refresh()
                started(id)
            }
        }
    }

    private func workerRow(_ worker: BotWorker) -> some View {
        Button { open(.worker(worker.threadId)) } label: {
            HStack(spacing: 12) {
                BotWorkerGlyph(status: worker.status).frame(width: 16)
                VStack(alignment: .leading, spacing: 2) {
                    Text(worker.title.isEmpty ? "Worker" : worker.title).lineLimit(1)
                    if let owner = worker.ownerTitle {
                        Text(owner).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                Text(BotShell.shortAge(worker.updatedAt)).font(.footnote).monospacedDigit().foregroundStyle(.secondary)
            }
            .contentShape(.rect)
        }
        .tint(.primary)
        .accessibilityIdentifier("roomWorker-\(worker.threadId)")
    }
}
