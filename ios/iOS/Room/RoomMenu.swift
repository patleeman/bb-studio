import SwiftUI

struct RoomMenu: View {
    static let hitPadding: CGFloat = 12

    let bot: BotSpace
    @ObservedObject var store: BotSpacesStore
    let view: BotThreadsView?
    /// Strands that need you, beside Strands.
    let needsCount: Int?
    var closeInColumn = false
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
        ViewThatFits(in: .vertical) {
            menu(compact: false)
            menu(compact: true)
            ScrollView { menu(compact: true) }.scrollBounceBehavior(.basedOnSize)
        }
        .frame(maxWidth: 640, maxHeight: .infinity, alignment: .top)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("RoomMenu")
    }

    private func menu(compact: Bool) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                botName
                Spacer()
                if !closeInColumn {
                    Button(action: close) {
                        Image(systemName: "xmark").font(.body.weight(.semibold)).frame(width: 44, height: 44)
                    }
                    .buttonStyle(.plain)
                    .lookGlass(look, \.hud, in: .circle, interactive: true)
                    .accessibilityLabel("Back to the room")
                    .accessibilityIdentifier("roomMenuClose")
                }
            }
            .frame(minHeight: 44)
            VStack(alignment: .leading, spacing: 0) {
                ForEach(RoomPlace.menu) { place in
                    Button { openPlace(place) } label: {
                        HStack(alignment: .firstTextBaseline, spacing: 12) {
                            Text(place.title).font(.system(size: compact ? 28 : 34, weight: .semibold))
                            if place == .strands, let needsCount, needsCount > 0 {
                                Text(StrandOverviewRules.line(needs: needsCount, running: 0)).font(.subheadline.weight(.medium)).foregroundStyle(.white.opacity(0.55))
                            }
                        }
                        .foregroundStyle(.white)
                        .padding(.horizontal, RoomMenu.hitPadding)
                        .frame(minHeight: compact ? 46 : 56)
                        .contentShape(.rect)
                        .lookHalo(look)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("roomPlace-\(place.rawValue)")
                }
            }
            .padding(.horizontal, -RoomMenu.hitPadding)
            .padding(.top, compact ? 12 : 40)
            Spacer(minLength: compact ? 10 : 16)
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
            HStack(spacing: 0) {
                Button(action: theme) { Text("Theme").padding(.horizontal, 11).frame(minHeight: 44).contentShape(.rect) }.accessibilityIdentifier("roomTheme")
                Button(action: settings) { Text("Settings").padding(.horizontal, 11).frame(minHeight: 44).contentShape(.rect) }.accessibilityIdentifier("roomSettings")
            }
            .padding(.horizontal, -11)
            .font(.subheadline)
            .foregroundStyle(.white.opacity(0.65))
            .frame(minHeight: 44)
            .padding(.top, compact ? 4 : 10)
        }
        .padding(.horizontal, 22)
        .padding(.top, 8)
        .padding(.bottom, 12)
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

struct RoomColumnMenuButton: View {
    let open: Bool
    let reduceMotion: Bool
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(open ? "Back to the room" : "Everything else", systemImage: open ? "xmark" : "line.3.horizontal")
                .contentTransition(reduceMotion ? .opacity : .symbolEffect(.replace))
        }
        .accessibilityIdentifier(open ? "roomMenuClose" : "roomMenuButton")
    }
}

struct RoomPlaceSheet: View {
    static let sliver: CGFloat = 12

    let place: RoomPlace
    let bot: BotSpace
    @ObservedObject var store: BotSpacesStore
    let mainThreadId: String
    var open: (BotShellItem) -> Void
    var startedConversation: (String) -> Void
    var closeToRoom: () -> Void
    var theme: String = ""
    var chooseTheme: (String) -> Void = { _ in }
    var path: Binding<[Route]>? = nil
    var back: (() -> Void)? = nil
    /// The conversation is home: the list carries the Bot and its places; `shown` is the open conversation.
    var home = false
    var shown: String? = nil
    var settings: (() -> Void)? = nil
    var switchBot: ((String, String?) -> Void)? = nil
    @State private var ownPath: [Route] = []
    @EnvironmentObject private var app: AppModel
    @Environment(\.look) private var look

    var body: some View {
        NavigationStack(path: path ?? $ownPath) {
            Group {
                if let back {
                    content
                        .environment(\.spreadInline, true)
                        .toolbar(.hidden, for: .navigationBar)
                        .safeAreaInset(edge: .top, spacing: 0) { RoomSpreadHeader(title: place.title, back: back) }
                        .containerBackground(.clear, for: .navigation)
                } else {
                    content
                }
            }
                .navigationDestination(for: Route.self) { RouteDestination(route: $0) }
        }
        .tint(look.accent)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("RoomSheet-\(place.rawValue)")
    }

