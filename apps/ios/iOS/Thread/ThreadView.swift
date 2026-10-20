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
    /// Near the bottom by the scroll view's geometry, which counts estimated
    /// heights for lazy rows not yet drawn.
    @State private var atBottom = true
    /// Following the end: new output and changes in size keep the last row
    /// in view. The reader's touch clears it at once, and it's set again
    /// when their scroll settles near the end, or by a send or "Jump to latest".
    @State private var pinned = true
    /// Where the end-of-list marker is, against the bottom of the visible area.
    @State private var end = EndPlace.bottom
    /// Brings the end back once the layout settles (`keepPinned`).
    @State private var settling: Task<Void, Never>?
    /// How many of the newest items the timeline draws; reaching the top
    /// draws more before asking the server for older pages.
    @State private var drawnItems = ThreadView.itemWindow
    @State private var atTop = false
    /// How far the timeline is scrolled past its last row, or negative short
    /// of it, to within `pastEndSlack`: past it, short of it, or near.
    @State private var pastEnd: CGFloat = 0
    /// Rebuilds the timeline so it opens at the bottom of the server's rows.
    @State private var timelineKey = 0
    @State private var scrollPhase = ScrollPhase.idle
    /// The chat's link handler, made once (`LinkOpener`).
    @State private var links = LinkOpener()
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
            if let item = unreadItem() {
                pinned = false
                ScrollLog.cause("unread")
                position.scrollTo(id: item, anchor: .top)
            }
        }
        .onDisappear {
            model.detach()
            notes.detach()
        }
        .modifier(VoiceHooks(voice: voice, talk: talk, player: player, rows: model.rows, running: model.thread?.isRunning == true,
                             readAlongRow: $readAlongRow, editingVoice: $editingVoice))
        .modifier(TalkDraft(talk: talk, draft: $draft, typed: $talkTyped))
        .onChange(of: canUseNotes) { _, can in if can { notes.attach(app) } }
        .modifier(TalkLifecycle(talk: talk))
        .onAppear {
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
        .focusedSceneValue(\.thread, actions)
        .sensoryFeedback(.success, trigger: model.confirmations)
        .task(id: botChrome?.chain) {
            // The chain ends at this thread; until `bot_chain` answers, the thread alone.
            if let chain = botChrome?.chain, chain.last == model.threadId { model.chainBefore = Array(chain.dropLast()) }
        }
        .modifier(BotThreadHooks(chrome: botChrome, threadId: model.threadId, environmentId: model.thread?.environmentId,
                                    sends: sends, running: model.thread?.isRunning == true, interactions: model.interactions.count))
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
                timeline.id(timelineKey)
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
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.snappy, value: finding)
        // The server's page goes in over the cached rows by id, so the chat
        // stays put. Only when it doesn't join up with them (more came in
        // since than one page holds) does it replace them: start again at the
        // bottom then, unless the reader has scrolled up into the cached rows.
        .onChange(of: model.replacedCache) { _, _ in
            if pinned || pastEnd > Self.pastEndSlack { timelineKey += 1 }
        }
        .overlay(alignment: .bottomTrailing) { jumpButton }
        .animation(.snappy, value: pinned)
        .safeAreaInset(edge: .bottom) { composer }
        .environment(\.threadId, model.threadId)
        .environment(\.openURL, links.action { url in openLink(url) })
        .modifier(BotChromeToolbar(chrome: botChrome, status: botStatus, working: model.thread?.isRunning == true))
        .navigationTitle(botChrome != nil ? "" : model.thread.map { ThreadTitles.resolve($0.displayTitle) } ?? "Thread")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(sizeClass == .compact && hidesTabBar ? .hidden : .automatic, for: .tabBar)
        .toolbar {
            if botChrome == nil { ToolbarItemGroup(placement: .topBarTrailing) {
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
                    Button { app.startVoiceChat(projectId: model.thread?.projectId) } label: {
                        Label("New Voice Chat", systemImage: Symbols.voiceChat)
                    }
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
                    Image(systemName: "ellipsis")
                }
                .accessibilityLabel("More")
            } }
        }
    }

    /// The Bot's status line, for its header.
    private var botStatus: String {
        BotStatus.line(state: botChrome?.bot.state, running: model.thread?.isRunning == true, thinking: model.shelf.thinking,
                       needsYou: model.interactions.count, lead: botChrome?.bot.lead)
    }

    private var timeline: some View {
        ScrollView {
            let all = botChrome != nil ? [] : TimelineItem.group(model.shownRows)
            let (items, hidden) = drawnWindow(all)
            let unread = unreadItem(in: items)
            VStack(alignment: .leading, spacing: 14) {
                // The history, drawn as it scrolls into view.
                LazyVStack(alignment: .leading, spacing: 14) {
                    if hidden > 0 || (botChrome != nil ? model.canLoadOlder : model.hasOlder) {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                    }
                    if let botChrome {
                        if !model.canLoadOlder, hidden == 0 { BotHero(bot: botChrome.bot, status: botStatus, working: model.thread?.isRunning == true) }
                        botTimeline(botChrome, part: .older(drawn: finding ? nil : drawnItems, tail: Self.tailItems))
                    }
                    ForEach(items.dropLast(Self.tailItems)) { itemView($0, unread: unread) }
                }
                .scrollTargetLayout()
                // The newest items, the reply on its way and the end, always
                // drawn. Laid out lazily, the end sat where the stack estimated
                // it: after a reply shrank under the reader in a long chat (its
                // stream settling, steps folding), a jump there drew nothing
                // (a blank chat, "Jump to latest" up, until the reader scrolled).
                VStack(alignment: .leading, spacing: 14) {
                    if let botChrome { botTimeline(botChrome, part: .newest(Self.tailItems)) }
                    ForEach(items.suffix(Self.tailItems)) { itemView($0, unread: unread) }
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
                    // Where "scroll to the bottom" goes, and how the timeline
                    // knows where its end is: the scroll view's content size
                    // counts estimates for the rows above, and lags them as
                    // they measure in. A few cases, so it changes only at an
                    // edge, not every frame of a scroll.
                    Color.clear.frame(height: 1).id(Self.bottomId)
                        .onGeometryChange(for: EndPlace.self) { EndPlace($0) } action: { place in
                            ScrollLog.log("end \(end)->\(place)")
                            end = place
                            keepPinned()
                        }
                }
                .scrollTargetLayout()
            }
            .padding(.horizontal, botChrome != nil ? 12 : 16)
            .padding(.vertical, 8)
            .animation(botChrome != nil ? .smooth(duration: 0.3) : nil, value: showsWorking)
            .frame(maxWidth: Self.readableWidth)
            .frame(maxWidth: .infinity)
        }
        .scrollPosition($position)
        // The Bot's header floats on glass: earlier messages blur away under it
        // rather than being cut off at a hard edge.
        .scrollEdgeEffectStyle(botChrome != nil ? .soft : nil, for: .top)
        .defaultScrollAnchor(.bottom, for: .initialOffset)
        .defaultScrollAnchor(.bottom, for: .alignment)
        // Growth keeps the bottom in place only while following it: scrolled
        // up, a streaming reply would slide the chat up under the reader.
        .defaultScrollAnchor(pinned ? .bottom : nil, for: .sizeChanges)
        .scrollDismissesKeyboard(.interactively)
        .onScrollGeometryChange(for: Bool.self) { geometry in
            geometry.unobscuredBottom >= geometry.contentSize.height - 120
        } action: { _, isAtBottom in
            atBottom = isAtBottom
        }
        // While pinned, a change in size (a reply streaming or settling,
        // rows folding or measuring in, the keyboard or composer moving)
        // brings the end back.
        .onScrollGeometryChange(for: ScrollFit.self) { geometry in
            ScrollFit(content: geometry.contentSize.height.rounded(), inset: geometry.contentInsets.bottom.rounded(),
                      container: geometry.containerSize.height.rounded())
        } action: { _, _ in
            keepPinned()
        }
        // Following a streaming reply scrolls to the bottom the lazy stack
        // estimates; when rows above measure shorter than estimated, or the
        // bottom shrinks (the working indicator goes, steps fold into a group),
        // the timeline is left past its end, showing nothing. Bring it back
        // once nothing is scrolling, so a bounce at the bottom isn't fought.
        .onScrollGeometryChange(for: CGFloat.self) { geometry in
            // Content shorter than the screen sits at the top: nothing is past its end.
            let end = max(geometry.contentSize.height, geometry.visibleRect.minY + geometry.contentInsets.top + geometry.containerSize.height)
            // Only which side of the slack it's on is ever asked, so this
            // changes (and writes state) at those edges, not every frame of
            // a scroll: a state write per frame dirtied the whole chat's
            // graph each frame of a fling.
            let distance = geometry.unobscuredBottom - end
            return distance > Self.pastEndSlack ? Self.pastEndSlack + 1 : distance > -Self.pastEndSlack ? 0 : -Self.pastEndSlack - 1
        } action: { _, distance in
            pastEnd = distance
            if scrollPhase == .idle { settlePastEnd() }
        }
        .onScrollPhaseChange { old, phase in
            scrollPhase = phase
            // The reader's finger: stop following at once, so a reply
            // streaming in doesn't pull the chat back down under it.
            // Updates wait while the reader's finger or fling is on the chat
            // (`ThreadModel.holdsRefresh`), and catch up once it settles.
            model.holdsRefresh = phase.byReader
            if phase.byReader {
                pinned = false
                settling?.cancel()
                settling = nil
            }
            // Their scroll settled: follow again only at the end (or past it).
            if old.byReader, phase == .idle { pinned = end == .bottom || (end == .above && pastEnd > -Self.pastEndSlack) }
            if phase == .idle {
                settlePastEnd()
                keepPinned()
            }
        }
        // The first page lands at the bottom through `defaultScrollAnchor`;
        // scrolling by hand while lazy rows are still measuring can overshoot.
        .onChange(of: model.shownRows.last?.id) { old, _ in
            // The window takes new rows in at the bottom rather than drop
            // its oldest above the reader.
            if old != nil { drawnItems += 1 }
            if old != nil, !scrollPhase.byReader, pinned || model.shownRows.last?.isUser == true { scrollToBottom() }
        }
        // The Bot's typing row goes in under the message just sent.
        .onChange(of: showsWorking) { _, shows in
            if shows, pinned, !scrollPhase.byReader { scrollToBottom() }
        }
        // Older pages load when the reader reaches the top.
        .onScrollGeometryChange(for: Bool.self) { geometry in
            geometry.contentOffset.y + geometry.contentInsets.top < 40
        } action: { _, isAtTop in
            atTop = isAtTop
        }
        // Keeps loading while the reader stays at the top and a page is too
        // short to move them off it; backs off after failures, and stops when
        // a page brings nothing new. Waits for the reader's finger or fling to
        // settle: a page going in above them mid-fling re-laid out the chat
        // (frames of 70-90ms) and its scroll back to their place moved the
        // chat under their finger.
        .task(id: atTop && !scrollPhase.byReader) {
            var failures = 0
            while atTop, !scrollPhase.byReader, hiddenItems > 0 || (botChrome != nil ? model.canLoadOlder : model.hasOlder), !Task.isCancelled {
                guard let delay = await loadOlder().retryDelay(failures: &failures) else { break }
                try? await Task.sleep(for: delay)
            }
        }
        .onChange(of: finding) { _, finding in
            if finding { Task { await model.loadAll() } }
        }
        .onChange(of: findQuery) { _, _ in findIndex = 0 }
        // Earlier pages going in above would carry the match off screen.
        .onChange(of: model.rows.first?.id) { _, _ in
            if finding, let currentMatch {
                ScrollLog.cause("find.olderPage")
                position.scrollTo(id: currentMatch, anchor: .center)
            }
        }
        .onChange(of: currentMatch) { _, id in
            guard let id else { return }
            pinned = false
            ScrollLog.cause("find")
            withAnimation(.snappy) { position.scrollTo(id: id, anchor: .center) }
        }
        // A streaming reply: follow it, at most once a beat rather than per token.
        .onChange(of: model.rows.last?.text) { _, _ in
            keepPinned()
        }
        .onChange(of: model.interactions.first?.id) { _, id in
            if id != nil, !scrollPhase.byReader { scrollToBottom() }
        }
        .onChange(of: model.confirmations) { _, _ in scrollToBottom() }
        .onChange(of: outbox.messages.count) { old, new in
            if new > old { scrollToBottom() }
        }
        .modifier(ScrollLogProbe(name: botChrome != nil ? "bot" : "thread", pinned: pinned, working: showsWorking,
                                 lastRowLength: model.rows.last?.text?.utf8.count ?? 0))
    }

    @ViewBuilder private var jumpButton: some View {
        if !pinned {
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
        let all = allItemIds
        let hidden = hiddenItems
        guard let first = all.dropFirst(hidden).first else { return .nothing }
        // Rows already here but not drawn: draw the next lot.
        if hidden > 0 {
            drawnItems = min(all.count, drawnItems + Self.itemWindow)
            ScrollLog.cause("olderDrawn")
            position.scrollTo(id: first, anchor: .top)
            return .added
        }
        let result = await model.loadOlder()
        if result == .added {
            drawnItems = max(drawnItems, allItemIds.count)
            ScrollLog.cause("olderPage")
            position.scrollTo(id: first, anchor: .top)
        }
        return result
    }

    /// The newest items a timeline draws at first. A lazy stack places what
    /// it hasn't drawn by estimated heights; over thousands of rows of every
    /// height (a line, a screenful, a folded run of tools) the estimate is
    /// off by screens. The rest draw as the reader scrolls up, like older pages.
    static let itemWindow = 60
    /// The newest items, drawn whether in view or not, so the end is where it
    /// really is. A screenful and more, a handful of views.
    static let tailItems = 16

    /// Ids of every item the timeline could draw, oldest first.
    private var allItemIds: [String] {
        if let botChrome {
            return BotChatEntry.memo.entries(model.chainRows, started: botChrome.started, compactions: botChrome.compactions).map(\.id)
        }
        return TimelineItem.group(model.shownRows).map(\.id)
    }

    /// Items above the window, not drawn.
    private var hiddenItems: Int {
        drawnWindow(botChrome != nil ? [] : TimelineItem.group(model.shownRows)).hidden
    }

    /// A regular thread's items to draw (of `all`), and how many items above
    /// them aren't drawn, the Bot's or the thread's. All of them while
    /// finding, as a match can be anywhere; stretched to keep the first
    /// unread item in, as the timeline opens there.
    private func drawnWindow(_ all: [TimelineItem]) -> (items: [TimelineItem], hidden: Int) {
        if let botChrome {
            let count = BotChatEntry.memo.entries(model.chainRows, started: botChrome.started, compactions: botChrome.compactions).count
            return ([], finding ? 0 : max(0, count - drawnItems))
        }
        guard !finding else { return (all, 0) }
        var limit = drawnItems
        if let unread = model.unreadFrom, let index = all.firstIndex(where: { $0.rows.contains { $0.id == unread } }) {
            limit = max(limit, all.count - index)
        }
        return (Array(all.suffix(limit)), max(0, all.count - limit))
    }

    private func botTimeline(_ botChrome: BotChrome, part: BotChatTimeline.Part) -> some View {
        BotChatTimeline(
            bot: botChrome.bot, rows: model.chainRows, threadId: model.threadId, projectId: model.thread?.projectId,
            running: model.thread?.isRunning == true, thinking: model.shelf.thinking, started: botChrome.started, compactions: botChrome.compactions,
            react: { send(text: $0) }, quote: { quote($0) }, select: { selecting = SelectionText(text: $0) },
            edit: startEditing, editableId: lastUserRowId, openThread: botChrome.openThread,
            sideThreads: botChrome.sideThreads, replyInThread: botChrome.replyInThread, threadRows: Set(model.rows.map(\.id)), cached: model.showsCache,
            part: part)
    }

    /// One view per item, so scrolling to the item lands on the divider.
    private func itemView(_ item: TimelineItem, unread: String?) -> some View {
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
                        sideChat: runningPlugins.split(separator: ",").contains("side-chat") ? openSideChat : nil,
                        edit: row.id == lastUserRowId ? startEditing : nil,
                        saveFiles: canSaveFiles ? { savingFiles = SaveToStudioRequest(threadId: model.threadId, seq: $0) } : nil,
                        readAloud: voice.available == true ? { voice.readAloud(rowId: row.id, text: $0) } : nil,
                        reading: player.isReading(row.id))
                    .environment(\.readAlongPiece, row.id == readAlongRow ? player.piece : nil)
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

    /// Past this, the timeline is past its last row rather than bouncing.
    private static let pastEndSlack: CGFloat = 40
    private static let bottomId = "timeline-bottom"

    private func settlePastEnd() {
        if pastEnd > Self.pastEndSlack { scrollToBottom(animated: false) }
    }

    /// Brings the end back into view while pinned, at most once a beat
    /// however many changes come in (rows measuring, a reply streaming), and
    /// only while nothing scrolls: never under the reader's finger or its
    /// fling (a touch cancels it), nor mid-animation (going idle calls this
    /// again). Runs on a change, never on a timer.
    private func keepPinned() {
        guard pinned, scrollPhase == .idle, settling == nil else { return }
        settling = Task {
            try? await Task.sleep(for: .milliseconds(100))
            guard !Task.isCancelled else { return }
            settling = nil
            // Above the bottom with the chat longer than the screen: rows
            // above measured shorter and left a blank under the end.
            guard pinned, scrollPhase == .idle, end != .bottom || pastEnd > Self.pastEndSlack else { return }
            ScrollLog.cause("keepPinned.snap")
            position.scrollTo(id: Self.bottomId, anchor: .bottom)
        }
    }

    /// Animates only a short way, from near the bottom, and then toward the
    /// edge rather than the marker. An animated scroll to an id in a lazy
    /// stack goes to where the stack estimates it, and re-aims as unmeasured
    /// rows above measure in: after a send in a long chat of uneven rows,
    /// the whole transcript visibly scrolled past. A jump to the marker
    /// (no animation) lays it out at once, and draws the end after a raised
    /// keyboard, where a scroll to the edge alone could land blank.
    private func scrollToBottom(animated: Bool = true) {
        pinned = true
        guard animated, atBottom else {
            ScrollLog.cause(animated ? "toBottom.jump" : "toBottom.pastEnd")
            position.scrollTo(id: Self.bottomId, anchor: .bottom)
            return
        }
        ScrollLog.cause("toBottom.animated")
        withAnimation(.snappy) { position.scrollTo(edge: .bottom) }
        Task {
            try? await Task.sleep(for: .milliseconds(400))
            if !scrollPhase.byReader, pinned || pastEnd > Self.pastEndSlack {
                ScrollLog.cause("toBottom.settle")
                position.scrollTo(id: Self.bottomId, anchor: .bottom)
            }
        }
    }

    /// Links in messages: Studio items and files open in the app, threads in the chat.
    private func openLink(_ url: URL) -> OpenURLAction.Result {
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
                clear: botChrome != nil, dictation: dictation,
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
                        Image(systemName: "stop.fill")
                            .font(.footnote.weight(.bold))
                            .foregroundStyle(.white)
                            .frame(width: 32, height: 32)
                            .background(Color.primary.opacity(0.85), in: .circle)
                            .frame(width: 36, height: 36)
                    }
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
            .modifier(BotComposerGlass(active: botChrome != nil))
        }
        .animation(.smooth(duration: 0.25), value: model.interactions.first?.id)
        .padding(.horizontal, botChrome != nil ? 12 : 16)
        .padding(.vertical, 8)
        .frame(maxWidth: Self.readableWidth)
        .frame(maxWidth: .infinity)
        .background { if botChrome == nil { Rectangle().fill(.bar).ignoresSafeArea() } }
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

