import SwiftUI

struct ThreadView: View {
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }
    @StateObject private var model: ThreadModel
    @StateObject private var spaces = ThreadSpacesModel()
    @State private var draft = ""
    @State private var mentions: [Mention] = []
    @ObservedObject private var outbox = Outbox.shared
    @ObservedObject private var muted = MutedThreads.shared
    @State private var choosingModel = false
    @State private var attachments: [PendingAttachment] = []
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var dictating = false
    @State private var showingWeb = false
    @State private var editingFull = false
    @State private var finding = false
    @State private var findQuery = ""
    @State private var findIndex = 0
    @State private var composerFocused = false
    /// Follow new output only while the reader is at the bottom.
    @State private var atBottom = true
    @State private var atTop = false
    /// How far the timeline is scrolled past its last row, or negative short of it.
    @State private var pastEnd: CGFloat = 0
    @State private var scrollPhase = ScrollPhase.idle
    @State private var selecting: SelectionText?
    @State private var selectedExcerpt = ""
    @State private var reactionSettings = ReactionSettings.defaults
    @State private var position = ScrollPosition()
    @State private var pickingSendTime = false
    @State private var showingFiles = false
    @State private var showingHistory = false
    @State private var savingFiles: SaveToStudioRequest?
    /// The page this thread was started from with "Work with this page".
    @State private var sourcePage: PageMeta?
    @State private var confirmingCompact = false
    @State private var confirmingClearContext = false
    @State private var showingContext = false
    @State private var renaming = false
    @State private var openingFile: OpenFile?
    @State private var newTitle = ""
    @State private var reviewingPlan: PlanReview?
    /// The bot this thread works as: `.some(nil)` for none, nil where it
    /// can't work as a bot (channels, bot work threads, no Bot Teams).
    @State private var profile: String??
    @State private var profileBot: Bot?
    @State private var choosingProfile = false
    /// Set while the composer holds a rewrite of the last message.
    @State private var editing = false
    @AppStorage(ServerScope.key("runningPlugins")) private var runningPlugins = ""
    /// Permissions chosen in Model & permissions, waiting for the next message.
    @AppStorage private var pendingPermission: String?

    private var canSaveFiles: Bool { runningPlugins.split(separator: ",").contains("artifacts") }

    init(threadId: String) {
        _model = StateObject(wrappedValue: ThreadModel(threadId: threadId))
        _pendingPermission = AppStorage(ServerScope.key("permissionMode.\(threadId)"), store: AppGroup.defaults)
    }

    var body: some View {
        screen
        .sheet(isPresented: $showingWeb) {
            if let thread = model.thread {
                NavigationStack {
                    WebView(url: client.webURL(forThread: thread))
                        .ignoresSafeArea(edges: .bottom)
                        .toolbar { Button("Done") { showingWeb = false } }
                }
            }
        }
        .sheet(item: $reviewingPlan, onDismiss: { Task { await model.loadPlanReview() } }) { review in
            PlanReviewSheet(review: review) { await model.loadPlanReview() }
        }
        .sheet(isPresented: $dictating) {
            DictationView(threadId: model.threadId, autoStart: true) { text in
                draft = draft.isEmpty ? text : draft + " " + text
                composerFocused = true
            }
        }
        .sheet(isPresented: $pickingSendTime) {
            SendTimePicker { date in
                pickingSendTime = false
                send(at: date)
            }
        }
        .sheet(item: $openingFile) { file in
            NavigationStack {
                if let environmentId = model.thread?.environmentId {
                    WorkspaceFileView(environmentId: environmentId, path: file.path, threadId: model.threadId)
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) { Button("Done") { openingFile = nil } }
                        }
                } else {
                    ContentUnavailableView("No workspace", systemImage: "folder.badge.questionmark",
                        description: Text("This thread has no environment to read \(file.path) from."))
                }
            }
        }
        .sheet(isPresented: $showingFiles) {
            if let environmentId = model.thread?.environmentId {
                FilesView(environmentId: environmentId)
            }
        }
        .sheet(item: $savingFiles) { SaveToStudioSheet(request: $0) }
        .sheet(isPresented: $showingHistory) {
            PromptHistoryView(threadId: model.threadId) { text in
                showingHistory = false
                draft = text
                composerFocused = true
            }
        }
        .sheet(isPresented: $showingContext) { ThreadContextView(threadId: model.threadId) }
        .alert("Rename thread", isPresented: $renaming) {
            TextField("Title", text: $newTitle)
            Button("Cancel", role: .cancel) {}
            Button("Rename") {
                let title = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
                model.thread?.title = title.isEmpty ? nil : title
                Task { await model.perform { try await $0.rename($1, title: title.isEmpty ? nil : title) } }
            }
        }
        .confirmationDialog("Compact this thread?", isPresented: $confirmingCompact, titleVisibility: .visible) {
            Button("Compact") { Task { await model.run { try await $0.compact(model.threadId) } } }
        } message: {
            Text("The agent summarizes the conversation so far to free up context.")
        }
        .confirmationDialog("Clear this thread's context?", isPresented: $confirmingClearContext, titleVisibility: .visible) {
            Button("Clear context", role: .destructive) {
                Task { await model.run { try await $0.clearContext(model.threadId) } }
            }
        } message: {
            Text("The agent will start its next turn without this conversation's context.")
        }
        .sheet(isPresented: $choosingModel) {
            ExecutionSheet(threadId: model.threadId, providerId: model.thread?.providerId)
        }
        .sheet(isPresented: $choosingProfile) {
            if let thread = model.thread, case .some(let botId) = profile {
                ThreadProfileSheet(thread: thread, botId: botId) { id in
                    profile = .some(id)
                    Task { await loadProfileBot() }
                }
            }
        }
        .sheet(isPresented: $editingFull) {
            FullComposer(text: $draft, canSend: canSend, send: {
                editingFull = false
                send()
            })
        }
        .sheet(item: $selecting) { selection in
            NavigationStack {
                SelectableText(text: selection.text, selection: $selectedExcerpt)
                    .navigationTitle("Select Text")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        if !selectedExcerpt.isEmpty, !reactionSettings.items.isEmpty {
                            Menu("React") {
                                ForEach(reactionSettings.items, id: \.self) { item in
                                    Button(item) {
                                        draftReaction(item, quote: selectedExcerpt)
                                        selecting = nil
                                    }
                                }
                            }
                        }
                        Button("Done") { selecting = nil }
                    }
            }
            .presentationDetents([.medium, .large])
        }
        .overlay(alignment: .top) {
            if let error = model.error {
                Text(error).font(.caption).padding(8).background(.red.opacity(0.15), in: .capsule).padding(.top, 4)
                    .onTapGesture { model.error = nil }
            }
        }
        .task {
            app.lastThreadId = model.threadId
            if draft.isEmpty, let saved = Drafts.load(model.threadId, serverURL: model.serverURL) {
                draft = saved.text
                mentions = saved.mentions
            }
            model.attach(app)
            Task { await muted.refresh() }
            Task { reactionSettings = (try? await client.reactionSettings()) ?? .defaults }
            if runningPlugins.split(separator: ",").contains("pages") {
                Task { sourcePage = try? await client.chatPage(model.threadId) }
            }
            if runningPlugins.split(separator: ",").contains("studio") {
                Task { await spaces.load(model.threadId, client: client) }
            }
            if runningPlugins.split(separator: ",").contains("studio") {
                Task {
                    profile = try? await client.threadProfile(model.threadId)
                    await loadProfileBot()
                }
            }
            await model.load()
        }
        .onChange(of: draft) { _, text in
            mentions.removeAll { !text.contains($0.token) }
            Drafts.save(model.threadId, text: text, mentions: mentions, serverURL: model.serverURL)
        }
        // Open where the reader left off. Waits a beat for the rows to be laid out.
        .task(id: model.unreadFrom) {
            guard model.unreadFrom != nil else { return }
            try? await Task.sleep(for: .milliseconds(150))
            if let item = unreadItem() { position.scrollTo(id: item, anchor: .top) }
        }
        .onDisappear { model.detach() }
        .focusedSceneValue(\.thread, actions)
        .sensoryFeedback(.success, trigger: model.confirmations)
        .sensoryFeedback(.warning, trigger: model.interactions.count) { old, new in new > old }
        .sensoryFeedback(.error, trigger: model.error) { _, new in new != nil }
        .sensoryFeedback(.selection, trigger: attachments.count) { old, new in new > old }
        .userActivity(Spotlight.threadActivityType, isActive: model.thread != nil) { activity in
            guard let thread = model.thread else { return }
            activity.title = thread.displayTitle
            activity.webpageURL = client.webURL(forThread: thread).absoluteURL
            activity.targetContentIdentifier = thread.id
        }
    }

    /// The timeline, find bar, composer, and toolbar; `body` adds sheets and tasks.
    private var screen: some View {
        Group {
            // Built once the first page is in, so it opens at the bottom of real
            // content rather than growing from empty.
            if model.loaded {
                timeline
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            if finding {
                FindBar(query: $findQuery, index: $findIndex, count: findMatches.count, loading: model.loadingAll) {
                    finding = false
                    findQuery = ""
                }
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.snappy, value: finding)
        .overlay(alignment: .bottomTrailing) { jumpButton }
        .animation(.snappy, value: atBottom)
        .safeAreaInset(edge: .bottom) { composer }
        .environment(\.threadId, model.threadId)
        .environment(\.openURL, OpenURLAction { url in
            // Agents link Studio items by their BB web path, which reads like a file path.
            if let path = FilePathLink.path(from: url) ?? (url.host() == client.baseURL.host() ? url.path() : nil),
                let route = Route(href: path)
            {
                app.path.append(route)
                return .handled
            }
            if let path = FilePathLink.path(from: url) {
                openingFile = OpenFile(path: path)
                return .handled
            }
            guard AppLink.handles(url), url.host() == "thread", let id = url.pathComponents.dropFirst().first else {
                return .systemAction
            }
            app.path.append(.thread(id: id))
            return .handled
        })
        .navigationTitle(model.thread.map { ThreadTitles.resolve($0.displayTitle) } ?? "Thread")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(sizeClass == .compact ? .hidden : .automatic, for: .tabBar)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if model.thread?.isRunning == true {
                    Button { Task { await model.stop() } } label: { Image(systemName: "stop.circle") }
                        .accessibilityLabel("Stop")
                }
                // On iPad there's room for Find beside the menu.
                if sizeClass == .regular {
                    Button { finding = true } label: { Image(systemName: "magnifyingglass") }
                        .accessibilityLabel("Find")
                }
                // One menu rather than a row of buttons, so the title has room.
                Menu {
                    Button { app.startVoiceChat(threadId: model.threadId) } label: {
                        Label("Voice chat", systemImage: "waveform")
                    }
                    Button { finding = true } label: { Label("Find in thread", systemImage: "magnifyingglass") }
                    Button {
                        newTitle = model.thread?.title ?? model.thread?.displayTitle ?? ""
                        renaming = true
                    } label: { Label("Rename", systemImage: "pencil") }
                    Button { choosingModel = true } label: { Label("Model & permissions", systemImage: "cpu") }
                    if case .some(let botId) = profile {
                        Button { choosingProfile = true } label: {
                            Label(botId == nil ? "Work as bot" : "Working as \(profileBot?.name ?? "an archived bot")",
                                systemImage: "person.crop.circle")
                        }
                    }
                    if model.thread?.environmentId != nil {
                        Button { showingFiles = true } label: { Label("Files & changes", systemImage: "folder") }
                        Button { app.push(.terminals(scope: .thread(model.threadId), title: "Terminals")) } label: {
                            Label("Terminals", systemImage: "apple.terminal")
                        }
                    }
                    Button { showingHistory = true } label: { Label("Recent prompts", systemImage: "clock.arrow.circlepath") }
                    if canSaveFiles {
                        Button { savingFiles = SaveToStudioRequest(threadId: model.threadId, seq: nil) } label: {
                            Label("Save Files to Studio…", systemImage: "square.and.arrow.down.on.square")
                        }
                    }
                    ThreadSpacesMenu(model: spaces, threadId: model.threadId) { model.error = $0 }
                    if let sourcePage {
                        Button { app.push(.page(id: sourcePage.id)) } label: {
                            Label("Open \(sourcePage.displayTitle)", systemImage: "doc.richtext")
                        }
                    }
                    Section {
                        Button {
                            Task { if let id = await model.fork() { app.path.append(.thread(id: id)) } }
                        } label: { Label("Fork thread", systemImage: "arrow.triangle.branch") }
                        Button { showingContext = true } label: {
                            Label("Context usage", systemImage: "chart.bar")
                        }
                        Button { confirmingCompact = true } label: { Label("Compact context", systemImage: "rectangle.compress.vertical") }
                        Button { confirmingClearContext = true } label: { Label("Clear context", systemImage: "eraser") }
                    }
                    let isMuted = muted.ids.contains(model.threadId)
                    Button {
                        Task {
                            do {
                                try await muted.set(model.threadId, muted: !isMuted)
                            } catch {
                                model.error = BBClient.describe(error, server: client.baseURL)
                            }
                        }
                    } label: {
                        Label(isMuted ? "Unmute notifications" : "Mute notifications", systemImage: isMuted ? "bell" : "bell.slash")
                    }
                    Button { showingWeb = true } label: { Label("Open in BB web", systemImage: "safari") }
                    if let thread = model.thread {
                        ShareLink(item: client.webURL(forThread: thread).absoluteURL) {
                            Label("Share link", systemImage: "square.and.arrow.up")
                        }
                    }
                    Button { UIPasteboard.general.string = model.threadId } label: { Label("Copy Thread ID", systemImage: "number") }
                } label: {
                    Image(systemName: "ellipsis")
                }
                .accessibilityLabel("More")
            }
        }
    }

    private var timeline: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                if model.hasOlder {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                }
                let items = TimelineItem.group(model.rows)
                let unread = unreadItem(in: items)
                let editable = lastUserRowId
                let sideChat = runningPlugins.split(separator: ",").contains("side-chat") ? openSideChat : nil
                ForEach(items) { item in
                    // One view per item, so scrolling to the item lands on the divider.
                    VStack(alignment: .leading, spacing: 14) {
                        if item.id == unread { UnreadDivider() }
                        Group {
                            switch item {
                            case .message(let row):
                                MessageBubble(
                                    row: row,
                                    projectId: model.thread?.projectId,
                                    react: { draftReply($0) },
                                    reactionItems: reactionSettings.items,
                                    quote: { quote($0) },
                                    select: { selecting = SelectionText(text: $0) },
                                    sideChat: sideChat,
                                    edit: row.id == editable ? startEditing : nil,
                                    saveFiles: canSaveFiles ? { savingFiles = SaveToStudioRequest(threadId: model.threadId, seq: $0) } : nil)
                            case .activity(let rows):
                                ActivityGroup(rows: rows)
                            }
                        }
                        .background {
                            if item.id == currentMatch {
                                RoundedRectangle(cornerRadius: 12).fill(.yellow.opacity(0.22)).padding(-6)
                            }
                        }
                    }
                }
                ForEach(outbox.messages(for: model.threadId)) { message in
                    PendingBubble(message: message)
                }
                ForEach(model.interactions) { interaction in
                    InteractionCard(
                        interaction: interaction,
                        resolve: { await model.resolve(interaction, $0) },
                        cancel: { await model.cancel(interaction) },
                        openWeb: { showingWeb = true })
                    .id(interaction.id)
                }
                if showsWorking {
                    WorkingIndicator(thinking: model.shelf.thinking)
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
            .scrollTargetLayout()
            .frame(maxWidth: Self.readableWidth)
            .frame(maxWidth: .infinity)
        }
        .scrollPosition($position)
        .defaultScrollAnchor(.bottom)
        .scrollDismissesKeyboard(.interactively)
        .onScrollGeometryChange(for: Bool.self) { geometry in
            geometry.contentOffset.y + geometry.containerSize.height >= geometry.contentSize.height - 120
        } action: { _, isAtBottom in
            atBottom = isAtBottom
        }
        // Following a streaming reply scrolls to the bottom the lazy stack
        // estimates; when rows above measure shorter than estimated, or the
        // bottom shrinks (the working indicator goes, steps fold into a group),
        // the timeline is left past its end, showing nothing. Bring it back
        // once nothing is scrolling, so a bounce at the bottom isn't fought.
        .onScrollGeometryChange(for: CGFloat.self) { geometry in
            let end = max(geometry.contentSize.height + geometry.contentInsets.bottom - geometry.containerSize.height, -geometry.contentInsets.top)
            return geometry.contentOffset.y - end
        } action: { _, distance in
            pastEnd = distance
            if scrollPhase == .idle { settlePastEnd() }
        }
        .onScrollPhaseChange { _, phase in
            scrollPhase = phase
            if phase == .idle { settlePastEnd() }
        }
        // The first page lands at the bottom through `defaultScrollAnchor`;
        // scrolling by hand while lazy rows are still measuring can overshoot.
        .onChange(of: model.rows.last?.id) { old, _ in
            if old != nil, atBottom || model.rows.last?.isUser == true { scrollToBottom() }
        }
        // Older pages load when the reader reaches the top.
        .onScrollGeometryChange(for: Bool.self) { geometry in
            geometry.contentOffset.y + geometry.contentInsets.top < 40
        } action: { _, isAtTop in
            atTop = isAtTop
        }
        // Keeps trying while the reader stays at the top: after a failure, or
        // when a page is too short to move them off it.
        .task(id: atTop) {
            while atTop, model.hasOlder, !Task.isCancelled {
                let loaded = await loadOlder()
                try? await Task.sleep(for: .seconds(loaded ? 0.5 : 2))
            }
        }
        .onChange(of: finding) { _, finding in
            if finding { Task { await model.loadAll() } }
        }
        .onChange(of: findQuery) { _, _ in findIndex = 0 }
        // Earlier pages going in above would carry the match off screen.
        .onChange(of: model.rows.first?.id) { _, _ in
            if finding, let currentMatch { position.scrollTo(id: currentMatch, anchor: .center) }
        }
        .onChange(of: currentMatch) { _, id in
            if let id { withAnimation(.snappy) { position.scrollTo(id: id, anchor: .center) } }
        }
        .onChange(of: model.rows.last?.text) { _, _ in
            if atBottom { scrollToBottom(animated: false) }
        }
        .onChange(of: model.interactions.first?.id) { _, id in
            if id != nil { scrollToBottom() }
        }
        .onChange(of: model.confirmations) { _, _ in scrollToBottom() }
        .onChange(of: outbox.messages.count) { old, new in
            if new > old { scrollToBottom() }
        }
    }

    @ViewBuilder private var jumpButton: some View {
        if !atBottom {
            Button { scrollToBottom() } label: {
                Image(systemName: "arrow.down")
                    .font(.body.weight(.semibold))
                    .frame(width: 40, height: 40)
            }
            .buttonStyle(.glass)
            .clipShape(.circle)
            .padding(12)
            .transition(.scale.combined(with: .opacity))
            .accessibilityLabel("Jump to latest")
        }
    }

    /// For the Thread menu and its shortcuts.
    private var actions: ThreadActions {
        let stop: (() -> Void)? = model.thread?.isRunning == true ? { Task { await model.stop() } } : nil
        return ThreadActions(
            find: { finding = true },
            jumpToLatest: { scrollToBottom() },
            chooseModel: { choosingModel = true },
            stop: stop)
    }

    /// A running step already has its own spinner; don't stack a second one
    /// under it unless there's a thought to show.
    private var showsWorking: Bool {
        guard model.thread?.isRunning == true, model.interactions.isEmpty else { return false }
        if model.shelf.thinking?.isEmpty == false { return true }
        guard let last = model.rows.last, last.kind == "work" else { return true }
        return !["inProgress", "running", "pending"].contains(last.status ?? "")
    }

    /// The page goes in above the reader, so bring back what was the first
    /// item. By id rather than offset: rows above are only estimated heights.
    private func loadOlder() async -> Bool {
        guard let first = TimelineItem.group(model.rows).first?.id, await model.loadOlder() else { return false }
        position.scrollTo(id: first, anchor: .top)
        return true
    }

    /// Past this, the timeline is past its last row rather than bouncing.
    private static let pastEndSlack: CGFloat = 40

    private func settlePastEnd() {
        if pastEnd > Self.pastEndSlack { scrollToBottom(animated: false) }
    }

    private func scrollToBottom(animated: Bool = true) {
        if animated {
            withAnimation(.snappy) { position.scrollTo(edge: .bottom) }
        } else {
            position.scrollTo(edge: .bottom)
        }
    }

    /// Reactions draft a reply rather than sending it, like BB web: appended after
    /// anything already typed, so the user can add to it.
    private func draftReply(_ text: String) {
        let current = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        draft = current.isEmpty ? text : current + "\n\n" + text
        composerFocused = true
    }

    private func draftReaction(_ reaction: String, quote text: String) {
        draftReply(reactionSettings.draft(reaction, selection: text))
    }

    private func quote(_ text: String) {
        let quoted = text.trimmingCharacters(in: .whitespacesAndNewlines)
            .components(separatedBy: "\n").map { "> " + $0 }.joined(separator: "\n")
        let current = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        draft = (current.isEmpty ? "" : current + "\n\n") + quoted + "\n\n"
        composerFocused = true
    }

    /// Messages containing the find text, newest first.
    private var findMatches: [String] {
        let query = findQuery.trimmingCharacters(in: .whitespaces)
        guard finding, query.count >= 2 else { return [] }
        return TimelineItem.group(model.rows).reversed().compactMap { item in
            guard case .message(let row) = item, row.text?.localizedStandardContains(query) == true else { return nil }
            return row.id
        }
    }

    /// The item holding the first unread row.
    private func unreadItem(in items: [TimelineItem]? = nil) -> String? {
        guard let id = model.unreadFrom else { return nil }
        return (items ?? TimelineItem.group(model.rows)).first { $0.rows.contains { $0.id == id } }?.id
    }

    private var currentMatch: String? {
        let matches = findMatches
        return matches.indices.contains(findIndex) ? matches[findIndex] : nil
    }

    /// Past a few lines the field scrolls; offer the whole screen instead.
    private var draftIsLong: Bool {
        draft.count > 200 || draft.reduce(0) { $1 == "\n" ? $0 + 1 : $0 } >= 4
    }

    private var canSend: Bool {
        !(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && attachments.isEmpty) && !model.sending
    }

    /// Clears the field right away and puts the text back if sending fails.
    private func send() {
        if editing { return saveEdit() }
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let files = attachments
        let sentMentions = mentions
        draft = ""
        attachments = []
        Task {
            if await !model.send(text, mentions: sentMentions, attachments: files) {
                if draft.isEmpty {
                    draft = text
                    mentions = sentMentions
                }
                if attachments.isEmpty { attachments = files }
            }
        }
    }

    private var lastUserRowId: String? {
        model.rows.last { $0.isConversation && $0.isUser }?.id
    }

    private func startEditing(_ text: String) {
        editing = true
        draft = text
        attachments = []
        composerFocused = true
    }

    /// Text only: a scheduled message can't carry attachments.
    private func send(at date: Date) {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let sentMentions = mentions
        draft = ""
        Task {
            if await !model.send(text, mentions: sentMentions, at: date), draft.isEmpty {
                draft = text
                mentions = sentMentions
            }
        }
    }

    private func saveDraft() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let sentMentions = mentions
        draft = ""
        Task {
            if await !model.saveDraft(text, mentions: sentMentions), draft.isEmpty {
                draft = text
                mentions = sentMentions
            }
        }
    }

    private func saveEdit() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let sentMentions = mentions
        editing = false
        draft = ""
        Task {
            if await !model.run({ try await $0.editLastMessage(model.threadId, text: text, mentions: sentMentions) }), draft.isEmpty {
                draft = text
                editing = true
            }
        }
    }

    private func openSideChat(_ text: String) {
        Task {
            if let id = await model.sideChat(about: text) { app.path.append(.thread(id: id)) }
        }
    }

    /// Replaces the `@word` being typed with the mention.
    private func insert(_ mention: Mention) {
        guard let query = MentionSuggestions.query(in: draft) else { return }
        draft = String(draft.dropLast(query.count + 1)) + mention.token + " "
        mentions.append(mention)
    }

    private func insertCommand(_ mention: Mention) {
        guard let query = CommandSuggestions.query(in: draft) else { return }
        draft = String(draft.dropLast(query.count + 1)) + mention.token + " "
        mentions.append(mention)
        composerFocused = true
    }

    /// The attached bot, for its avatar and name.
    private func loadProfileBot() async {
        guard case .some(.some(let id)) = profile else { return profileBot = nil }
        profileBot = try? await client.profiles().first { $0.id == id }
    }

    private var composer: some View {
        VStack(spacing: 6) {
            ThreadShelf(model: model)
            if model.thread?.status == "error", !editing {
                ShelfCard(icon: "exclamationmark.triangle", tint: .red) {
                    Text("The last turn failed").lineLimit(1)
                } trailing: {
                    Button("Retry") { Task { await model.run { try await $0.retry(model.threadId) } } }
                        .font(.footnote.weight(.semibold))
                        .padding(.trailing, 6)
                }
            }
            if let pendingPermission, !editing {
                ShelfCard(icon: "lock.shield", tint: pendingPermission == "full" ? .orange : .accentColor) {
                    Button { choosingModel = true } label: {
                        Text("Next message: \(PermissionMode.label(pendingPermission))").lineLimit(1)
                    }
                    .buttonStyle(.plain)
                } trailing: {
                    Button("Undo") { PermissionMode.setPending(nil, for: model.threadId) }
                        .font(.footnote.weight(.semibold))
                        .padding(.trailing, 6)
                }
                .accessibilityIdentifier("pendingPermission")
            }
            if let review = model.planReview {
                ShelfCard(icon: "doc.text.magnifyingglass", tint: .orange) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Plan ready for review").fontWeight(.medium)
                        if let title = review.title, !title.isEmpty {
                            Text(title).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                } trailing: {
                    Button("Review") { reviewingPlan = review }
                        .font(.footnote.weight(.semibold))
                        .padding(.trailing, 6)
                }
            }
            if editing {
                ShelfCard(icon: "pencil", tint: .accentColor) {
                    Text("Editing your last message").lineLimit(1)
                } trailing: {
                    Button("Cancel") {
                        editing = false
                        draft = ""
                    }
                    .font(.footnote.weight(.semibold))
                    .padding(.trailing, 6)
                }
            }
            if composerFocused, let query = MentionSuggestions.query(in: draft) {
                MentionSuggestions(query: query, threadId: model.threadId, projectId: model.thread?.projectId, pick: insert)
            } else if composerFocused, let query = CommandSuggestions.query(in: draft),
                let projectId = model.thread?.projectId, let providerId = model.thread?.providerId {
                CommandSuggestions(query: query, projectId: projectId, providerId: providerId,
                    environmentId: model.thread?.environmentId, pick: insertCommand)
            }
            AttachmentStrip(items: $attachments)
            HStack(alignment: .bottom, spacing: 4) {
                if case .some(.some) = profile {
                    Button { choosingProfile = true } label: {
                        Text(profileBot?.avatar ?? "🤖").font(.title3).frame(width: 36, height: 36)
                    }
                    .accessibilityLabel("Working as \(profileBot?.name ?? "an archived bot")")
                }
                AttachmentMenu(items: $attachments)
                Button { dictating = true } label: {
                    Image(systemName: "mic.fill").font(.title3).frame(width: 36, height: 36)
                }
                .accessibilityLabel("Dictate")
                ComposerField(text: $draft, focused: $composerFocused, trailingInset: draftIsLong ? 32 : 12) { images in
                    attachments += images.compactMap { PendingAttachment.image($0, name: "pasted.jpg") }
                }
                .background(.fill.tertiary, in: .rect(cornerRadius: 18))
                .overlay(alignment: .topTrailing) {
                    if draftIsLong {
                        Button { editingFull = true } label: {
                            Image(systemName: "arrow.up.left.and.arrow.down.right")
                                .font(.caption.weight(.semibold))
                                .frame(width: 28, height: 28)
                        }
                        .foregroundStyle(.secondary)
                        .accessibilityLabel("Expand")
                    }
                }
                Button(action: send) {
                    Group {
                        if model.sending {
                            ProgressView()
                        } else {
                            Image(systemName: model.thread?.isRunning == true ? "text.append" : "arrow.up.circle.fill")
                                .font(model.thread?.isRunning == true ? .title3 : .title)
                        }
                    }
                    .frame(width: 36, height: 36)
                }
                .disabled(!canSend)
                .keyboardShortcut(.return, modifiers: .command)
                // Long-press to schedule.
                .contextMenu {
                    if canSend, attachments.isEmpty, !editing {
                        if runningPlugins.split(separator: ",").contains("drafts") {
                            Button { saveDraft() } label: { Label("Save as Draft", systemImage: "doc.text") }
                        }
                        Section("Send Later") {
                            ForEach(SendTimePicker.presets, id: \.title) { preset in
                                Button(preset.title) { send(at: preset.date()) }
                            }
                            Button { pickingSendTime = true } label: { Label("Pick a Time…", systemImage: "calendar") }
                        }
                    }
                }
                .accessibilityLabel(editing ? "Save edit" : model.thread?.isRunning == true ? "Queue message" : "Send")
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .frame(maxWidth: Self.readableWidth)
        .frame(maxWidth: .infinity)
        .background(.bar)
        // A `bbstudio://reply/<id>` link lands here.
        .onChange(of: app.replyThreadId, initial: true) { _, id in
            guard id == model.threadId else { return }
            composerFocused = true
            app.replyThreadId = nil
        }
    }

    /// Lines past this get hard to follow on an iPad or a wide window.
    private static let readableWidth: CGFloat = 760
}

/// The draft on a whole screen, for writing something long.
struct FullComposer: View {
    @Binding var text: String
    let canSend: Bool
    let send: () -> Void
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            TextEditor(text: $text)
                .focused($focused)
                .padding(.horizontal, 12)
                .navigationTitle("Message")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") { dismiss() }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Send", action: send)
                            .disabled(!canSend)
                            .keyboardShortcut(.return, modifiers: .command)
                    }
                }
                .onAppear { focused = true }
        }
    }
}