    @ViewBuilder private var content: some View { content(for: place) }

    @ViewBuilder private func content(for place: RoomPlace) -> some View {
        switch place {
        case .strands:
            StrandsOverviewView(botId: bot.id) { open(.conversation($0)) }
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
                              started: startedConversation, closeToRoom: closeToRoom,
                              home: home, shown: shown ?? mainThreadId, settings: settings,
                              placeView: { AnyView(content(for: $0)) }, switchBot: switchBot)
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
    var home = false
    var shown: String? = nil
    var settings: (() -> Void)? = nil
    var placeView: ((RoomPlace) -> AnyView)? = nil
    /// Another Bot from the header's menu (the home's list); with a conversation, that Bot opens on it.
    var switchBot: ((String, String?) -> Void)? = nil
    @EnvironmentObject private var app: AppModel
    @State private var starting = false
    @State private var removed: Set<String> = []
    /// Conversations whose workers the user opened or closed; others open while one runs or needs you.
    @State private var toggled: [String: Bool] = [:]
    @State private var openFolds: Set<String> = []
    @State private var deleting: BotConversation?
    @Environment(\.look) private var look

    private var view: BotThreadsView? { store.view(for: bot.id) }

    var body: some View {
        let lines = BotShell.lines(view).filter { !removed.contains($0.threadId) }
        let nests = BotWorkerNests.make(conversations: lines.map(\.threadId), workers: view?.workers ?? [])
        List {
            if home {
                Section { RoomListHeader(bot: bot, view: view, refresh: { await store.refresh() }, switchBot: switchBot.map { pick in { pick($0, nil) } }) }
                    .listRowBackground(Color.clear)
            }
            Section {
                Button { starting = true } label: {
                    Label("New conversation", systemImage: "plus.circle.fill")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(look.accent)
                        .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
                        .contentShape(.rect)
                }
                .buttonStyle(.borderless)
                .accessibilityIdentifier("roomNewConversationRow")
                ForEach(lines) { line in
                    let nest = nests.nests[line.threadId]
                    HStack(spacing: 8) {
                        Button {
                            open(.conversation(line.threadId))
                        } label: {
                            HStack {
                                BotConversationRow(line: line)
                                if line.threadId == (shown ?? mainThreadId) {
                                    Text("You're here").font(.footnote).foregroundStyle(look.success)
                                }
                            }
                            .contentShape(.rect)
                        }
                        .buttonStyle(.borderless)
                        .tint(.primary)
                        .accessibilityIdentifier("roomConversation-\(line.threadId)")
                        if let nest {
                            nestToggle(nest, key: line.threadId)
                        }
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) { removeActions(line.threadId, swipe: true) }
                    .contextMenu { removeActions(line.threadId, swipe: false) }
                    if let nest, nestOpen(nest, key: line.threadId) {
                        workerLines(nest, parent: line.threadId)
                    }
                }
            }
            if let other = nests.other, !other.nodes.isEmpty {
                Section("Other workers") {
                    workerLines(other, parent: "other")
                }
            }
            Section {
                if home, let placeView {
                    ForEach(RoomPlace.homeList) { place in
                        NavigationLink { placeView(place) } label: { Label(place.title, systemImage: place.symbol) }
                            .accessibilityIdentifier("roomPlace-\(place.rawValue)")
                    }
                }
                NavigationLink {
                    ArchivePageView(botId: bot.id, open: open, refresh: { Task { await store.refresh() } })
                } label: {
                    Label("Archive", systemImage: "archivebox")
                }
                .accessibilityIdentifier("roomArchive")
                if home, let settings {
                    Button(action: settings) { Label("Settings", systemImage: "gearshape") }
                        .tint(.primary)
                        .accessibilityIdentifier("roomSettings")
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .refreshable { await store.refresh() }
        .modifier(PageChrome(title: "Conversations") {
            Button { starting = true } label: { Image(systemName: "plus") }
                .accessibilityLabel("New conversation")
                .accessibilityIdentifier("roomNewConversation")
        })
        .onChange(of: view?.conversations.map(\.threadId)) { _, ids in
            removed.formIntersection(ids ?? [])
        }
        .alert(ConversationFinish.deleteTitle(deleting?.title ?? ""),
               isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), presenting: deleting) { conversation in
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) { remove(conversation.threadId, delete: true) }
                .accessibilityIdentifier("confirmDelete")
        } message: { _ in
            Text(ConversationFinish.deleteMessage)
        }
        .sheet(isPresented: $starting) {
            NewThreadView(botId: bot.id) { id, botId in
                Task {
                    // Another Bot's list loads first, so its room opens on the new conversation.
                    if let botId, botId != bot.id { store.watch(botId, fetch: false) }
                    await store.refresh()
                    guard let botId else { return open(.worker(id)) }
                    guard botId != bot.id, let switchBot else { return started(id) }
                    RoomHome.remember(id, botId: botId)
                    switchBot(botId, id)
                }
            }
        }
    }

    @ViewBuilder private func removeActions(_ threadId: String, swipe: Bool) -> some View {
        if let conversation = view?.conversations.first(where: { $0.threadId == threadId }), ConversationFinish.canRemove(conversation) {
            Button { remove(threadId, delete: false) } label: { Label("Archive", systemImage: "archivebox") }
                .tint(.indigo)
                .accessibilityIdentifier("roomConversationArchive-\(threadId)")
            Button(role: swipe ? nil : .destructive) { deleting = conversation } label: { Label("Delete", systemImage: "trash") }
                .tint(.red)
                .accessibilityIdentifier("roomConversationDelete-\(threadId)")
        }
    }

    private func remove(_ threadId: String, delete: Bool) {
        withAnimation(.snappy) { _ = removed.insert(threadId) }
        let client = app.client
        Task {
            do {
                if delete {
                    try await client.delete(threadId, withChildren: true)
                } else {
                    try await client.finishConversation(threadId: threadId)
                }
                await store.refresh()
            } catch {
                withAnimation(.snappy) { _ = removed.remove(threadId) }
                app.flash((delete ? "It didn't delete: " : "It didn't archive: ") + BBClient.describe(error, server: client.baseURL))
            }
        }
    }

    private func nestOpen(_ nest: BotWorkerNest, key: String) -> Bool {
        toggled[key] ?? (nest.running > 0 || nest.needsYou > 0)
    }

    /// The toggle on a conversation's row: a chevron and the count, a spinner while one runs, amber while one needs you.
    private func nestToggle(_ nest: BotWorkerNest, key: String) -> some View {
        let isOpen = nestOpen(nest, key: key)
        return Button {
            withAnimation(.snappy) { toggled[key] = !isOpen }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: isOpen ? "chevron.down" : "chevron.right").font(.caption2.weight(.semibold))
                if nest.needsYou > 0 {
                    Circle().fill(look.needsYou).frame(width: 6, height: 6)
                    Text("\(nest.needsYou)")
                }
                if nest.running > 0 {
                    ProgressView().controlSize(.mini)
                    Text("\(nest.running)")
                }
                if nest.needsYou == 0 && nest.running == 0 { Text("\(nest.total)") }
            }
            .font(.caption.monospacedDigit())
            .foregroundStyle(nest.needsYou > 0 ? AnyShapeStyle(look.needsYou) : AnyShapeStyle(.secondary))
            .padding(.horizontal, 7).frame(minHeight: 26)
            .overlay(Capsule().strokeBorder(nest.needsYou > 0 ? AnyShapeStyle(look.needsYou.opacity(0.5)) : AnyShapeStyle(.separator), lineWidth: 0.5))
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(.rect)
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(nest.label)
        .accessibilityValue(isOpen ? "Shown" : "Hidden")
        .accessibilityIdentifier("roomNestToggle-\(key)")
    }

    @ViewBuilder private func workerLines(_ nest: BotWorkerNest, parent: String) -> some View {
        ForEach(BotWorkerNests.lines(nest.nodes, parent: parent, openFolds: openFolds)) { line in
            switch line {
            case .worker(let worker, let depth):
                workerRow(worker, depth: depth)
            case .fold(let key, let count, let depth):
                Button {
                    withAnimation(.snappy) { if openFolds.contains(key) { openFolds.remove(key) } else { openFolds.insert(key) } }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: openFolds.contains(key) ? "chevron.down" : "chevron.right").font(.caption2.weight(.semibold))
                        Text("\(count) done")
                        Spacer()
                    }
                    .font(.subheadline).foregroundStyle(.secondary)
                    .padding(.leading, 20 + CGFloat(depth) * 16)
                    .contentShape(.rect)
                }
                .tint(.primary)
                .accessibilityIdentifier("roomFold-\(key)")
            }
        }
    }

    private func workerRow(_ worker: BotWorker, depth: Int) -> some View {
        Button { open(.worker(worker.threadId)) } label: {
            HStack(spacing: 8) {
                BotWorkerGlyph(status: worker.status).frame(width: 16)
                if let logo = ProviderLogo(worker.providerId) {
                    logo.frame(width: 13, height: 13).accessibilityHidden(true)
                }
                Text(worker.title.isEmpty ? "Worker" : worker.title).lineLimit(1)
                Spacer(minLength: 8)
                Text(BotShell.shortAge(worker.updatedAt)).font(.footnote).monospacedDigit().foregroundStyle(.secondary)
            }
            .font(.subheadline)
            .padding(.leading, 20 + CGFloat(depth) * 16)
            .contentShape(.rect)
        }
        .tint(.primary)
        .accessibilityIdentifier("roomWorker-\(worker.threadId)")
    }
}
