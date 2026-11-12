import SwiftUI

struct BotSpacesRoot: View {
    @EnvironmentObject private var app: AppModel
    @ObservedObject var store: BotSpacesStore
    @StateObject private var shell = BotShellModel()
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        NavigationSplitView(preferredCompactColumn: $shell.compactColumn) {
            BotSpaceList(store: store, shell: shell)
        } detail: {
            NavigationStack(path: $shell.detailPath) {
                detail
                    .navigationDestination(for: Route.self) { RouteDestination(route: $0).environment(\.botConversation, context) }
            }
            .environment(\.botConversation, context)
            .id(shell.selection)
        }
        .lookRoot(bot: BotShell.shownBot(store.spaces, chosen: shell.shownBotId))
        .task(id: store.spaces) { await LookExport.run(store: store, client: app.client) }
        .onChange(of: shell.selection) { _, _ in shell.detailPath = shell.takePendingPush() }
        .onAppear { shell.land(store) }
        .onChange(of: store.spaces) { _, _ in shell.land(store) }
        .onChange(of: store.views) { _, _ in shell.land(store) }
        .onChange(of: app.shellLink, initial: true) { _, link in
            guard let link, store.spaces != nil else { return }
            app.shellLink = nil
            shell.follow(link, store: store)
        }
        .onChange(of: app.botRoute, initial: true) { _, route in
            guard let route, store.spaces != nil else { return }
            app.botRoute = nil
            shell.open(route, store: store)
        }
    }

    private var context: BotConversationContext? {
        let threadId: String
        let kind: BotConversationContext.Kind
        switch shell.selection {
        case .conversation(let id): (threadId, kind) = (id, .conversation)
        case .worker(let id): (threadId, kind) = (id, .worker)
        case .page, nil: return nil
        }
        guard let bot = BotShell.shownBot(store.spaces, chosen: shell.shownBotId) else { return nil }
        let view = store.view(for: bot.id)
        return BotConversationContext(
            threadId: threadId, kind: kind, botId: bot.id, botName: bot.name,
            look: BotLook(shape: bot.shape, color: bot.color, emoji: bot.avatar),
            mainThreadId: BotShell.mainThreadId(bot, view: view),
            conversation: view?.conversations.first { $0.threadId == threadId },
            workers: WorkersLine(conversationId: threadId, view: kind == .conversation ? view : nil),
            allWorkers: view?.workers ?? [],
            splitsThreads: sizeClass == .regular,
            push: { [shell] route in shell.detailPath.append(route) },
            openConversation: { [shell] id in shell.openConversation(id) },
            showList: { [shell] in shell.showList() },
            refresh: { [store] in Task { await store.refresh() } })
    }

    @ViewBuilder private var detail: some View {
        switch shell.selection {
        case .conversation(let id), .worker(let id):
            ThreadView(threadId: id).id(id)
        case .page(let page):
            let bot = BotShell.shownBot(store.spaces, chosen: shell.shownBotId)
            BotPageScreen(page: page, bot: bot, open: { [shell] in shell.open($0) }, openMain: { [shell, store] in
                if let main = BotShell.mainThreadId(bot, view: bot.flatMap { store.view(for: $0.id) }) { shell.openConversation(main) }
            }, refresh: { [store] in Task { await store.refresh() } })
            .id(bot?.id)
        case nil:
            ContentUnavailableView("No conversation selected", systemImage: Symbols.thread)
        }
    }
}

struct BotSpaceList: View {
    @EnvironmentObject private var app: AppModel
    @ObservedObject var store: BotSpacesStore
    @ObservedObject var shell: BotShellModel
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var showsDone = false
    @State private var startingConversation = false
    @Environment(\.look) private var look

    private var bot: BotSpace? { BotShell.shownBot(store.spaces, chosen: shell.shownBotId) }
    private var view: BotThreadsView? { bot.flatMap { store.view(for: $0.id) } }
    private var compact: Bool { sizeClass != .regular }

    var body: some View {
        List(selection: $shell.selection) {
            if let bot {
                header(bot)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 4, leading: 4, bottom: 4, trailing: 4))
                    .selectionDisabled()
                conversations
                workers
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background { backdrop }
        .accessibilityIdentifier("BotSpaceList")
        .accessibilityValue(look.showsScene ? "Scene \(look.theme.name)" : look.theme.name)
        .overlay {
            if store.spaces == nil {
                if let error = store.error {
                    ContentUnavailableView {
                        Label("Bots unavailable", systemImage: "exclamationmark.triangle")
                    } description: { Text(error) } actions: {
                        Button("Retry") { Task { await store.refresh() } }
                    }
                } else {
                    ProgressView()
                }
            }
        }
        .refreshable { await store.refresh() }
        .safeAreaInset(edge: .bottom, spacing: 0) { bottomBar }
        .navigationTitle(bot?.name ?? "Bots")
        .toolbar(compact ? .hidden : .automatic, for: .navigationBar)
        .onChange(of: bot?.id) { _, _ in showsDone = false }
        .sheet(isPresented: $startingConversation) {
            NewConversationSheet(botName: bot?.name ?? "Bot") { try await startConversation($0) }
        }
    }