struct SelectionText: Identifiable {
    let id = UUID()
    let text: String
}

/// The live "Working…" line, with the agent's current thought when BB has one.
struct WorkingIndicator: View {
    let thinking: String?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            ProgressView().controlSize(.small)
            Text(summary)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .lineLimit(2)
                .contentTransition(.opacity)
        }
        .animation(.default, value: summary)
    }

    private var summary: String {
        let line = thinking?.split(whereSeparator: \.isNewline).last.map { String($0) }
        guard let line, !line.trimmingCharacters(in: .whitespaces).isEmpty else { return "Working…" }
        return line.replacingOccurrences(of: "**", with: "")
    }
}

/// Where the reader left off: everything below arrived since they last looked.
struct UnreadDivider: View {
    var body: some View {
        HStack(spacing: 8) {
            Rectangle().fill(.red.opacity(0.5)).frame(height: 1)
            Text("New").font(.caption.weight(.semibold)).foregroundStyle(.red)
            Rectangle().fill(.red.opacity(0.5)).frame(height: 1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("New since you last looked")
    }
}

/// A message waiting in the outbox for BB to be reachable.
struct PendingBubble: View {
    let message: Outbox.Message

    var body: some View {
        VStack(alignment: .trailing, spacing: 4) {
            Text(message.text)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color.accentColor.opacity(0.1), in: .rect(cornerRadius: 18))
                .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Color.accentColor.opacity(0.3), style: .init(dash: [4, 3])))
                .contextMenu {
                    if message.failure != nil {
                        Button { Outbox.shared.retry(message.id) } label: { Label("Try again", systemImage: "arrow.clockwise") }
                    }
                    Button { UIPasteboard.general.string = message.text } label: { Label("Copy", systemImage: "doc.on.doc") }
                    Button(role: .destructive) { Outbox.shared.remove(message.id) } label: {
                        Label("Delete", systemImage: "trash")
                    }
                }
            Label(message.failure ?? "Sends when BB is reachable", systemImage: message.failure == nil ? "clock" : "exclamationmark.circle")
                .font(.caption2)
                .foregroundStyle(message.failure == nil ? Color.secondary : Color.red)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.leading, 40)
    }
}

/// A file tapped in a message, shown in a sheet.
private struct OpenFile: Identifiable {
    let path: String
    var id: String { path }
}
