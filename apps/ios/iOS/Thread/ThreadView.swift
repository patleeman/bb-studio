import SwiftUI

struct ThreadView: View {
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }
    @StateObject private var model: ThreadModel
    @StateObject private var talk: HoldToTalk
    /// Send waits while dictation (the mic, a talk, or the keyboard's) has words on the way.
    @StateObject private var dictation = DictationGate()
    @StateObject private var bot = BotModel()
    /// "Expand to page": the thread's open note and its editor.
    @StateObject private var notes: ThreadNotes
    /// Voice mode: the speaker beside the mic, and spoken replies.
    @StateObject private var voice: ThreadVoice
    /// The composer's one mic and one indicator, across dictation and voice mode.
    @StateObject private var composerVoice = ComposerVoice()
    @ObservedObject private var player = VoicePlayer.shared
    /// What was typed before an inline dictation or a talk in voice mode; what you say goes in after it.
    @State private var talkTyped: String?
    /// The message the piece being spoken is lit up in.
    @State private var readAlongRow: String?
    @State private var editingVoice = false
    @State private var draft = ""
    @State private var mentions: [Mention] = []
    @ObservedObject private var outbox = Outbox.shared
    @ObservedObject private var muted = MutedThreads.shared
    @State private var choosingModel = false
    /// The composer's model button: the thread's model and reasoning level.
    @State private var executionLabel: String?
    /// A handoff to another provider in flight, or a switch just done, over the composer.
    @State private var handoffStatus: (text: String, working: Bool)?
    @State private var attachments: [PendingAttachment] = []
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var showingWeb = false
    @State private var editingFull = false
    @State private var finding = false
    @State private var findQuery = ""
    @State private var findIndex = 0
    @State private var composerFocused = false
    /// Follow new output only while the reader is at the bottom.
    @State private var atBottom = true
    @State private var atTop = false
    /// Where the timeline's end is, and whether it follows it. Not state: it
    /// changes with every scroll frame, and nothing draws from it.
    @State private var end = TranscriptEnd()
    /// Rebuilds the timeline so it opens at the bottom of the server's rows.
    @State private var timelineKey = 0
    @State private var scrollPhase = ScrollPhase.idle
    /// Ends `keepAtEnd`'s hold once an animated scroll has stopped moving.
    @State private var animationWatch: Task<Void, Never>?
    @State private var selecting: SelectionText?
    @State private var selectedExcerpt = ""
    @State private var reactionSettings = ReactionSettings.defaults
    /// The scroll position, outside this view's state: as state, each
    /// scroll request (ten a second while a fold restores) redrew all of this.
    @State private var scroller = TranscriptScroller()
    @State private var resizeAnchor = TranscriptResizeAnchor()
    @State private var resizeRestore: Task<Void, Never>?
    @Environment(\.duoLayout) private var duoLayout
    @State private var pickingSendTime = false
    @State private var showingFiles = false
    @State private var showingHistory = false
    @State private var savingFiles: SaveToStudioRequest?
    /// The page this thread was started from with "Work with this page".
    @State private var sourcePage: PageMeta?
    @State private var confirmingCompact = false
    @State private var confirmingClearContext = false
    @State private var showingContext = false
    @State private var editingBotHeartbeat = false
    @State private var renaming = false
    @State private var openingFile: OpenFile?
    @State private var newTitle = ""
    @State private var reviewingPlan: PlanReview?
    /// Set while the composer holds a rewrite of the last message.
    @State private var editing = false
    @AppStorage(ServerScope.key("runningPlugins")) private var runningPlugins = ""
    /// Permissions chosen in Model & permissions, waiting for the next message.
    @AppStorage private var pendingPermission: String?

    /// Artifacts are built into Studio.
    private var canSaveFiles: Bool { runningPlugins.split(separator: ",").contains("studio") }

    /// Notes ("Expand to page") are Studio's too.
    private var canUseNotes: Bool {
        #if DEBUG
        if NotesDemo.variant != nil { return true }
        #endif
        return runningPlugins.split(separator: ",").contains("studio")
    }

    /// Hides the tab bar on iPhone, for a thread pushed from a list; a tab's
    /// own thread keeps it.
    private let hidesTabBar: Bool
    /// The Bot's thread: the Action button talks to it.
    private let answersActionButton: Bool

    /// Set for the Bot tab: draws the thread as the Bot's chat.
    private let botChrome: BotChrome?
    /// Counts sends, for the send haptic.
    @State private var sends = 0
    /// The new chat transcript's requests, when it's on (Settings ▸ Diagnostics).
    @State private var transcriptV2 = TranscriptHandle()

    init(threadId: String, hidesTabBar: Bool = true, answersActionButton: Bool = false, botChrome: BotChrome? = nil) {
        self.hidesTabBar = hidesTabBar
        self.answersActionButton = answersActionButton
        self.botChrome = botChrome
        _talk = StateObject(wrappedValue: HoldToTalk(threadId: threadId))
        _model = StateObject(wrappedValue: ThreadModel(threadId: threadId))
        _notes = StateObject(wrappedValue: ThreadNotes(threadId: threadId))
        _voice = StateObject(wrappedValue: ThreadVoice(threadId: threadId))
        _pendingPermission = AppStorage(ServerScope.key("permissionMode.\(threadId)"), store: AppGroup.defaults)
    }

    var body: some View {
        #if DEBUG
        let _ = RenderCount.bump("thread.body")
        #endif
        withTalk
        .focusedSceneValue(\.thread, actions)
        .sensoryFeedback(.success, trigger: model.confirmations)
        .task(id: botChrome?.chain) {
            // The chain ends at this thread; until `bot_chain` answers, the thread alone.
            if let chain = botChrome?.chain, chain.last == model.threadId { model.chainBefore = Array(chain.dropLast()) }
        }
        .modifier(BotThreadHooks(chrome: botChrome, threadId: model.threadId, environmentId: model.thread?.environmentId,
                                    sends: sends, running: model.thread?.isRunning == true, interactions: model.interactions.count))
        .sensoryFeedback(.warning, trigger: model.interactions.count, condition: Self.grew)
        .sensoryFeedback(.error, trigger: model.error) { (_: String?, new: String?) in new != nil }
        .sensoryFeedback(.selection, trigger: attachments.count, condition: Self.grew)
        .userActivity(Spotlight.threadActivityType, isActive: model.thread != nil, describeActivity)
    }

    /// For the haptics on a count: it went up.
    private static func grew(_ old: Int, _ new: Int) -> Bool { new > old }

    /// Handoff and Spotlight: the thread's title and web link.
    private func describeActivity(_ activity: NSUserActivity) {
        guard let thread = model.thread else { return }
        activity.title = thread.displayTitle
        activity.webpageURL = client.webURL(forThread: thread).absoluteURL
        activity.targetContentIdentifier = thread.id
    }

    /// Voice, talk and the Action button.
    private var withTalk: some View {
        withLoading
        .modifier(VoiceHooks(voice: voice, talk: talk, player: player, rows: model.rows, running: model.thread?.isRunning == true,
                             readAlongRow: $readAlongRow, editingVoice: $editingVoice))
        .modifier(TalkDraft(talk: talk, draft: $draft, typed: $talkTyped))
        .onChange(of: canUseNotes) { _, can in if can { notes.attach(app) } }
        .modifier(TalkLifecycle(talk: talk))
        .onAppear {
            ScrollLog.observeKeyboard()
            talk.send = { [model, voice] text in
                if voice.on { return sendSpoken(text) }
                Task { if await !model.send(text, mentions: [], attachments: []) { restoreDraft(text, []) } }
            }
            talk.insert = { [model] text in
                let next = TalkDraft.finished(text, typed: &talkTyped, draft: draft)
                draft = next
                // Saved here too: a dictation finished as the thread closes lands after its view is gone.
                Drafts.save(model.threadId, text: next, mentions: mentions, serverURL: model.serverURL)
            }
            takeActionButton()
        }
        .onChange(of: app.botTalkPending) { _, _ in takeActionButton() }
        .onChange(of: talk.error) { _, error in
            if let error { app.flash(error) }
        }
    }

    // `body` in parts, so each type-checks in well under a second (as one
    // chain it took 30 s, and Xcode 26 gave up on it). The same modifiers,
    // in the same order.

    /// The screen and its sheets.
    private var withSheets: some View {
        screen
        .navigationBarBackButtonHidden(duoLayout.twoPages && app.tab == .inbox && hidesTabBar)
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
        .sheet(isPresented: $editingBotHeartbeat) { BotHeartbeatSheet() }
        .sheet(isPresented: $showingContext) { ThreadContextView(threadId: model.threadId) }
    }

    /// Alerts, dialogs and the sheets that edit the draft.
    private var withDialogs: some View {
        withSheets
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
            ExecutionSheet(threadId: model.threadId, providerId: model.thread?.providerId, handoff: handOff)
        }
        // Again after the sheet closes, in case it changed them.
        .task(id: "\(model.threadId) \(model.thread?.providerId ?? "") \(choosingModel)") {
            guard !choosingModel, let execution = try? await app.client.execution(model.threadId) else { return }
            let options = try? await app.client.executionOptions(providerId: model.thread?.providerId)
            let name = execution.model.map { id in options?.models.first { $0.id == id || $0.model == id }?.displayName ?? id }
            executionLabel = [name, execution.reasoningLevel].compactMap { $0 }.joined(separator: " · ")
        }
        .fullScreenCover(item: $notes.editing) { note in
            PageEditor(pageId: note.pageId ?? "", note: NoteDoneActions(note: note, notes: notes)) { await notes.refresh() }
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
    }

    /// The error toast, loading, the draft and the unread row.
    private var withLoading: some View {
        withDialogs
        .overlay(alignment: .top) {
            // The outbox's own error shows once, on its shelf card.
            if let error = model.error, error != outbox.storageError {
                ErrorToast(message: error) { model.error = nil }
            }
        }
        .animation(.snappy, value: model.error)
        .task {
            app.lastThreadId = model.threadId
            if draft.isEmpty, let saved = Drafts.load(model.threadId, serverURL: model.serverURL) {
                draft = saved.text
                mentions = saved.mentions
            }
            if attachments.isEmpty { attachments = DraftAttachments.load(model.threadId, serverURL: model.serverURL) }
            #if DEBUG
            if let demo = NotesDemo.draft { draft = demo }
            #endif
            model.attach(app)
            if canUseNotes { notes.attach(app) }
            voice.isListening = { [composerVoice] in composerVoice.blocksPlayback }
            voice.flash = { [app] in app.flash($0) }
            composerVoice.attach(talk: talk, voice: voice)
            #if DEBUG
            if let variant = ComposerVoice.qaVariant {
                composerVoice.qaApply(variant, talk: talk, voice: voice)
                // Set every time: a draft is saved, and would hide the placeholder in the next fixture.
                draft = variant == "dictating" ? "All right, so the test notification worked" : ""
            } else {
                voice.attach(client: app.client, realtime: app.realtime)
            }
            #else
            voice.attach(client: app.client, realtime: app.realtime)
            #endif
            Task { await muted.refresh() }
            Task { reactionSettings = (try? await client.reactionSettings()) ?? .defaults }
            if runningPlugins.split(separator: ",").contains("studio") {
                Task { sourcePage = try? await client.chatPage(model.threadId) }
            }
            if runningPlugins.split(separator: ",").contains("studio") {
                Task { await bot.load(client: client) }
            }
            await model.load()
            #if DEBUG
            if botChrome != nil, let text = BotDemo.served?.send {
                // As a person would: into the composer with the keyboard up, then Send.
                composerFocused = true
                draft = text
                try? await Task.sleep(for: .seconds(2))
                ChatPerf.sent(text)
                send()
            }
            #endif
        }
        .onChange(of: draft) { _, text in
            mentions.removeAll { !text.contains($0.token) }
            Drafts.save(model.threadId, text: text, mentions: mentions, serverURL: model.serverURL)
        }
        // Open where the reader left off. Waits a beat for the rows to be laid out.
        .task(id: model.unreadFrom) {
            guard model.unreadFrom != nil else { return }
            try? await Task.sleep(for: .milliseconds(150))
            if let item = unreadItem() { read(item, anchor: .top) }
        }
        .onDisappear {
            resizeRestore?.cancel()
            resizeAnchor.cancel()
            model.detach()
            notes.detach()
        }
    }

    /// The timeline, find bar, composer, and toolbar; `body` adds sheets and tasks.
    private var screen: some View {
        TranscriptV2Switch { legacyScreen } next: { transcriptV2Screen }
    }

    private var legacyScreen: some View {
        Group {
            // Built once the first page is in, so it opens at the bottom of real
            // content rather than growing from empty.
            if model.loaded {
                timeline.id(timelineKey)
                    .modifier(RegularScrollingSurface(readableWidth: Self.readableWidth))
            } else {
                // Nothing cached yet: the shape of a chat, not a blank screen.
                ChatSkeleton(bot: botChrome != nil)
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            if finding {
                FindBar(query: $findQuery, index: $findIndex, count: findMatches.count, loading: model.loadingAll) {
                    finding = false
                    findQuery = ""
                }
                // Its buttons stay clear of the Duo's clock and icons.
                .padding(.trailing, duoLayout.statusColumn)
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.snappy, value: finding)
        // The server's page goes in over the cached rows by id, so the chat
        // stays put. Only when it doesn't join up with them (more came in
        // since than one page holds) does it replace them: start again at the
        // bottom then, unless the reader has scrolled up into the cached rows.
        .onChange(of: model.replacedCache) { _, _ in
            if atBottom || end.pastEnd > Self.pastEndSlack { timelineKey += 1 }
        }
        // Beside two pages, centred on the page above the composer, in the
        // transcript's bottom inset. One soft scrim runs from above it down
        // behind the composer, so rows fade out as they pass under both and
        // none shows between them. A phone keeps it floating in the corner.
        .overlay(alignment: .bottomTrailing) { if !duoLayout.twoPages { jumpButton } }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if duoLayout.twoPages && !atBottom {
                jumpButton
                    .frame(maxWidth: .infinity)
                    .background { JumpScrim() }
                    .transition(.opacity)
            }
        }
        .animation(.snappy, value: atBottom)
        .safeAreaInset(edge: .bottom) { composer }
        // Beside two pages the transcript, jump button and composer all run
        // under the status column, so they share the page's width and centre;
        // the header still keeps its actions inside the safe area. On the
        // Duo's inner screen, in our two pages or beside another app, they
        // also run under its 34-point home indicator inset: the composer sits
        // 8 points above the edge, as a phone's sits above its indicator.
        .ignoresSafeArea(.container, edges: duoLayout.chatIgnoredEdges)
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
            if let botChrome { botChrome.openThread(id) } else { app.path.append(.thread(id: id)) }
            return .handled
        })
        .modifier(BotChromeToolbar(chrome: botChrome, status: botStatus, shortStatus: botShortStatus, working: model.thread?.isRunning == true))
        .navigationTitle(botChrome != nil ? "" : model.thread.map { ThreadTitles.resolve($0.displayTitle) } ?? "Thread")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(duoLayout.twoPages || (sizeClass == .compact && hidesTabBar) ? .hidden : .automatic, for: .tabBar)
        .toolbar(duoLayout.twoPages ? .hidden : .automatic, for: .navigationBar)
        .safeAreaInset(edge: .top, spacing: 0) {
            if duoLayout.twoPages && botChrome == nil {
                DuoHeader {
                    Text(model.thread.map { ThreadTitles.resolve($0.displayTitle) } ?? "Thread")
                        .font(.headline).lineLimit(1).accessibilityIdentifier("duoThreadTitle")
                } actions: { threadActions }
            }
        }
        .toolbar {
            if botChrome == nil && !duoLayout.twoPages {
                ToolbarItemGroup(placement: .topBarTrailing) { threadActions }
            }
        }
    }

    @ViewBuilder private var threadActions: some View {
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
            Button { finding = true } label: { Label("Find in thread", systemImage: "magnifyingglass") }
            Button {
                newTitle = model.thread?.title ?? model.thread?.displayTitle ?? ""
                renaming = true
            } label: { Label("Rename", systemImage: "pencil") }
            Button { choosingModel = true } label: { Label("Model & permissions", systemImage: "cpu") }
            if let terminals = TerminalScope.forThread(model.threadId, environmentId: model.thread?.environmentId) {
                Button { showingFiles = true } label: { Label("Files & changes", systemImage: "folder") }
                Button { app.push(.terminals(scope: terminals, title: "Terminals")) } label: {
                    Label("Terminals", systemImage: "apple.terminal")
                }
            }
            Button { showingHistory = true } label: { Label("Recent prompts", systemImage: "clock.arrow.circlepath") }
            if canSaveFiles {
                Button { savingFiles = SaveToStudioRequest(threadId: model.threadId, seq: nil) } label: {
                    Label("Save Files to Studio…", systemImage: "square.and.arrow.down.on.square")
                }
            }
            BotMenu(
                model: bot, threadId: model.threadId,
                isChild: model.thread?.parentThreadId != nil,
                editHeartbeat: { editingBotHeartbeat = true }
            ) { model.error = $0 }
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
            Image(systemName: "ellipsis").modifier(DuoHeaderMenuLabel())
        }
        .accessibilityLabel("More")
    }

    /// The Bot's status line, for its header.
    private var botStatus: String {
        BotStatus.line(state: botChrome?.bot.state, running: model.thread?.isRunning == true, thinking: model.shelf.thinking,
                       attention: botChrome?.attention?.reason, lead: botChrome?.bot.lead)
    }

    /// "1 question", "Approval", "2 things": the Bot's attention, short, for a tight header.
    private var botShortStatus: String? {
        guard let attention = botChrome?.attention, botStatus == attention.reason else { return nil }
        return BotStatus.short(reason: attention.reason, count: attention.count)
    }

    private var timeline: some View {
        timelinePaging
        .onChange(of: finding) { _, finding in
            if finding { Task { await model.loadAll() } }
        }
        .onChange(of: findQuery) { _, _ in findIndex = 0 }
        // Earlier pages going in above would carry the match off screen.
        .onChange(of: model.rows.first?.id) { _, _ in
            if finding, let currentMatch { read(currentMatch, anchor: .center) }
        }
        .onChange(of: currentMatch) { _, id in
            if let id { withAnimation(.snappy) { read(id, anchor: .center) } }
        }
        .onChange(of: model.interactions.first?.id) { _, id in
            if id != nil { scrollToBottom() }
        }
        .onChange(of: model.confirmations) { _, _ in scrollToBottom() }
        .onChange(of: outbox.messages.count) { old, new in
            if new > old { scrollToBottom() }
        }
    }

    /// Scrolling by hand, rows going in at the end, and older pages at the top.
    private var timelinePaging: some View {
        timelineGeometry
        .onScrollPhaseChange { _, phase in
            #if DEBUG
            RenderCount.bump("write.scrollPhase")
            #endif
            scrollPhase = phase
            end.animationOver = false
            if phase == .animating { watchAnimation() }
            if phase == .tracking || phase == .interacting {
                resizeRestore?.cancel()
                resizeAnchor.cancel()
                end.readerScrolling = true
            }
            // The reader decides: wherever their scroll comes to rest, the
            // chat follows its end only if that's near the end. The app's own
            // animated scrolls don't decide it: one cut short by a newer
            // request rests wherever it was, short of a reply still growing,
            // and the chat stopped following with no one having scrolled.
            if phase == .idle, end.readerScrolling {
                end.following = end.geometry.nearEnd
                end.readerScrolling = false
            }
            keepAtEnd()
        }
        // The first page lands at the bottom through `defaultScrollAnchor`;
        // scrolling by hand while lazy rows are still measuring can overshoot.
        .onChange(of: model.shownRows.last?.id) { old, _ in
            if old != nil, atBottom || model.shownRows.last?.isUser == true { scrollToBottom() }
        }
        // The Bot's typing row goes in under the message just sent.
        .onChange(of: showsWorking) { _, shows in
            if shows, atBottom { scrollToBottom() }
        }
        // Older pages load when the reader reaches the top.
        .onScrollGeometryChange(for: Bool.self) { geometry in
            geometry.contentOffset.y + geometry.contentInsets.top < 40
        } action: { _, isAtTop in
            #if DEBUG
            RenderCount.bump("write.atTop")
            #endif
            atTop = isAtTop
        }
        // Keeps loading while the reader stays at the top and a page is too
        // short to move them off it; backs off after failures, and stops when
        // a page brings nothing new.
        .task(id: atTop) {
            var failures = 0
            while atTop, botChrome != nil ? model.canLoadOlder : model.hasOlder, !Task.isCancelled {
                guard let delay = await loadOlder().retryDelay(failures: &failures) else { break }
                try? await Task.sleep(for: delay)
            }
        }
    }

    // `timeline` in parts, so each type-checks quickly. The same modifiers, in order.

    /// The rows, and the Debug QA commands.
    private var timelineScroll: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                if botChrome != nil ? model.canLoadOlder : model.hasOlder {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                }
                if let botChrome {
                    if !model.canLoadOlder { BotHero(bot: botChrome.bot, status: botStatus, working: model.thread?.isRunning == true) }
                    BotChatTimeline(
                        bot: botChrome.bot, rows: model.chainRows, threadId: model.threadId, projectId: model.thread?.projectId,
                        running: model.thread?.isRunning == true, thinking: model.shelf.thinking, started: botChrome.started, compactions: botChrome.compactions,
                        react: { send(text: $0) }, quote: { quote($0) }, select: { selecting = SelectionText(text: $0) },
                        edit: startEditing, editableId: lastUserRowId, openThread: botChrome.openThread,
                        sideThreads: botChrome.sideThreads, replyInThread: botChrome.replyInThread, threadRows: model.rowIds, cached: model.showsCache, measure: { resizeAnchor.measure($0, row: $1) }, unmeasure: { resizeAnchor.forget($0) })
                }
                let items = botChrome != nil ? [] : model.shownItems
                let unread = unreadItem(in: items)
                let editable = lastUserRowId
                // Once, not per row: it searches every row while Find is open.
                let match = currentMatch
                let sideChat = runningPlugins.split(separator: ",").contains("side-chat") ? openSideChat : nil
                ForEach(items) { item in
                    // One view per item, so scrolling to the item lands on the divider.
                    timelineItem(item, unread: unread, editable: editable, match: match, sideChat: sideChat)
                    .onGeometryChange(for: TranscriptResizeAnchor.Row.self) { proxy in
                        let isMessage: Bool
                        if case .message = item { isMessage = true } else { isMessage = false }
                        return TranscriptResizeAnchor.Row(width: proxy.bounds(of: .scrollView)?.width ?? 0,
                            frame: proxy.frame(in: .global), isMessage: isMessage)
                    } action: { row in
                        resizeAnchor.measure(item.id, row: row)
                    }
                    .onDisappear { resizeAnchor.forget(item.id) }
                }
                ForEach(outbox.messages(for: model.threadId)) { message in
                    PendingBubble(message: message)
                }
                ForEach(botChrome == nil ? model.interactions : []) { interaction in
                    InteractionCard(
                        interaction: interaction,
                        resolve: { await model.resolve(interaction, $0) },
                        cancel: { await model.cancel(interaction) },
                        openWeb: { showingWeb = true })
                    .id(interaction.id)
                }
                if showsWorking {
                    if let botChrome {
                        BotTypingRow(bot: botChrome.bot, thinking: model.shelf.thinking)
                            .transition(.opacity.combined(with: .scale(scale: 0.9, anchor: .bottomLeading)))
                    } else {
                        WorkingIndicator(thinking: model.shelf.thinking)
                    }
                }
                // Where "scroll to the bottom" goes. A lazy stack scrolled to its
                // bottom edge while rows go in and the composer or keyboard moves
                // can land where it draws nothing: after a send, a blank chat
                // until the reply. Scrolling to a view lays that view out.
                Color.clear.frame(height: 1).id(Self.bottomId)
            }
            #if DEBUG
            // The transcript's content edges, which bubbles reach; the composer matches them.
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { DuoDemo.surfaces["transcript-" + model.threadId] = $0 }
            .onDisappear { DuoDemo.surfaces["transcript-" + model.threadId] = nil }
            #endif
            .padding(.horizontal, Self.margin(bot: botChrome != nil))
            .padding(.vertical, 8)
            .animation(botChrome != nil ? .smooth(duration: 0.3) : nil, value: showsWorking)
            .scrollTargetLayout()
            .frame(maxWidth: Self.readableWidth)
            .frame(maxWidth: .infinity)
            // A tap on the transcript puts the keyboard away; rows keep their taps.
            .background(alignment: .topLeading) {
                TranscriptTapDismissesKeyboard(active: composerFocused).frame(width: 1, height: 1)
            }
        }
        #if DEBUG
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("duo-qa-inspect"))) { _ in
            guard BotDemo.variant == "duo", app.tab == .bot, botChrome != nil else { return }
            let window = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).first { $0.isKeyWindow }
            window?.accessibilityValue = "\(ObjectIdentifier(model))|loads=\(model.qaLoadCount)|keeper=\(ObjectIdentifier(resizeAnchor))#\(resizeAnchor.debugState)"
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("qa-draft"))) { event in
            // `n` lines in the composer, which grows with them; 0 empties it, and quick replies come back.
            let lines = event.object as? Int ?? 0
            draft = (0..<lines).map { "Draft line \($0 + 1)" }.joined(separator: "\n")
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("qa-attach"))) { _ in
            // A photo in the composer, as if picked from the library.
            let image = UIGraphicsImageRenderer(size: CGSize(width: 64, height: 64)).image { context in
                UIColor.systemTeal.setFill()
                context.fill(CGRect(x: 0, y: 0, width: 64, height: 64))
            }
            if let attachment = PendingAttachment.image(image) { attachments.append(attachment) }
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("duo-qa-scroll"))) { event in
            guard BotDemo.variant != nil else { return }
            resizeRestore?.cancel()
            resizeAnchor.cancel()
            if event.object as? String == "mid" {
                if botChrome != nil {
                    let entries = BotChatEntry.memo.entries(model.chainRows, started: botChrome?.started ?? [], compactions: [])
                    if let entry = entries.first(where: { $0.id == "a150" }) ?? entries.dropFirst(entries.count / 2).first { read(entry.id, anchor: .top) }
                } else {
                    let items = TimelineItem.group(model.shownRows)
                    if let item = items.dropFirst(items.count / 4).first { read(item.id, anchor: .top) }
                }
            } else { scrollToBottom(animated: false) }
        }
        #endif
    }

    /// Where the rows are, and the one owner of the end.
    private var timelineGeometry: some View {
        timelineScroll
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { resizeAnchor.frame = $0 }
        .onScrollTargetVisibilityChange(idType: String.self, threshold: 0.01) { ids in
            resizeAnchor.visible(ids)
            end.markerVisible = ids.contains(Self.bottomId)
            ScrollLog.visible(ids)
        }
        .onScrollGeometryChange(for: ScrollGeometry.self) { $0 } action: { _, geometry in ScrollLog.geometry(geometry) }
        .coordinateSpace(name: "threadTranscript")
        .modifier(TranscriptScrollPosition(scroller: scroller))
        .onScrollGeometryChange(for: TranscriptResizeAnchor.Viewport.self) { geometry in
            TranscriptResizeAnchor.Viewport(size: geometry.containerSize, offset: geometry.contentOffset.y,
                inset: geometry.contentInsets.top, bottomGap: geometry.contentSize.height - geometry.unobscuredBottom,
                contentHeight: geometry.contentSize.height, bottomInset: geometry.contentInsets.bottom)
        } action: { _, viewport in
            if let anchor = resizeAnchor.update(viewport) { restoreAfterWidthChange(anchor) }
        }
        // The Bot's header floats on glass: earlier messages blur away under it
        // rather than being cut off at a hard edge.
        .scrollEdgeEffectStyle(botChrome != nil ? .soft : nil, for: .top)
        .defaultScrollAnchor(.bottom)
        .scrollDismissesKeyboard(.interactively)
        // The one owner of the timeline's end: rows growing or shrinking,
        // the keyboard, composer or quick replies changing the bottom inset
        // all come through here as geometry, and `keepAtEnd` answers them.
        .onScrollGeometryChange(for: EndGeometry.self) { geometry in
            EndGeometry(
                distance: TranscriptResizeAnchor.overshoot(contentHeight: geometry.contentSize.height,
                    viewportHeight: geometry.containerSize.height, visibleBottom: geometry.unobscuredBottom),
                lastPoint: TranscriptResizeAnchor.lastPoint(contentHeight: geometry.contentSize.height,
                    viewportHeight: geometry.containerSize.height),
                point: geometry.contentOffset.y + geometry.contentInsets.top,
                nearEnd: geometry.unobscuredBottom >= geometry.contentSize.height - 120,
                bottomInset: geometry.contentInsets.bottom)
        } action: { _, next in
            // The keyboard, composer or quick replies changing the bottom
            // inset while the reader was at the end: keep the end in view.
            if next.bottomInset != end.geometry.bottomInset, end.geometry.nearEnd, !end.readerScrolling {
                end.following = true
            }
            if next.point != end.geometry.point { end.moved = .now }
            end.geometry = next
            // The jump button's state comes from here too. A separate
            // observer of the same test stopped reporting once rows settled
            // their heights after a jump to the end: the chat sat at its end
            // with the button still up (DuoSplitComposerUITests).
            if atBottom != next.nearEnd {
                #if DEBUG
                RenderCount.bump("write.atBottom")
                #endif
                atBottom = next.nearEnd
            }
            #if DEBUG
            RenderCount.bump("geometry.end")
            #endif
            keepAtEnd()
        }
    }

    /// One item of `timeline`, built apart so the timeline type-checks quickly.
    @ViewBuilder private func timelineItem(_ item: TimelineItem, unread: String?, editable: String?, match: String?,
                                           sideChat: ((String) -> Void)?) -> some View {
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
                        saveFiles: canSaveFiles ? { savingFiles = SaveToStudioRequest(threadId: model.threadId, seq: $0) } : nil,
                        readAloud: voice.available == true ? { voice.readAloud(rowId: row.id, text: $0) } : nil,
                        reading: player.isReading(row.id))
                    .environment(\.readAlongPiece, row.id == readAlongRow ? player.piece : nil)
                case .activity(let rows):
                    ActivityGroup(rows: rows)
                }
            }
            .background {
                if item.id == match {
                    RoundedRectangle(cornerRadius: 12).fill(.yellow.opacity(0.22)).padding(-6)
                }
            }
        }
    }

    /// The only new scroll requests: after a container-width change. First
    /// materialize the saved row in the lazy stack, then restore its pixel
    /// offset as the new widths settle. An interaction cancels this work.
    private func restoreAfterWidthChange(_ anchor: TranscriptResizeAnchor.Anchor) {
        #if DEBUG
        RenderCount.bump("restore")
        #endif
        ScrollLog.request("restoreAfterWidthChange \(ScrollLog.describe(anchor))")
        resizeRestore?.cancel()
        let token = resizeAnchor.generation
        resizeRestore = Task { @MainActor in
            // A restore's last jump can itself land past the end, while the
            // check is held off; check once it's done.
            defer {
                resizeAnchor.finish(token)
                ScrollLog.request("restore released")
                keepAtEnd()
                // Once more after the layout the release lets through: the
                // geometry seen here can predate the restore's last jump.
                Task { @MainActor in
                    try? await Task.sleep(for: .milliseconds(150))
                    keepAtEnd()
                }
            }
            try? await Task.sleep(for: .milliseconds(120))
            guard !Task.isCancelled else { return }
            switch anchor {
            case .bottom:
                // A single lazy-stack jump can precede a cascade of new row
                // heights. Keep the marker pinned while that layout settles.
                for _ in 0..<24 {
                    guard !Task.isCancelled else { return }
                    scrollToBottom(animated: false)
                    try? await Task.sleep(for: .milliseconds(100))
                }
            case .message(let id, let offset):
                read(id, anchor: .top)
                var restored = false
                for _ in 0..<12 {
                    try? await Task.sleep(for: .milliseconds(100))
                    guard !Task.isCancelled else { return }
                    if let alignment = resizeAnchor.alignment(for: id, offset: offset) {
                        // Keep an id anchor after the restore. A raw point loses
                        // its message as estimated heights above it settle.
                        read(id, anchor: UnitPoint(x: 0, y: alignment))
                        restored = true
                    } else if let y = resizeAnchor.correction(for: id, offset: offset) {
                        ScrollLog.request("restore scrollTo(y: \(y))")
                        end.following = false
                        scroller.scrollTo(y: y)
                        restored = true
                    } else { restored = false }
                }
                // Unmeasured/stale lazy geometry cannot provide a safe point.
                // Materializing the bottom marker is the deterministic fallback.
                if !restored { scrollToBottom(animated: false) }
            }
            try? await Task.sleep(for: .milliseconds(120))
            guard !Task.isCancelled else { return }
            // Past the end is `keepAtEnd`'s, once this finishes.
            if let viewport = resizeAnchor.viewport {
                let point = viewport.offset + viewport.inset
                if !point.isFinite || point < -Self.pastEndSlack || !resizeAnchor.hasVisibleRows {
                    scrollToBottom(animated: false)
                }
            }
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
        // The Bot types while it thinks, and while it works between replies.
        if botChrome != nil, let last = model.rows.last, last.isConversation, !last.isUser, !(last.text ?? "").isEmpty { return false }
        if botChrome != nil { return true }
        if model.shelf.thinking?.isEmpty == false { return true }
        guard let last = model.rows.last, last.kind == "work" else { return true }
        return !["inProgress", "running", "pending"].contains(last.status ?? "")
    }

    /// The page goes in above the reader, so bring back what was the first
    /// item. By id rather than offset: rows above are only estimated heights.
    private func loadOlder() async -> OlderPage {
        let first = botChrome.map { BotChatEntry.memo.entries(model.chainRows, started: $0.started, compactions: $0.compactions).first?.id } ?? TimelineItem.group(model.rows).first?.id
        guard let first else { return .nothing }
        let result = await model.loadOlder()
        ScrollLog.request("loadOlder \(result) keep \(ScrollLog.id(first))")
        if result == .added { read(first, anchor: .top) }
        return result
    }

    /// Past this, the timeline is past its last row rather than bouncing.
    private static let pastEndSlack: CGFloat = 40
    private static let bottomId = "timeline-bottom"

    /// Keeps the timeline at its end, by point: the last valid offset of the
    /// measured content. While the reader follows the end, any change that
    /// moves it (a reply streaming in, the keyboard opening or closing,
    /// quick replies going) brings the newest row back to the bottom; and
    /// a timeline resting past its end, following or not, comes back to it.
    ///
    /// By point, because the alternatives miss: pinned to the marker's id,
    /// SwiftUI kept the offset when the bottom inset changed, a keyboard of
    /// black under the last row once it closed; pinned to the bottom edge,
    /// it landed one bottom inset past the end (428 pt with the Duo's
    /// keyboard up, where only 168 pt of chat shows: a black screen) on
    /// every streamed update.
    private func keepAtEnd() {
        guard scrollPhase == .idle || end.animationOver, !resizeAnchor.restoring else {
            if end.pastEnd > 0.5 || end.following { ScrollLog.request("keepAtEnd held phase=\(scrollPhase) restoring=\(resizeAnchor.restoring) past=\(end.pastEnd)") }
            return
        }
        guard end.following || end.pastEnd > 0.5 else { return }
        let target = end.geometry.lastPoint
        guard abs(end.geometry.point - target) > 0.5 else { return }
        ScrollLog.request("keepAtEnd following=\(end.following) from \(end.geometry.point) to \(target)")
        #if DEBUG
        RenderCount.bump("keepAtEnd.scroll")
        #endif
        scroller.scrollTo(y: target)
    }

    /// SwiftUI's animated scroll can end without the phase going back to idle.
    /// Aimed at the end of a new row's estimated height, its target is gone
    /// once the row measures shorter: the offset snaps back to where it
    /// started and the phase stays "animating". `keepAtEnd` then held for
    /// good, the newest row under the composer, and under the keyboard once
    /// it came back. So while the phase says animating, an offset that hasn't
    /// moved for `animationStill` is an animation that is over, and the end
    /// is `keepAtEnd`'s again. A phase change starts over.
    private func watchAnimation() {
        animationWatch?.cancel()
        animationWatch = Task { @MainActor in
            while !Task.isCancelled, scrollPhase == .animating, !end.animationOver {
                try? await Task.sleep(for: .milliseconds(100))
                guard !Task.isCancelled, scrollPhase == .animating else { return }
                let still = Date.now.timeIntervalSince(end.moved)
                if still >= Self.animationStill {
                    end.animationOver = true
                    ScrollLog.request(String(format: "animation over: still %.2fs, phase=animating", still))
                    keepAtEnd()
                }
            }
        }
    }

    /// An animated scroll moves every frame; this long without, it's over.
    private static let animationStill: TimeInterval = 0.3

    /// Takes the reader to a row (unread, a find match, where they were):
    /// not following the end, or the next change would carry them off it.
    private func read(_ id: String, anchor: UnitPoint) {
        #if DEBUG
        RenderCount.bump("read")
        #endif
        if transcriptV2.controller != nil { return transcriptV2.scrollTo(id, position: anchor == .center ? .center : .top) }
        end.following = false
        scroller.scrollTo(id: id, anchor: anchor)
    }

    /// Follows the end from now on. Near it, a short animated scroll; from
    /// far up, a jump to the marker's id, which lays the end out at once in
    /// the lazy stack (a point there is only an estimate), and `keepAtEnd`
    /// then settles on the measured end. An animated scroll to an id in a
    /// lazy stack re-aims as unmeasured rows above measure in: after a send
    /// in a long chat of uneven rows, the whole transcript visibly scrolled
    /// past.
    private func scrollToBottom(animated: Bool = true) {
        #if DEBUG
        RenderCount.bump("scrollToBottom")
        #endif
        if transcriptV2.controller != nil { return transcriptV2.jumpToLatest(animated: animated) }
        ScrollLog.request("scrollToBottom animated=\(animated) atBottom=\(atBottom) pastEnd=\(end.pastEnd)")
        end.following = true
        if end.markerVisible || atBottom {
            if animated {
                withAnimation(.snappy) { scroller.scrollTo(y: end.geometry.lastPoint) }
                // Still "animating" from one that never reported its end, the
                // phase won't change for this one: watch it from here.
                if scrollPhase == .animating {
                    end.animationOver = false
                    watchAnimation()
                }
            } else {
                scroller.scrollTo(y: end.geometry.lastPoint)
            }
        } else {
            scroller.scrollTo(id: Self.bottomId, anchor: .bottom)
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
            && !dictation.blocksSend
    }

    private func takeActionButton() {
        guard answersActionButton, app.botTalkPending else { return }
        app.botTalkPending = false
        // A sheet over the thread owns the microphone while it's open.
        guard app.sheet == nil else { return }
        talk.toggleHandsFree()
    }

    /// Sends a quick reply or starter as it is.
    private func send(text: String) {
        sends += 1
        Task { if await !model.send(text, mentions: [], attachments: []) { restoreDraft(text, []) } }
    }

    /// Clears the field right away and puts the text back if sending fails.
    private func send() {
        guard !dictation.blocksSend else { return }
        if editing { return saveEdit() }
        sends += 1
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let files = attachments
        let sentMentions = mentions
        draft = ""
        attachments = []
        Task {
            if await !model.send(text, mentions: sentMentions, attachments: files) {
                restoreDraft(text, sentMentions)
                DraftAttachments.restore(files, threadId: model.threadId, serverURL: model.serverURL)
                if attachments.isEmpty { attachments = files }
            }
        }
    }

    /// Voice mode: what you said goes after what was typed, and is sent at
    /// once, with the conversational note for the agent. Mentions and files
    /// can't go that way, so then it waits in the composer for Send.
    private func sendSpoken(_ heard: String) {
        let text = TalkDraft.finished(heard, typed: &talkTyped, draft: draft).trimmingCharacters(in: .whitespacesAndNewlines)
        guard mentions.isEmpty, attachments.isEmpty else {
            draft = text
            return
        }
        draft = ""
        sends += 1
        Task {
            let note = await voice.agentNote()
            if await !model.send(text, agentNote: note) { restoreDraft(text, []) }
        }
    }

    /// Moves the draft into the thread's note and opens it. The composer is
    /// cleared once the server has saved the text; attachments stay in it.
    private func expandToPage() {
        guard !dictation.blocksSend, !notes.expanding else { return }
        if editing { return }
        let text = draft
        Task {
            do {
                if let next = try await notes.expand(draft: text, current: { draft }) {
                    draft = next
                    mentions = []
                }
            } catch {
                model.error = "Couldn't expand to a page: \(BBClient.describe(error, server: client.baseURL))"
            }
        }
    }

    /// Puts unsent text back in the composer, and in storage in case the thread closed meanwhile.
    private func restoreDraft(_ text: String, _ sentMentions: [Mention]) {
        Drafts.restore(model.threadId, text: text, mentions: sentMentions, serverURL: model.serverURL)
        guard draft.isEmpty else { return }
        draft = text
        mentions = sentMentions
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
        guard !dictation.blocksSend else { return }
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let sentMentions = mentions
        draft = ""
        Task {
            if await !model.send(text, mentions: sentMentions, at: date) { restoreDraft(text, sentMentions) }
        }
    }

    private func saveDraft() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let sentMentions = mentions
        draft = ""
        Task {
            if await !model.saveDraft(text, mentions: sentMentions) { restoreDraft(text, sentMentions) }
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


    /// Hands the thread off to another provider's model, then follows the new
    /// thread: the Bot tab reloads its bot; elsewhere it replaces this thread.
    private func handOff(providerId: String, providerName: String, modelId: String, modelName: String, reasoning: String?) {
        handoffStatus = (ModelHandoffPlan.progressLabel(providerName: providerName), true)
        let threadId = model.threadId
        Task {
            do {
                let result = try await app.client.handoffToModel(threadId, providerId: providerId, model: modelId, reasoning: reasoning)
                guard let next = result.threadId, next != threadId else {
                    handoffStatus = ModelHandoffPlan.doneLabel(result.change, modelName: modelName).map { ($0, false) }
                    return
                }
                handoffStatus = nil
                if let botChrome {
                    botChrome.followThread(next)
                } else if let index = app.path.lastIndex(of: .thread(id: threadId)) {
                    app.path[index] = .thread(id: next)
                } else {
                    app.path.append(.thread(id: next))
                }
            } catch {
                handoffStatus = nil
                model.error = BBClient.describe(error, server: app.client.baseURL)
            }
        }
    }

    private var composer: some View {
        VStack(spacing: 8) {
            if let botChrome {
                BotNeedsYouCard(interactions: model.interactions,
                                resolve: { await model.resolve($0, $1) }, cancel: { await model.cancel($0) },
                                openWeb: { showingWeb = true })
                let replies = BotQuickReplies.items(in: model.shownRows)
                if model.interactions.isEmpty, model.thread?.isRunning != true, !replies.isEmpty, draft.isEmpty {
                    BotQuickReplies(items: replies, tint: BotPalette.color(botChrome.bot.color)) { send(text: $0) }
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            ThreadShelf(model: model)
            if let error = outbox.storageError {
                ShelfCard(icon: "exclamationmark.triangle", tint: .red) {
                    Text(error).lineLimit(3)
                } trailing: {
                    Button("Retry") {
                        outbox.retryStorage()
                        if outbox.storageError == nil, model.error == error { model.error = nil }
                    }
                    .font(.footnote.weight(.semibold))
                    .padding(.trailing, 6)
                }
                .accessibilityIdentifier("outboxStorageError")
            }
            if let status = handoffStatus {
                ShelfCard(icon: status.working ? "arrow.triangle.2.circlepath" : "checkmark.circle", tint: status.working ? .orange : .green) {
                    HStack(spacing: 6) {
                        if status.working { ProgressView().controlSize(.mini) }
                        Text(status.text).lineLimit(1)
                    }
                } trailing: { EmptyView() }
                .accessibilityIdentifier("handoffStatus")
            }
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
            if let note = notes.note, !editing {
                NotesInProgressChip(note: note) { notes.editing = note }
            }
            VoiceIndicator(composer: composerVoice, talk: talk, voice: voice, player: player)
            if composerFocused, let query = MentionSuggestions.query(in: draft) {
                MentionSuggestions(query: query, threadId: model.threadId, projectId: model.thread?.projectId, pick: insert)
            } else if composerFocused, let query = CommandSuggestions.query(in: draft),
                let projectId = model.thread?.projectId, let providerId = model.thread?.providerId {
                CommandSuggestions(query: query, projectId: projectId, providerId: providerId,
                    environmentId: model.thread?.environmentId, pick: insertCommand)
            }
            ComposerBar(
                text: $draft, focused: $composerFocused, attachments: $attachments,
                placeholder: composerVoice.shown.placeholder ?? botChrome.map { "Message \($0.bot.name)" } ?? "Message",
                dictate: { talk.startDictation() }, talk: talk, expand: draftIsLong ? { editingFull = true } : nil,
                clear: true, dictation: dictation,
                toPage: canUseNotes && !editing ? ComposerPageAction(
                    label: ThreadNotes.expandLabel(hasNote: notes.note != nil, draftEmpty: draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty),
                    busy: notes.expanding, disabled: dictation.blocksSend, run: expandToPage) : nil,
                voice: voice.available == true && !editing ? VoiceModeButton(voice: voice) { editingVoice = true } : nil,
                pushToTalk: voice.available == true && composerVoice.shown.voiceOn ? PushToTalkButton(composer: composerVoice, talk: talk) : nil
            ) {
                Button { choosingModel = true } label: { ComposerSettingsLabel(title: executionLabel) }
                    .disabled(handoffStatus?.working == true)
                    .accessibilityLabel("Model & permissions")
            } send: {
                if let botChrome, model.thread?.isRunning == true, !canSend, !dictation.blocksSend {
                    // Nothing typed while the Bot works: stop it.
                    Button { Task { await model.stop() } } label: {
                        Group {
                            if model.stopping {
                                ProgressView().tint(Color(uiColor: .systemBackground))
                            } else {
                                Image(systemName: "stop.fill").font(.footnote.weight(.bold))
                            }
                        }
                        .foregroundStyle(Color(uiColor: .systemBackground))
                        .frame(width: 32, height: 32)
                        .background(Color.primary.opacity(0.85), in: .circle)
                        .frame(width: 36, height: 36)
                    }
                    .disabled(model.stopping)
                    .accessibilityLabel("Stop \(botChrome.bot.name)")
                } else {
                Button(action: send) {
                    Group {
                        if model.sending {
                            ProgressView()
                        } else if let botChrome {
                            Image(systemName: model.thread?.isRunning == true ? "text.append" : "arrow.up")
                                .font(.body.weight(.bold))
                                .foregroundStyle(.white)
                                .frame(width: 32, height: 32)
                                .background(canSend ? BotPalette.color(botChrome.bot.color) : Color.secondary.opacity(0.35), in: .circle)
                        } else {
                            Image(systemName: model.thread?.isRunning == true ? "text.append" : "arrow.up.circle.fill")
                                .font(model.thread?.isRunning == true ? .body.weight(.semibold) : .title)
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
            .modifier(BotComposerGlass(active: true))
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("threadComposer")
        }
        .animation(.smooth(duration: 0.25), value: model.interactions.first?.id)
        // Kept with the draft text, for when the thread opens again.
        .onChange(of: attachments.map(\.id)) { _, _ in
            DraftAttachments.save(attachments, threadId: model.threadId, serverURL: model.serverURL)
        }
        // Floats over the transcript, as in the Bot chat: no bar behind it.
        // Beside two pages it has the transcript's margins.
        .padding(.horizontal, duoLayout.twoPages ? Self.margin(bot: botChrome != nil) : 12)
        .padding(.vertical, 8)
        .frame(maxWidth: Self.readableWidth)
        .frame(maxWidth: .infinity)
        // A `bbstudio://reply/<id>` link lands here.
        .onChange(of: app.replyThreadId, initial: true) { _, id in
            guard id == model.threadId else { return }
            composerFocused = true
            app.replyThreadId = nil
        }
    }

    /// Lines past this get hard to follow on an iPad or a wide window.
    private static let readableWidth: CGFloat = 760
    /// The transcript's side margins: the Bot chat's bubbles sit closer to the edges.
    private static func margin(bot: Bool) -> CGFloat { bot ? 12 : 16 }
}

/// Behind the jump button: clear above it, the page's background by its
/// middle, and solid down behind the composer to the window's bottom edge.
private struct JumpScrim: View {
    var body: some View {
        let surface = Color(uiColor: .systemBackground)
        VStack(spacing: 0) {
            LinearGradient(stops: [.init(color: surface.opacity(0), location: 0),
                                   .init(color: surface.opacity(0.85), location: 0.6),
                                   .init(color: surface, location: 1)],
                           startPoint: .top, endPoint: .bottom)
                .frame(height: 64)
            surface
        }
        // Starts above the band; the composer's inset below is ignored.
        .padding(.top, -24)
        .ignoresSafeArea(.container, edges: .bottom)
        .allowsHitTesting(false)
    }
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

/// Something that went wrong on this screen, over the top of the chat. Tap to dismiss.
struct ErrorToast: View {
    let message: String
    let dismiss: () -> Void

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red)
            Text(message).frame(maxWidth: .infinity, alignment: .leading)
            Button(action: dismiss) {
                Image(systemName: "xmark")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 28, height: 28)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dismiss")
        }
        .font(.footnote)
        .padding(.leading, 14).padding(.trailing, 6).padding(.vertical, 6)
        .glassEffect(.regular, in: .rect(cornerRadius: 20))
        .frame(maxWidth: 560)
        .padding(.horizontal, 12)
        .padding(.top, 4)
        .onTapGesture(perform: dismiss)
        .transition(.move(edge: .top).combined(with: .opacity))
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityAction(named: "Dismiss", dismiss)
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

/// The timeline's end as measured: how far the view runs past the last
/// row, the `ScrollPosition` point that puts the last row at the bottom,
/// the point it's at now, and whether that's near the end.
private struct EndGeometry: Equatable {
    var distance: CGFloat = 0
    var lastPoint: CGFloat = 0
    var point: CGFloat = 0
    var nearEnd = true
    var bottomInset: CGFloat = 0
}

private final class TranscriptEnd {
    var geometry = EndGeometry()
    /// How far the timeline is scrolled past its last row (0 when it isn't).
    var pastEnd: CGFloat { geometry.distance }
    var markerVisible = false
    /// The newest row stays at the bottom. Opens true (the chat opens at its
    /// end); set where the reader's scroll comes to rest, by `scrollToBottom`,
    /// and when the bottom inset changes while the reader is at the end.
    var following = true
    /// The reader's finger is on the transcript, or its fling is still going.
    var readerScrolling = false
    /// When the offset last moved.
    var moved = Date.distantPast
    /// The phase still says "animating", but the offset has stopped
    /// (`watchAnimation`): `keepAtEnd` no longer holds for it.
    var animationOver = false
}

extension ScrollGeometry {
    /// The bottom of what the reader sees, in content coordinates: above the
    /// composer and keyboard (the bottom inset). `containerSize` leaves the
    /// insets out, so `contentOffset + containerSize` fell short of it by the
    /// insets' height, and a chat scrolled past its end never came back.
    var unobscuredBottom: CGFloat { visibleRect.maxY - contentInsets.bottom }
}

/// Grey bubbles where a chat's messages will be, until the first rows arrive.
struct ChatSkeleton: View {
    var bot = false
    private static let bubbles: [(mine: Bool, width: CGFloat, height: CGFloat)] = [
        (false, 0.7, 64), (true, 0.45, 40), (false, 0.8, 96), (false, 0.55, 40), (true, 0.6, 40), (false, 0.75, 80),
    ]

    var body: some View {
        GeometryReader { proxy in
            VStack(alignment: .leading, spacing: 14) {
                Spacer(minLength: 0)
                ForEach(Self.bubbles.indices, id: \.self) { index in
                    let bubble = Self.bubbles[index]
                    HStack(alignment: .top, spacing: 8) {
                        if !bubble.mine, bot { Circle().fill(.quaternary).frame(width: 28, height: 28) }
                        if bubble.mine { Spacer(minLength: 0) }
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .fill(bubble.mine ? AnyShapeStyle(.tertiary) : AnyShapeStyle(.quaternary))
                            .frame(width: (proxy.size.width - 24) * bubble.width, height: bubble.height)
                        if !bubble.mine { Spacer(minLength: 0) }
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 12)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading messages")
    }
}

/// Voice mode's links to the rest of the thread: talking cuts off a reply;
/// the piece being spoken is lit up in
/// its message; an open voice thread keeps going with the screen locked.
private struct VoiceHooks: ViewModifier {
    @ObservedObject var voice: ThreadVoice
    @ObservedObject var talk: HoldToTalk
    @ObservedObject var player: VoicePlayer
    let rows: [TimelineRow]
    let running: Bool
    @Binding var readAlongRow: String?
    @Binding var editingVoice: Bool

    func body(content: Content) -> some View {
        content
            .sheet(isPresented: $editingVoice) {
                NavigationStack {
                    SpeechSettingsView(voice: voice)
                        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { editingVoice = false } } }
                }
                .presentationDetents([.medium, .large])
            }
            .onDisappear {
                voice.detach()
                // Replies play only where their thread is open.
                if player.threadId == voice.threadId { player.stop() }
            }
            .onChange(of: voice.on, initial: true) { _, on in talk.voice = on }
            .onChange(of: player.piece) { _, piece in readAlongRow = target(piece) }
            .task(id: "\(voice.on) \(voice.available == true) \(running)") { voice.report(running: running) }
    }

    /// The message being read aloud, or else the newest reply that holds the piece.
    private func target(_ piece: String?) -> String? {
        guard let piece, player.threadId == voice.threadId else { return nil }
        if let rowId = player.rowId { return rowId }
        return rows.last { $0.isConversation && !$0.isUser && ReadAlong.contains($0.text ?? "", piece: piece) }?.id
    }
}

// MARK: - The new chat transcript (Settings ▸ Diagnostics ▸ New chat transcript)

/// The same thread on the UIKit transcript: the rows, composer, header and
/// find bar go into one `TranscriptContainer`, which owns scrolling, the
/// keyboard and the insets. Everything else (sheets, tasks, the model) is
/// `body`'s, shared with the SwiftUI transcript.
extension ThreadView {
    fileprivate var transcriptV2Screen: some View {
        transcriptV2Body
            .modifier(TranscriptV2Hooks(view: self, sends: sends, outboxCount: outbox.messages.count, finding: finding,
                                        findQuery: findQuery, currentMatch: currentMatch))
            .environment(\.threadId, model.threadId)
            .environment(\.openURL, transcriptV2OpenURL)
            .modifier(BotChromeToolbar(chrome: botChrome, status: botStatus, shortStatus: botShortStatus, working: model.thread?.isRunning == true))
            .navigationTitle(botChrome != nil ? "" : model.thread.map { ThreadTitles.resolve($0.displayTitle) } ?? "Thread")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(duoLayout.twoPages || (sizeClass == .compact && hidesTabBar) ? .hidden : .automatic, for: .tabBar)
            .toolbar(duoLayout.twoPages ? .hidden : .automatic, for: .navigationBar)
            .toolbar {
                if botChrome == nil && !duoLayout.twoPages {
                    ToolbarItemGroup(placement: .topBarTrailing) { threadActions }
                }
            }
    }

    private var transcriptV2Body: some View {
        TranscriptContainer(
            items: transcriptV2Rows, chrome: transcriptV2Chrome, handle: transcriptV2,
            row: { [actions = transcriptV2Actions] row in ThreadTranscriptRowView(row: row, actions: actions) },
            composer: { composer },
            top: transcriptV2HasTop ? { transcriptV2Top } : nil,
            pill: { state, jump in transcriptV2Pill(state, jump: jump) },
            onNearTop: { transcriptV2LoadOlder() },
            log: ScrollLog.on ? { ScrollLog.request($0) } : nil,
            // Not while the window resizes, which reloads the keyboard mid-transition (crash 3).
            dismissKeyboard: { window in
                ResizeSettling.shared.afterSettling { [weak window] in
                    Breadcrumbs.shared.focus("transcript-tap", "end-editing")
                    window?.endEditing(true)
                }
            },
            pillNote: transcriptV2PillNote,
            probe: transcriptV2Probe,
            describeID: { ($0.base as? String).map(ScrollLog.id) ?? "?" })
        // Under the header and to the edges; it ends at the keyboard's top.
        .ignoresSafeArea(.container)
        .overlay {
            // Nothing cached yet: the shape of a chat, not a blank screen.
            if !model.loaded { ChatSkeleton(bot: botChrome != nil).allowsHitTesting(false) }
        }
        // Beside two pages the header owns the status-bar strip: the
        // transcript's scroll view mustn't take its taps as scroll-to-top.
        .onAppear { StatusBarStrip.schedule() }
        .onChange(of: model.loaded) { _, _ in StatusBarStrip.schedule() }
        #if DEBUG
        .onDisappear { DuoDemo.surfaces["transcript-" + model.threadId] = nil }
        #endif
    }

    /// As the SwiftUI transcript's: Studio paths and in-app thread links open here.
    private var transcriptV2OpenURL: OpenURLAction {
        OpenURLAction { url in
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
            if let botChrome { botChrome.openThread(id) } else { app.path.append(.thread(id: id)) }
            return .handled
        }
    }

    /// A message you send takes you to the end, as the jump does; find
    /// takes you to its match; the Debug QA commands drive the chat.
    fileprivate struct TranscriptV2Hooks: ViewModifier {
        let view: ThreadView
        // What the hooks watch, as values: SwiftUI can't compare the view
        // itself, and a hook on its properties never saw find move.
        let sends: Int
        let outboxCount: Int
        let finding: Bool
        let findQuery: String
        let currentMatch: String?

        func body(content: Content) -> some View {
            content
                .onChange(of: sends) { _, _ in view.transcriptV2.jumpToLatest() }
                .onChange(of: outboxCount) { old, new in if new > old { view.transcriptV2.jumpToLatest() } }
                .onChange(of: finding) { _, finding in if finding { Task { await view.model.loadAll() } } }
                .onChange(of: findQuery) { _, _ in view.findIndex = 0 }
                .onChange(of: currentMatch) { _, id in
                    if let id { view.transcriptV2.scrollTo(id, position: .center, animated: true) }
                }
                #if DEBUG
                .onReceive(NotificationCenter.default.publisher(for: Notification.Name("qa-draft"))) { event in
                    let lines = event.object as? Int ?? 0
                    view.draft = (0..<lines).map { "Draft line \($0 + 1)" }.joined(separator: "\n")
                }
                .onReceive(NotificationCenter.default.publisher(for: Notification.Name("qa-attach"))) { _ in
                    let image = UIGraphicsImageRenderer(size: CGSize(width: 64, height: 64)).image { context in
                        UIColor.systemTeal.setFill()
                        context.fill(CGRect(x: 0, y: 0, width: 64, height: 64))
                    }
                    if let attachment = PendingAttachment.image(image) { view.attachments.append(attachment) }
                }
                .onReceive(NotificationCenter.default.publisher(for: Notification.Name("duo-qa-scroll"))) { event in
                    guard BotDemo.variant != nil else { return }
                    let ids = view.transcriptV2Rows.map(\.id)
                    // The first row: the top, where older pages load.
                    if event.object as? String == "top", let first = ids.first { return view.transcriptV2.scrollTo(first, position: .top) }
                    guard event.object as? String == "mid" else { return view.transcriptV2.jumpToLatest(animated: false) }
                    let target = ids.first { $0 == "a150" } ?? ids.dropFirst(view.botChrome != nil ? ids.count / 2 : ids.count / 4).first
                    if let target { view.transcriptV2.scrollTo(target, position: .top) }
                }
                #endif
        }
    }

    fileprivate var transcriptV2Rows: [ThreadTranscriptRow] {
        guard model.loaded else { return [] }
        let pending = outbox.messages(for: model.threadId)
        if let botChrome {
            return ThreadTranscriptRow.bot(botChrome, rows: model.chainRows, status: botStatus, working: model.thread?.isRunning == true,
                canLoadOlder: model.canLoadOlder, editableId: lastUserRowId, threadRows: model.rowIds, pending: pending,
                typing: showsWorking, thinking: model.shelf.thinking)
        }
        let items = model.shownItems
        return ThreadTranscriptRow.thread(items: items, hasOlder: model.hasOlder, unread: unreadItem(in: items), match: currentMatch,
            editableId: lastUserRowId, reading: { player.isReading($0) },
            readAlong: readAlongRow.map { ($0, player.piece) }, pending: pending, interactions: model.interactions,
            working: showsWorking, thinking: model.shelf.thinking)
    }

    fileprivate var transcriptV2Actions: ThreadTranscriptActions {
        let sideChat = runningPlugins.split(separator: ",").contains("side-chat") ? openSideChat : nil
        return ThreadTranscriptActions(
            bot: botChrome?.bot, projectId: model.thread?.projectId, reactionItems: reactionSettings.items, cached: model.showsCache,
            draftReply: { draftReply($0) }, sendReply: { send(text: $0) }, quote: { quote($0) },
            select: { selecting = SelectionText(text: $0) }, edit: startEditing, sideChat: sideChat,
            saveFiles: canSaveFiles ? { savingFiles = SaveToStudioRequest(threadId: model.threadId, seq: $0) } : nil,
            readAloud: voice.available == true ? { voice.readAloud(rowId: $0, text: $1) } : nil,
            openThread: { botChrome?.openThread($0) }, replyInThread: { botChrome?.replyInThread($0) },
            resolve: { await model.resolve($0, $1) }, cancel: { await model.cancel($0) }, openWeb: { showingWeb = true })
    }

    fileprivate var transcriptV2Chrome: TranscriptChrome {
        var chrome = TranscriptChrome()
        // The composer's own 8 pt padding is the gap above the keyboard or the edge.
        chrome.composerGap = 0
        // The Duo's inner screen draws no home indicator (its 34-point inset is reported anyway).
        chrome.composerIgnoresBottomSafeArea = duoLayout.innerScreen
        chrome.composerIgnoresTrailingSafeArea = duoLayout.twoPages
        chrome.rows.margin = Self.margin(bot: botChrome != nil)
        chrome.rows.readableWidth = Self.readableWidth
        if duoLayout.twoPages {
            chrome.rowsTrailingClear = RegularScrollingSurface.inset(column: duoLayout.statusColumn, width: duoLayout.detailWidth,
                readableWidth: Self.readableWidth)
        }
        chrome.pill = duoLayout.twoPages ? .center : .trailing
        chrome.nearEnd = 120
        chrome.softTopEdge = botChrome != nil
        return chrome
    }

    fileprivate var transcriptV2HasTop: Bool { finding || (duoLayout.twoPages && botChrome == nil) }

    /// The Duo's header beside two pages, and the find bar under it.
    fileprivate var transcriptV2Top: some View {
        VStack(spacing: 0) {
            if duoLayout.twoPages && botChrome == nil {
                DuoHeader {
                    Text(model.thread.map { ThreadTitles.resolve($0.displayTitle) } ?? "Thread")
                        .font(.headline).lineLimit(1).accessibilityIdentifier("duoThreadTitle")
                } actions: { threadActions }
            }
            if finding {
                FindBar(query: $findQuery, index: $findIndex, count: findMatches.count, loading: model.loadingAll) {
                    finding = false
                    findQuery = ""
                }
                .padding(.trailing, duoLayout.statusColumn)
            }
        }
    }

    /// A question or approval waiting doesn't take the reader to the end;
    /// the pill says so instead (with push and the badge as before).
    fileprivate var transcriptV2PillNote: String? {
        let waiting = model.interactions
        guard let first = waiting.first else { return nil }
        if waiting.count > 1 { return "\(waiting.count) waiting" }
        return first.payload.kind == "approval" ? "Approval" : "Question"
    }

    /// Debug: the rows' content edges, which the composer lines up with beside two pages.
    fileprivate var transcriptV2Probe: ((CGRect) -> Void)? {
        #if DEBUG
        let key = "transcript-" + model.threadId
        return { DuoDemo.surfaces[key] = $0 }
        #else
        return nil
        #endif
    }

    /// The jump button: in the corner on a phone; beside two pages centred
    /// in its band, over a scrim that runs down behind the composer.
    @ViewBuilder fileprivate func transcriptV2Pill(_ state: TranscriptPillState, jump: @escaping () -> Void) -> some View {
        // A question waiting: its own word, tinted, in place of the count.
        let label = state.note ?? (state.unseen > 0 ? "\(state.unseen) new" : nil)
        let button = Button(action: jump) {
            HStack(spacing: 6) {
                Image(systemName: state.note != nil ? "questionmark.bubble" : "arrow.down").font(.body.weight(.semibold))
                if let label { Text(label).font(.subheadline.weight(.semibold)).monospacedDigit() }
            }
            .frame(minWidth: 40, minHeight: 40)
            .padding(.horizontal, label != nil ? 10 : 0)
        }
        .buttonStyle(.glass(state.note != nil ? .regular.tint(.orange) : .regular))
        .clipShape(.capsule)
        .padding(12)
        .accessibilityLabel(label.map { "Jump to latest, \($0)" } ?? "Jump to latest")
        .accessibilityIdentifier("jumpToLatest")
        if duoLayout.twoPages {
            button.frame(maxWidth: .infinity).background { JumpScrim().padding(.bottom, -400) }
        } else {
            button
        }
    }

    /// Older pages while the top is near: the container keeps the reader's
    /// row in place as they go in above, and asks again while still near.
    fileprivate func transcriptV2LoadOlder() {
        guard botChrome != nil ? model.canLoadOlder : model.hasOlder else { return }
        Task {
            var failures = 0
            while !Task.isCancelled {
                let result = await model.loadOlder()
                ScrollLog.request("v2 loadOlder \(result)")
                guard result != .added, let delay = result.retryDelay(failures: &failures) else { return }
                try? await Task.sleep(for: delay)
            }
        }
    }
}