/// Where the timeline's end is, against the bottom of what the reader sees.
private enum EndPlace: Equatable {
    /// Out of view, or not drawn.
    case off
    /// At the bottom, give or take 40pt.
    case bottom
    /// In view, with room under it: a chat shorter than the screen, or a
    /// blank where the end should be.
    case above

    init(_ proxy: GeometryProxy) {
        guard let shown = proxy.bounds(of: .scrollView), shown.minY <= 0, proxy.size.height <= shown.maxY + 2 else {
            self = .off
            return
        }
        self = shown.maxY - proxy.size.height <= 40 ? .bottom : .above
    }
}

/// The thread's `openURL`, made once and kept. A new `OpenURLAction` on
/// every redraw read as a new environment value, and every `Text` in the
/// chat (each reads `openURL`, for its links) resolved its styled text again:
/// each streamed chunk restyled every message drawn, not just the one growing.
@MainActor
private final class LinkOpener {
    private var open: (URL) -> OpenURLAction.Result = { _ in .systemAction }
    private lazy var stable = OpenURLAction { [unowned self] url in open(url) }

    /// The same action each time, calling the latest `handle`.
    func action(_ handle: @escaping (URL) -> OpenURLAction.Result) -> OpenURLAction {
        open = handle
        return stable
    }
}

/// What changes the timeline's fit: its content, the composer and keyboard, the screen.
private struct ScrollFit: Equatable {
    var content: CGFloat
    var inset: CGFloat
    var container: CGFloat
}

extension ScrollPhase {
    /// The reader's finger, or the fling it left.
    var byReader: Bool { self == .tracking || self == .interacting || self == .decelerating }
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