    /// A scene theme's still (or live scene) behind the list; a classic theme's canvas.
    @ViewBuilder private var backdrop: some View {
        if look.showsScene {
            SceneBackdrop(theme: look.theme, botId: bot?.id, view: view)
        } else {
            RadialGradient(colors: [look.sidebar, look.canvas], center: .top, startRadius: 0, endRadius: 520).ignoresSafeArea()
        }
    }

    /// Rows sit on the theme's glass over a scene, and on its sidebar color otherwise.
    @ViewBuilder private func rowBackground(needsYou: Bool = false) -> some View {
        let fill = needsYou ? look.needsYou.opacity(0.14) : Color.clear
        if look.showsScene {
            Rectangle().fill(fill).glassEffect(.regular.tint(look.glassTint(\.sidebar)), in: .rect)
        } else {
            Rectangle().fill(look.sidebar).overlay(fill)
        }
    }

    private func header(_ bot: BotSpace) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                PresenceView(bot: bot, state: bot.presenceState(live: view),
                             workers: view?.workers.filter { $0.status == .running }.count ?? bot.activity.workers, size: 36)
                VStack(alignment: .leading, spacing: 1) {
                    Text(bot.name).font(.title2.bold()).lineLimit(1)
                    Text(BotShell.status(bot, view: view))
                        .font(.subheadline)
                        .foregroundStyle(BotShell.needsYou(bot, view: view) ? AnyShapeStyle(look.needsYou) : AnyShapeStyle(look.muted))
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .lookHalo(look)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("BotSpaceHeader")
            HStack {
                ForEach(BotPage.allCases) { page in
                    Button { open(.page(page)) } label: {
                        Image(systemName: page.symbol).font(.body.weight(.medium)).frame(width: 44, height: 44)
                    }
                    .buttonStyle(.plain)
                    .lookGlass(look, \.hud, in: .circle, interactive: true)
                    .accessibilityLabel(page.title)
                    .accessibilityIdentifier("BotPage-\(page.rawValue)")
                    if page != BotPage.allCases.last { Spacer(minLength: 4) }
                }
            }
        }
        .padding(.top, 8)
        .contentShape(.rect)
        .gesture(DragGesture(minimumDistance: 24).onEnded { value in
            let dx = value.translation.width
            guard abs(dx) > 50, abs(dx) > abs(value.translation.height) * 1.5 else { return }
            withAnimation(.snappy) { shell.step(dx < 0 ? 1 : -1, store: store, compact: compact) }
        })
    }

    @ViewBuilder private var conversations: some View {
        let lines = BotShell.lines(view)
        Section {
            ForEach(lines) { line in
                NavigationLink(value: BotShellItem.conversation(line.threadId)) {
                    BotConversationRow(line: line)
                }
                .listRowBackground(rowBackground(needsYou: line.tone == .needsYou))
                .accessibilityIdentifier("conversation-\(line.threadId)")
            }
        } header: {
            HStack {
                Text("Conversations").font(.title3.bold()).foregroundStyle(.primary).textCase(nil).lookHalo(look)
                Spacer()
                Button { startingConversation = true } label: {
                    Image(systemName: "plus").font(.body.weight(.semibold)).frame(width: 32, height: 32)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.primary)
                .accessibilityLabel("New conversation")
                .accessibilityIdentifier("BotSpaceNewConversation")
            }
        }
    }

    private func startConversation(_ text: String) async throws {
        guard let bot else { return }
        let client = app.client
        var projectId = view?.main?.projectId
        if projectId == nil, let main = BotShell.mainThreadId(bot, view: view) {
            projectId = try await client.thread(main).projectId
        }
        guard let projectId else { throw BBError(status: 0, message: "\(bot.name) has no Main conversation to start from.") }
        let id = try await client.startConversation(botId: bot.id, projectId: projectId, text: text)
        await store.refresh()
        shell.openConversation(id)
    }

    @ViewBuilder private var workers: some View {
        let split = BotShell.splitWorkers(view?.workers ?? [])
        if !split.active.isEmpty || !split.done.isEmpty {
            Section {
                ForEach(split.active) { worker in workerRow(worker) }
                if !split.done.isEmpty {
                    if showsDone {
                        ForEach(split.done) { worker in workerRow(worker) }
                    } else {
                        Button { withAnimation(.snappy) { showsDone = true } } label: {
                            HStack(spacing: 12) {
                                Image(systemName: "checkmark").font(.footnote.weight(.semibold)).frame(width: 16)
                                Text("\(split.done.count) done")
                                Spacer()
                                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                            }
                            .foregroundStyle(.secondary)
                        }
                        .selectionDisabled()
                        .listRowBackground(rowBackground())
                    }
                }
            } header: {
                Text("Workers").font(.title3.bold()).foregroundStyle(.primary).textCase(nil).lookHalo(look)
            }
        }
    }

    private func workerRow(_ worker: BotWorker) -> some View {
        NavigationLink(value: BotShellItem.worker(worker.threadId)) {
            HStack(spacing: 12) {
                BotWorkerGlyph(status: worker.status).frame(width: 16)
                Text(worker.title.isEmpty ? "Worker" : worker.title).lineLimit(1)
                Spacer(minLength: 8)
                if let owner = worker.ownerTitle {
                    Text(owner).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                }
            }
        }
        .listRowBackground(rowBackground())
        .accessibilityIdentifier("worker-\(worker.threadId)")
    }

    private var bottomBar: some View {
        HStack {
            Button { app.tab = .settings } label: {
                Image(systemName: "gearshape").font(.body.weight(.medium)).frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .lookGlass(look, \.hud, in: .circle, interactive: true)
            .accessibilityLabel("Settings")
            .accessibilityIdentifier("BotSpaceSettings")
            Spacer()
            BotSpaceDots(dots: BotShell.dots(store.spaces, shown: shell.shownBotId, views: store.views)) { id in
                withAnimation(.snappy) { shell.show(id, store: store, compact: compact) }
            }
            .gesture(DragGesture(minimumDistance: 16).onEnded { value in
                guard abs(value.translation.width) > 30 else { return }
                withAnimation(.snappy) { shell.step(value.translation.width < 0 ? 1 : -1, store: store, compact: compact) }
            })
            Spacer()
            Menu {
                Button { app.tab = .studio } label: { Label("Studio", systemImage: "square.stack") }
            } label: {
                Image(systemName: "ellipsis").font(.body.weight(.medium)).frame(width: 44, height: 44)
            }
            .lookGlass(look, \.hud, in: .circle, interactive: true)
            .accessibilityLabel("More")
            .accessibilityIdentifier("BotSpaceMore")
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }

    private func open(_ item: BotShellItem) {
        shell.selection = item
        shell.compactColumn = .detail
    }
}

struct BotConversationRow: View {
    let line: BotConversationLine
    @Environment(\.look) private var look

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(line.title).font(.body.weight(.semibold)).lineLimit(1)
                if let parent = line.forkedFrom {
                    Text("⑂ " + parent)
                        .font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                        .layoutPriority(-1)
                        .accessibilityLabel("Forked from \(parent)")
                }
                Spacer(minLength: 4)
                Text(BotShell.shortAge(line.updatedAt))
                    .font(.subheadline).monospacedDigit()
                    .foregroundStyle(line.tone == .needsYou ? AnyShapeStyle(look.needsYou) : AnyShapeStyle(look.subtle))
            }
            if !line.text.isEmpty {
                HStack(spacing: 7) {
                    switch line.tone {
                    case .needsYou: Circle().fill(look.needsYou).frame(width: 8, height: 8)
                    case .running: ProgressView().controlSize(.mini)
                    case .quiet: EmptyView()
                    }
                    Text(line.text).lineLimit(1)
                }
                .font(.subheadline)
                .foregroundStyle(line.tone == .needsYou ? AnyShapeStyle(look.needsYou) : AnyShapeStyle(look.muted))
            }
        }
        .padding(.leading, CGFloat(line.depth) * 14)
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

struct BotWorkerGlyph: View {
    let status: BotWorker.Status
    @Environment(\.look) private var look

    var body: some View {
        switch status {
        case .running:
            ProgressView().controlSize(.mini).tint(look.success).accessibilityLabel("Running")
        case .needsYou:
            Circle().fill(look.needsYou).frame(width: 8, height: 8).accessibilityLabel("Needs you")
        case .failed:
            Image(systemName: "xmark.circle.fill").foregroundStyle(look.error).accessibilityLabel("Failed")
        case .done, .other:
            Image(systemName: "checkmark").font(.footnote.weight(.semibold)).foregroundStyle(look.success).accessibilityLabel("Done")
        }
    }
}

struct BotSpaceDots: View {
    let dots: [BotSpaceDot]
    let select: (String) -> Void
    @Environment(\.look) private var look

    var body: some View {
        HStack(spacing: 0) {
            ForEach(dots) { dot in
                Button { select(dot.id) } label: {
                    Capsule()
                        .fill(dot.amber ? AnyShapeStyle(look.needsYou) : dot.active ? AnyShapeStyle(.primary) : AnyShapeStyle(.tertiary))
                        .frame(width: dot.active ? 18 : 8, height: 8)
                        .frame(width: dot.active ? 32 : 22, height: 44)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(dot.label)
                .accessibilityIdentifier("space-dot-\(dot.id)")
                .accessibilityAddTraits(dot.active ? .isSelected : [])
            }
        }
        .padding(.horizontal, 8)
        .lookGlass(look, \.hud, in: .capsule)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("BotSpaceDots")
    }
}
