import SwiftUI

struct ThreadView: View {
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }
    /// The open thread: its model, hold-to-talk, and its menu's commands.
    @ObservedObject private var session: ConversationSession
    @ObservedObject private var model: ThreadModel
    @ObservedObject private var talk: HoldToTalk
    /// Send waits while dictation (the mic, a talk, or the keyboard's) has words on the way.
    @StateObject private var dictation = DictationGate()
    /// "Expand to page": the thread's open note and its editor.
    @StateObject private var notes: ThreadNotes
    /// Holds the thread from the view's first appearance until it is gone.
    @StateObject private var lifetime = ThreadViewLifetime()
    /// What was typed before an inline dictation; what you say goes in after it.
    @State private var talkTyped: String?
    @State private var draftText = DraftText()
    private var draft: String {
        get { draftText.value }
        nonmutating set { draftText.value = newValue }
    }
    @State private var mentions: [Mention] = []
    @ObservedObject private var outbox = Outbox.shared
    @ObservedObject private var muted = MutedThreads.shared
    @State private var choosingModel = false
    /// The composer's model button: the thread's model and reasoning level.
    @State private var executionLabel: String?
    /// A handoff to another provider in flight, or a switch just done, over the composer.
    @State private var handoffStatus: (text: String, working: Bool)?
    @State private var attachments: [PendingAttachment] = []
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
    @State private var pickingSendTime = false
    @State private var showingFiles = false
    @State private var showingHistory = false
    @State private var savingFiles: SaveToStudioRequest?
    @State private var confirmingCompact = false
    @State private var confirmingClearContext = false
    @State private var showingContext = false
    @State private var renaming = false
    @State private var openingFile: OpenFile?
    @State private var newTitle = ""
    @State private var reviewingPlan: PlanReview?
    /// Set while the composer holds a rewrite of the last message.
    @State private var editing = false
    @AppStorage(ServerScope.key("runningPlugins")) private var runningPlugins = ""
    @Environment(\.botConversation) private var shell
    @Environment(\.look) private var look
    @Environment(\.shellPosture) private var posture
    @Environment(\.shellPaneAtEdge) private var paneAtEdge
    @Environment(\.shellInnerScreen) private var innerScreen
    @ObservedObject private var router = Router.shared
    /// The Workbench over the rows (between the title and the composer); nil shows the chat.
    private let workbench: (() -> AnyView)?
    /// One column: a sideways swipe on the chat flips to the Workbench.
    private let flips: Bool
    @State private var sideThreads: [String: BotSideThread] = [:]
    /// Forks made here this session, kept on their message until Studio lists them.
    @State private var madeForks: [String: String] = [:]
    @State private var conversationModel: ConversationModel?
    @State private var deleting: ConversationDeletion?
    @State private var workerFetched: WorkerInfo?
    @State private var askingWorker = false
    @State private var workerAskError: String?
    @State private var answeringHere = false
    @StateObject private var approvals = ConversationApprovals()
    /// A Bot conversation's queue and todos, from their composer chips.
    @State private var showingQueue = false
    @State private var showingTodos = false
    @AppStorage(ServerScope.key("dismissedFallbacks")) private var dismissedFallbacks = ""
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

    /// Counts sends, for the send haptic.
    @State private var sends = 0
    /// The new chat transcript's requests, when it's on (Settings ▸ Diagnostics).
    @State private var transcriptV2 = TranscriptHandle()
    @State private var jumpState = TranscriptPillState()
    /// Bumped each time `ThreadView.body` runs (outside `Isolated`), so pure
    /// `model.rowsBox` streaming updates keep the same token and skip
    /// re-assigning `composerHost`/`topHost` rootViews.
    @State private var chromeTick = ChromeTick()

    init(session: ConversationSession, workbench: (() -> AnyView)? = nil, flips: Bool = false) {
        self.session = session
        self.flips = flips
        model = session.model
        talk = session.talk
        self.workbench = workbench
        _notes = StateObject(wrappedValue: ThreadNotes(threadId: session.threadId))
        _pendingPermission = AppStorage(ServerScope.key("permissionMode.\(session.threadId)"), store: AppGroup.defaults)
    }

    var body: some View {
        #if DEBUG
        let _ = RenderCount.bump("thread.body")
        #endif
        withTalk
        .modifier(ThreadFeedback(actions: actions, confirmations: model.confirmations, sends: sends,
                                 interactions: model.interactions.count, error: model.error, attachments: attachments.count,
                                 hasThread: model.thread != nil, describe: describeActivity))
    }

    /// Handoff and Spotlight: the thread's title and web link.
    private func describeActivity(_ activity: NSUserActivity) {
        guard let thread = model.thread else { return }
        activity.title = thread.displayTitle
        activity.webpageURL = client.webURL(forThread: thread).absoluteURL
        activity.targetContentIdentifier = thread.id
    }

    /// Dictation and hold to talk.
    private var withTalk: some View {
        withLoading
        .modifier(TalkLifecycle(talk: talk))
        .modifier(ThreadHooks(
            canUseNotes: canUseNotes, talkError: talk.error, focusRequests: router.focusRequests, command: session.command,
            notesAllowed: { notes.attach(app) },
            appear: {
                ScrollLog.observeKeyboard()
                talk.send = { [model] text in
                    if isWorker { return askWorker(text) }
                    Task { if await !model.send(text, mentions: [], attachments: []) { restoreDraft(text, []) } }
                }
                talk.insert = { [model] text in
                    let next = TalkDraft.finished(text, typed: &talkTyped, draft: draft)
                    draft = next
                    // Saved here too: a dictation finished as the thread closes lands after its view is gone.
                    Drafts.save(model.threadId, text: next, mentions: mentions, serverURL: model.serverURL)
                }
            },
            talkFailed: { app.flash($0) },
            focus: { if router.conversation == model.threadId { composerFocused = true } },
            take: { if let command = session.take() { perform(command) } }))
    }

    // `body` in parts, so each type-checks in well under a second (as one
    // chain it took 30 s, and Xcode 26 gave up on it). The same modifiers,
    // in the same order.

    private var withConversation: some View {
        screen
        .task(id: conversation?.threadId) {
            guard conversation != nil else { return }
            while !Task.isCancelled {
                await loadSideThreads()
                await EnergyGate.shared.pollWait(.seconds(30))
            }
        }
        .task(id: shell == nil ? nil : model.threadId) {
            guard let shell, shell.kind == .worker || shell.threadId != model.threadId else { return }
            while !Task.isCancelled {
                do {
                    let next = try await client.workerInfo(threadId: model.threadId, mainThreadId: shell.mainThreadId)
                    if next != workerFetched { workerFetched = next }
                    if next == nil, !isWorker { return }
                } catch where BBClient.isCancellation(error) {
                    return
                } catch {}
                await EnergyGate.shared.pollWait(.seconds(60))
            }
        }
        .task(id: approvalsKey) {
            guard let source = approvalsSource else { return }
            while !Task.isCancelled {
                await approvals.load(source, client: client)
                // Quick while one waits on a screen in use; idle, it backs off too.
                await EnergyGate.shared.pollWait(approvals.waiting ? .seconds(10) : .seconds(60))
            }
        }
        .task(id: "\(conversation?.threadId ?? "") \(choosingModel)") {
            guard conversation != nil, !choosingModel else { return }
            if let next = try? await client.conversationModel(threadId: model.threadId), next != conversationModel { conversationModel = next }
        }
    }

    /// The screen and its sheets, type-erased: `body`'s chain of modifiers
    /// stays about half as deep as one type (see `screen`).
    private var withSheets: AnyView {
        AnyView(withSheetsContent)
    }

    private var withSheetsContent: some View {
        withConversation
        .sheet(isPresented: $showingWeb) {
            if let thread = model.thread {
                NavigationStack {
                    WebView(url: client.webURL(forThread: thread))
                        .ignoresSafeArea(edges: .bottom)
                        .toolbar { Button("Done") { showingWeb = false } }
                }
            }
        }
        .sheet(isPresented: $showingQueue) {
            NavigationStack {
                ScrollView {
                    ThreadShelf(model: model, shelf: ThreadModel.Shelf(), queued: model.queued, showsBackground: false, expandsQueue: true)
                        .padding()
                }
                .navigationTitle("Queued")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { Button("Done") { showingQueue = false } }
            }
            .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $showingTodos) {
            NavigationStack {
                ScrollView { TodoCard(items: model.shelf.todos, expandedAtStart: true).padding() }
                    .navigationTitle("Todos")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar { Button("Done") { showingTodos = false } }
            }
            .presentationDetents([.medium, .large])
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
        .deleteConversationSheet($deleting) { _, plan in delete(plan) }
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
            guard !choosingModel else { return }
            async let executionTask = try? app.client.execution(model.threadId)
            async let optionsTask = try? app.client.executionOptions(providerId: model.thread?.providerId, cachedFor: .seconds(300))
            guard let execution = await executionTask else { return }
            let options = await optionsTask
            let name = execution.model.map { id in options?.models.first { $0.id == id || $0.model == id }?.displayName ?? id }
            executionLabel = [name, execution.reasoningLevel].compactMap { $0 }.joined(separator: " · ")
        }
        .fullScreenCover(item: $notes.editing) { note in
            PageEditor(pageId: note.pageId ?? "", note: NoteDoneActions(note: note, notes: notes)) { await notes.refresh() }
        }
        .sheet(isPresented: $editingFull) {
            FullComposer(text: $draftText.value, canSend: canSend, send: {
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
            if canUseNotes { notes.attach(app) }
            #if DEBUG
            if TalkIndicator.qaDictating {
                talk.qaPretend(.dictating)
                // Set every time: a draft is saved, and would hide the placeholder in the next fixture.
                draft = "All right, so the test notification worked"
            }
            #endif
            Task { await muted.refresh() }
            Task { reactionSettings = (try? await client.reactionSettings()) ?? .defaults }
            if runningPlugins.split(separator: ",").contains("studio") {
                Task { session.sourcePage = try? await client.chatPage(model.threadId) }
            }
            session.attach(app)
            await model.load()
        }
        // Held for the view's life, not while it shows: a conversation under
        // another tab (or a screen pushed over it) keeps listening, so what
        // arrives meanwhile is there on return. Taken as it first appears: a
        // screen that replaces another in the same update takes over before
        // the deferred detach looks (no async start racing it).
        .onAppear { lifetime.hold(session, notes: notes, app: app) }
        // Open where the reader left off. Waits a beat for the rows to be laid out.
        .task(id: model.unreadFrom) {
            guard model.unreadFrom != nil else { return }
            try? await Task.sleep(for: .milliseconds(150))
            if let item = unreadItem() { read(item, anchor: .top) }
        }
        .onDisappear {
            saveDraftLocally()
            resizeRestore?.cancel()
            resizeAnchor.cancel()
        }
    }

    /// The timeline, find bar, composer, and toolbar; `body` adds sheets and tasks.
    ///
    /// Type-erased, with its header parts (`transcriptV2Screen`): as one
    /// nested generic type, Swift's runtime resolved its metadata recursively
    /// on the first frame and overflowed the device's 1 MB main-thread stack
    /// (TestFlight 20261126.0313 crashed on every launch). Simulator builds
    /// link with that 1 MB stack too (project.yml), so the UI tests catch it.
    private var screen: AnyView {
        AnyView(transcriptV2Screen)
    }

    /// Hands-free voice speaks as this conversation (its identity comes from the thread).
    private func startHandsFree() { Router.shared.sheet = .handsFree(threadId: model.threadId) }

    /// What the conversation's menu asked for (`ConversationMenuItems`, in the conversation's bar).
    private func perform(_ command: ConversationCommand) {
        switch command {
        case .find: finding = true
        case .rename:
            newTitle = model.thread?.title ?? model.thread?.displayTitle ?? ""
            renaming = true
        case .model: choosingModel = true
        case .files: showingFiles = true
        case .terminals:
            if let scope = TerminalScope.forThread(model.threadId, environmentId: model.thread?.environmentId) {
                push(.terminals(scope: scope, title: "Terminals"))
            }
        case .history: showingHistory = true
        case .saveFiles: savingFiles = SaveToStudioRequest(threadId: model.threadId, seq: nil)
        case .sourcePage: if let page = session.sourcePage { push(.page(id: page.id)) }
        case .makeMain: if let conversation { makeMain(conversation) }
        case .archive: finish()
        case .delete: deleting = ConversationDeletion(threadId: model.threadId, title: conversation?.conversation?.title ?? model.thread?.displayTitle ?? "")
        case .fork: Task { if let id = await model.fork() { open(.thread(id: id)) } }
        case .contextUsage: showingContext = true
        case .compact: confirmingCompact = true
        case .clearContext: confirmingClearContext = true
        case .toggleMute:
            let isMuted = muted.ids.contains(model.threadId)
            Task {
                do { try await muted.set(model.threadId, muted: !isMuted) } catch {
                    model.error = BBClient.describe(error, server: client.baseURL)
                }
            }
        case .openWeb: showingWeb = true
        case .copyId: UIPasteboard.general.string = model.threadId
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
        let stop: (() -> Void)? = model.thread?.isRunning == true && !isWorker ? { Task { await model.stop() } } : nil
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
    private func loadOlder() async -> OlderPage {
        let first = model.shownItems.first?.id
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
                    // A reader's scroll that ended here, without the phase
                    // reaching idle, still decides following from where it
                    // rested; otherwise a fling up from the end kept
                    // "following" and keepAtEnd took the reader back down.
                    if end.readerScrolling {
                        end.following = end.geometry.nearEnd
                        end.readerScrolling = false
                    }
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
        return model.shownItems.reversed().compactMap { item in
            guard case .message(let row) = item, row.text?.localizedStandardContains(query) == true else { return nil }
            return row.id
        }
    }

    /// The item holding the first unread row.
    private func unreadItem(in items: [TimelineItem]? = nil) -> String? {
        guard let id = model.unreadFrom else { return nil }
        return (items ?? model.shownItems).first { $0.rows.contains { $0.id == id } }?.id
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

    private func saveDraftLocally() {
        Drafts.save(model.threadId, text: draft, mentions: mentions, serverURL: model.serverURL)
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

    private var conversation: BotConversationContext? {
        guard let shell, shell.kind == .conversation, shell.threadId == model.threadId else { return nil }
        return shell
    }

    private var isWorker: Bool { shell?.isWorker(model.threadId) == true || workerFetched != nil }

    private var worker: WorkerInfo? {
        guard let shell, isWorker else { return nil }
        var info = WorkerInfo.merged(seed: shell.worker(model.threadId), fetched: workerFetched)
            ?? WorkerInfo(threadId: model.threadId, title: "", status: .other("unknown"), botName: shell.botName,
                          owner: shell.mainThreadId.map { WorkerInfo.Owner(threadId: $0, title: "Main") })
        if info.title.isEmpty, let thread = model.thread { info.title = ThreadTitles.resolve(thread.displayTitle) }
        return info
    }

    private var approvalsSource: String? {
        if conversation != nil { return model.threadId }
        guard let worker, worker.status == .needsYou else { return nil }
        return worker.owner?.threadId
    }

    private var approvalsKey: String {
        let needs = conversation?.conversation?.needsYou.map { "\($0.reason)\($0.at)" } ?? ""
        return "\(approvalsSource ?? "") \(needs) \(conversation?.workers.workers.filter { $0.status == .needsYou }.count ?? 0)"
    }

    private func pendingApprovalTitle(_ worker: WorkerInfo) -> String? {
        if let card = approvals.cards.first(where: { $0.approval.worker.threadId == worker.threadId && $0.approval.state.waiting }) {
            return card.approval.title
        }
        return worker.status == .needsYou && worker.waitingOn == .approval ? worker.stateLabel : nil
    }

    private func decideApproval(_ id: String, _ decision: WorkerApproval.Decision) {
        Task {
            if await approvals.decide(id, decision, client: client) != nil { shell?.refresh() }
        }
    }

    private var shownInteractions: [PendingInteraction] {
        WorkerInfo.shownInteractions(model.interactions, worker: worker, answering: answeringHere)
    }

    private func askWorker(_ spoken: String? = nil) {
        guard let shell, !askingWorker, spoken != nil || !dictation.blocksSend else { return }
        let text = (spoken ?? draft).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        let threadId = model.threadId
        askingWorker = true
        workerAskError = nil
        sends += 1
        Task {
            do {
                let asked = try await client.askAboutWorker(threadId: threadId, text: text)
                askingWorker = false
                if spoken == nil { draft = "" }
                shell.refresh()
                shell.openConversation(asked.conversationId)
            } catch {
                askingWorker = false
                if let spoken, draft.isEmpty { draft = spoken }
                workerAskError = BBClient.describe(error, plugin: "Studio", server: client.baseURL)
            }
        }
    }

    private func workerComposer(_ worker: WorkerInfo, shell: BotConversationContext) -> some View {
        VStack(spacing: 8) {
            if let owner = worker.owner, let title = pendingApprovalTitle(worker) {
                WorkerPendingApproval(title: title, owner: owner.title) { shell.openConversation(owner.threadId) }
            }
            WorkerAskLine(info: worker, look: shell.look,
                          openOwner: { if let id = worker.owner?.threadId { shell.openConversation(id) } },
                          answerHere: worker.canAnswerHere && !answeringHere ? { answeringHere = true } : nil)
            if let workerAskError {
                Text(workerAskError)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("workerAskError")
            }
            TalkIndicator(talk: talk)
            ComposerBar(
                text: $draftText.value, focused: $composerFocused, attachments: $attachments,
                placeholder: TalkIndicator.placeholder(talk) ?? WorkerInfo.askPlaceholder,
                dictate: { talk.startDictation() }, talk: talk, clear: true, dictation: dictation,
                compact: true, prominentMic: true, micTint: look.micTint, attaches: false
            ) {
                EmptyView()
            } send: {
                Button { askWorker() } label: {
                    Group {
                        if askingWorker { ProgressView() } else { Image(systemName: "arrow.up.circle.fill").font(.title) }
                    }
                    .frame(width: ComposerRow.button, height: ComposerRow.button).contentShape(.rect)
                }
                .disabled(!WorkerInfo.canAsk(draft, busy: askingWorker) || dictation.blocksSend)
                .keyboardShortcut(.return, modifiers: .command)
                .accessibilityLabel(worker.askTarget)
                .accessibilityIdentifier("workerAskSend")
            }
            .modifier(BotComposerGlass(active: true))
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("workerAsk")
            .modifier(InlineJump(state: jumpState) { transcriptV2.jumpToLatest() })
        }
        .modifier(TalkDraft(talk: talk, draft: $draftText.value, typed: $talkTyped))
        .onChange(of: draft) { _, _ in draftText.saveSoon(saveDraftLocally) }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(maxWidth: readableWidth)
        .frame(maxWidth: .infinity)
    }

    private var compactInput: Bool {
        guard let shell, shell.threadId == model.threadId else { return false }
        return shell.kind != .worker
    }

    private var placeholder: String {
        if shell?.kind == .reply, shell?.threadId == model.threadId { return "Reply…" }
        return "Message"
    }

    private func open(_ route: Route) {
        if let shell { shell.push(route) } else { app.push(route) }
    }

    private func followLink(_ url: URL) -> OpenURLAction.Result {
        guard let target = Links.parse(url.absoluteString, origin: client.baseURL) else { return .systemAction }
        switch target {
        case .external:
            return .systemAction
        case .entity(let ref) where (ref.kind == .file || ref.kind == .diff) && ref.id != nil:
            openingFile = OpenFile(path: ref.id ?? "")
        default:
            app.openLink(target, threadId: model.threadId) { open($0) }
        }
        return .handled
    }

    private func push(_ route: Route) {
        if let shell { shell.push(route) } else { app.push(route) }
    }

    private func replyInThread(_ row: TimelineRow) {
        if let id = ConversationReplies.existing(sideThreads, messageId: row.id) { return showReply(id) }
        let threadId = model.threadId
        Task {
            do {
                let opened = try await client.threadReply(threadId: threadId, messageId: row.id, sourceSeqEnd: row.sourceSeqEnd)
                showReply(opened.threadId)
                await loadSideThreads()
                if opened.created { shell?.refresh() }
            } catch {
                model.error = BBClient.describe(error, plugin: "Studio", server: client.baseURL)
            }
        }
    }

    /// A side thread (a reply thread or a fork) opens over the conversation.
    private func showThread(_ id: String) {
        push(.thread(id: id))
    }

    /// A reply thread: its composer says Reply….
    private func showReply(_ id: String) {
        Router.shared.replyThreads.insert(id)
        showThread(id)
    }

    private func forkConversation(_ row: TimelineRow) {
        guard let seq = row.sourceSeqEnd else { return }
        let threadId = model.threadId
        Task {
            do {
                let id = try await client.forkConversation(threadId: threadId, messageId: row.id, sourceSeqEnd: seq)
                // The fork stays reachable from its message after its sheet closes.
                madeForks[row.id] = id
                sideThreads = BotSideThread.adding(fork: id, at: row.id, to: sideThreads)
                showThread(id)
                shell?.refresh()
            } catch {
                model.error = BBClient.describe(error, plugin: "Studio", server: client.baseURL)
            }
        }
    }

    private func loadSideThreads() async {
        guard conversation != nil, var next = try? await client.botSideThreads(threadId: model.threadId) else { return }
        for (messageId, threadId) in madeForks where next[messageId]?.fork == nil {
            next = BotSideThread.adding(fork: threadId, at: messageId, to: next)
        }
        guard next != sideThreads else { return }
        sideThreads = next
    }

    private func finish() {
        session.finishing = true
        let threadId = model.threadId
        Task {
            do {
                try await client.finishConversation(threadId: threadId)
                shell?.refresh()
                shell?.showList()
            } catch {
                model.error = BBClient.describe(error, plugin: "Studio", server: client.baseURL)
            }
            session.finishing = false
        }
    }

    private func delete(_ plan: ConversationDeletePlan) {
        session.finishing = true
        let threadId = model.threadId
        Task {
            do {
                try await client.deleteConversation(threadId, plan: plan)
                shell?.refresh()
                shell?.showList()
            } catch {
                model.error = BBClient.describe(error, server: client.baseURL)
            }
            session.finishing = false
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
    /// thread: a conversation opens the new one; elsewhere it replaces this thread.
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
                if conversation != nil, let shell {
                    shell.openConversation(next)
                    shell.refresh()
                } else {
                    open(.thread(id: next))
                }
            } catch {
                handoffStatus = nil
                model.error = BBClient.describe(error, server: app.client.baseURL)
            }
        }
    }

    @ViewBuilder private var composer: some View {
        if let worker, let shell {
            workerComposer(worker, shell: shell)
        } else {
            threadComposer
        }
    }

    /// The thread Hand off continued in: a conversation of the Bot pages to it, any other thread opens over this one.
    private func openRouterThread(_ threadId: String) {
        guard let conversation else { return }
        conversation.refresh()
        conversation.openConversation(threadId)
    }

    /// Make this the Main (`bot_make_main`): the old Main stays an ordinary conversation.
    private func makeMain(_ conversation: BotConversationContext) {
        let client = app.client
        Task {
            do {
                try await client.makeMain(botId: conversation.botId, threadId: model.threadId)
                conversation.refresh()
                app.flash("This is \(conversation.botName)'s Main now")
            } catch {
                app.flash("It didn't become the Main: " + BBClient.describe(error, server: client.baseURL))
            }
        }
    }


    // MARK: Above a Bot conversation's composer

    /// The one thing above a Bot conversation's composer: the model router's
    /// offer to hand off, else a plan to review. Approvals are in the
    /// transcript; states that last are chips, and the running time and the
    /// queue are the composer's own status line.
    @ViewBuilder private var conversationSlot: some View {
        if RouterNotices.shared.notices[model.threadId]?.text.map({ !$0.isEmpty }) ?? false {
            RouterNoticeBanner(threadId: model.threadId, openThread: openRouterThread)
        } else if let review = model.planReview, !editing {
            ShelfCard(icon: "doc.text.magnifyingglass", tint: look.accent) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Plan ready for review").fontWeight(.medium)
                    if let title = review.title, !title.isEmpty {
                        Text(title).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
            } trailing: {
                Button("Review") { reviewingPlan = review }
                    .font(.footnote.weight(.semibold))
                    .frame(minWidth: 44, minHeight: 44)
            }
        }
    }

    /// The composer's status line: working and for how long, background work, and the queue.
    private var composerStatus: ComposerStatus? {
        ComposerStatus(running: model.thread?.isRunning == true && !isWorker,
                       since: model.rows.last { $0.isConversation && $0.isUser }?.createdAt,
                       queued: model.queued.count, background: model.shelf.background)
    }

    /// A Bot conversation's lasting states, as chips in the composer's top row.
    private var composerChips: [ComposerChip] {
        guard let conversation else { return [] }
        return ComposerChip.chips(
            pause: conversation.botPause, planning: model.shelf.isPlanning, goal: model.shelf.goal?.objective,
            todos: model.shelf.todos,
            note: notes.note != nil && !editing, editing: editing, permission: editing ? nil : pendingPermission,
            handingOff: handoffStatus?.working == true)
    }

    private func tapChip(_ kind: ComposerChip.Kind) {
        switch kind {
        case .paused:
            guard let conversation else { return }
            Task {
                do {
                    try await app.client.setBotSpaceState(.resume, botId: conversation.botId)
                    conversation.refresh()
                } catch {
                    app.flash("It didn't resume: " + BBClient.describe(error, server: app.client.baseURL))
                }
            }
        case .planMode: Task { await model.perform { try await $0.exitPlanMode($1) } }
        case .goal: Task { await model.perform { try await $0.clearGoal($1) } }
        case .todos: showingTodos = true
        case .notes: if let note = notes.note { notes.editing = note }
        case .permission: choosingModel = true
        case .editing, .handingOff: break
        }
    }

    private func closeChip(_ kind: ComposerChip.Kind) {
        switch kind {
        case .editing:
            editing = false
            draft = ""
        case .permission: PermissionMode.setPending(nil, for: model.threadId)
        default: break
        }
    }

    /// Things that happened once, as lines at the end of a Bot conversation.
    private var transcriptNotices: [TranscriptNotice] {
        TranscriptNotice.lines(fallback: model.shelf.fallback, dismissedFallbacks: dismissedFallbacks,
                               handoffDone: handoffStatus.flatMap { $0.working ? nil : $0.text },
                               storageError: outbox.storageError, turnFailed: model.thread?.status == "error" && !editing)
    }

    private func act(_ action: TranscriptNotice.Action) {
        switch action {
        case .dismissFallback(let seq): dismissedFallbacks += ",\(seq)"
        case .retryTurn: Task { await model.run { try await $0.retry(model.threadId) } }
        case .retryStorage:
            let error = outbox.storageError
            outbox.retryStorage()
            if outbox.storageError == nil, model.error == error { model.error = nil }
        case .dismissHandoff: handoffStatus = nil
        }
    }

    private var threadComposer: some View {
        VStack(spacing: 8) {
            if conversation != nil {
                conversationSlot
            } else {
                ThreadShelf(model: model, shelf: model.shelf, queued: model.queued, showsBackground: true)
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
                    ShelfCard(icon: status.working ? "arrow.triangle.2.circlepath" : "checkmark.circle", tint: status.working ? .secondary : .green) {
                        HStack(spacing: 6) {
                            if status.working { RunningGlyph().accessibilityHidden(true) }
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
                    ShelfCard(icon: "lock.shield", tint: pendingPermission == "full" ? .red : .accentColor) {
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
                    ShelfCard(icon: "doc.text.magnifyingglass", tint: look.needsYou) {
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
            }
            TalkIndicator(talk: talk)
            if composerFocused, let query = MentionSuggestions.query(in: draft) {
                MentionSuggestions(query: query, threadId: model.threadId, projectId: model.thread?.projectId, pick: insert)
            } else if composerFocused, let query = CommandSuggestions.query(in: draft),
                let projectId = model.thread?.projectId, let providerId = model.thread?.providerId {
                CommandSuggestions(query: query, projectId: projectId, providerId: providerId,
                    environmentId: model.thread?.environmentId, pick: insertCommand)
            }
            ComposerBar(
                text: $draftText.value, focused: $composerFocused, attachments: $attachments,
                placeholder: TalkIndicator.placeholder(talk) ?? placeholder,
                dictate: { talk.startDictation() }, talk: talk, expand: draftIsLong ? { editingFull = true } : nil,
                clear: true, dictation: dictation,
                toPage: canUseNotes && !editing && !compactInput ? ComposerPageAction(
                    label: ThreadNotes.expandLabel(hasNote: notes.note != nil, draftEmpty: draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty),
                    busy: notes.expanding, disabled: dictation.blocksSend, run: expandToPage) : nil,
                compact: true, prominentMic: compactInput, micTint: compactInput ? look.micTint : nil,
                stop: conversation != nil && model.thread?.isRunning == true && !isWorker ? { Task { await model.stop() } } : nil,
                handsFree: conversation != nil ? { startHandsFree() } : nil,
                top: composerTop
            ) {
                if !compactInput {
                    Button { choosingModel = true } label: { ComposerSettingsLabel(title: executionLabel) }
                        .disabled(handoffStatus?.working == true)
                        .accessibilityLabel("Model & permissions")
                }
            } send: {
                Button(action: send) {
                    Group {
                        if model.sending {
                            ProgressView()
                        } else {
                            Image(systemName: model.thread?.isRunning == true ? "text.append" : "arrow.up.circle.fill")
                                .font(model.thread?.isRunning == true ? .body.weight(.semibold) : .title)
                        }
                    }
                    .frame(width: ComposerRow.button, height: ComposerRow.button).contentShape(.rect)
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
            .modifier(BotComposerGlass(active: true))
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("threadComposer")
            .modifier(InlineJump(state: jumpState) { transcriptV2.jumpToLatest() })
        }
        .animation(.smooth(duration: 0.25), value: model.interactions.first?.id)
        // Kept with the draft text, for when the thread opens again.
        .onChange(of: attachments.map(\.id)) { _, _ in
            DraftAttachments.save(attachments, threadId: model.threadId, serverURL: model.serverURL)
        }
        .modifier(TalkDraft(talk: talk, draft: $draftText.value, typed: $talkTyped))
        .onChange(of: draft) { _, text in
            if mentions.contains(where: { !text.contains($0.token) }) { mentions.removeAll { !text.contains($0.token) } }
            draftText.saveSoon(saveDraftLocally)
        }
        // Floats over the transcript, as in the Bot chat: no bar behind it.
        // Beside two pages it has the transcript's margins.
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(maxWidth: readableWidth)
        .frame(maxWidth: .infinity)
        // A `bbstudio://reply/<id>` link lands here.
        .onReceive(Router.shared.$replyThreadId) { id in
            guard id == model.threadId else { return }
            composerFocused = true
            Router.shared.replyThreadId = nil
        }
        .task(id: conversation != nil ? model.threadId : "") {
            // The model router's usage-limit notice (`RouterNoticeBanner`).
            guard conversation != nil else { return }
            await RouterNotices.shared.poll(model.threadId)
        }
        .task(id: conversation != nil ? model.threadId : "") {
            guard conversation != nil else { return }
            await StrandTagStore.shared.poll(model.threadId)
        }
    }

    /// The composer's top: its status line (working, the queue), then the chips of a Bot conversation.
    private var composerTop: AnyView? {
        let status = conversation != nil ? composerStatus : nil
        let chips = conversation != nil ? composerChips : []
        guard status?.shown == true || !chips.isEmpty else { return nil }
        return AnyView(VStack(alignment: .leading, spacing: 0) {
            if let status, status.shown { ComposerStatusLine(status: status) { showingQueue = true } }
            if !chips.isEmpty {
                ComposerChipsRow(chips: chips, goal: model.shelf.goal?.objective, tap: tapChip, close: closeChip)
            }
        })
    }

    /// A swipe this far (or flung this far) flips Chat and Workbench.
    static let flipDistance: CGFloat = 60

    /// Lines past this get hard to follow on an iPad or a wide window.
    private static let readableWidth: CGFloat = 760
    /// The vertical Duo's measure (9f): its larger type keeps lines near 560 pt of text.
    private var readableWidth: CGFloat { posture.largeType ? 600 : Self.readableWidth }
    /// The transcript's side margins: the Bot chat's bubbles sit closer to the edges.
    private static let margin: CGFloat = 16
}

/// The composer's text, observed only by the views that read it.
@Observable @MainActor final class DraftText {
    var value = ""
    @ObservationIgnored private var saving: Task<Void, Never>?

    func saveSoon(_ save: @escaping @MainActor () -> Void) {
        saving?.cancel()
        saving = Task {
            do { try await Task.sleep(for: .milliseconds(500)) } catch { return }
            save()
        }
    }
}

/// Builds `content` in a body of its own, so the observable values it reads
/// (`DraftText`) redraw only it, not the view that made it. `@State` read in
/// it still redraws the view that owns the state.
struct Isolated<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View { content() }
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
            // Still, not a spinner: a turn can run for many minutes.
            RunningGlyph().accessibilityHidden(true)
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

/// A thread's hooks: Notes once allowed, talk's wiring, its failures, focus
/// requests and the menu's commands. One level of the view's type.
private struct ThreadHooks: ViewModifier {
    let canUseNotes: Bool
    let talkError: String?
    let focusRequests: Int
    let command: ConversationCommand?
    let notesAllowed: @MainActor () -> Void
    let appear: @MainActor () -> Void
    let talkFailed: @MainActor (String) -> Void
    let focus: @MainActor () -> Void
    let take: @MainActor () -> Void

    func body(content: Content) -> some View {
        content
            .onChange(of: canUseNotes) { _, can in if can { notesAllowed() } }
            .onAppear(perform: appear)
            .onChange(of: talkError) { _, error in if let error { talkFailed(error) } }
            .onChange(of: focusRequests) { _, _ in focus() }
            .onChange(of: command) { _, _ in take() }
    }
}

/// A thread's haptics, its keyboard commands and its Handoff activity: one
/// modifier, one level of the view's type rather than seven (the Release
/// main-thread stack, `LaunchStackUITests`).
private struct ThreadFeedback: ViewModifier {
    let actions: ThreadActions
    let confirmations: Int
    let sends: Int
    let interactions: Int
    let error: String?
    let attachments: Int
    let hasThread: Bool
    let describe: (NSUserActivity) -> Void

    func body(content: Content) -> some View {
        content
            .focusedSceneValue(\.thread, actions)
            .sensoryFeedback(.success, trigger: confirmations)
            .sensoryFeedback(.impact(weight: .medium), trigger: sends)
            .sensoryFeedback(.warning, trigger: interactions, condition: Self.grew)
            .sensoryFeedback(.error, trigger: error) { (_: String?, new: String?) in new != nil }
            .sensoryFeedback(.selection, trigger: attachments, condition: Self.grew)
            .userActivity(Spotlight.threadActivityType, isActive: hasThread, describe)
    }

    /// For the haptics on a count: it went up.
    private static func grew(_ old: Int, _ new: Int) -> Bool { new > old }
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
    @Environment(\.look) private var look
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

// MARK: - The chat transcript (UIKit, `iOS/Transcript`)

/// The same thread on the UIKit transcript: the rows, composer, header and
/// find bar go into one `TranscriptContainer`, which owns scrolling, the
/// keyboard and the insets. Everything else (sheets, tasks, the model) is
/// `body`'s, shared with the SwiftUI transcript.
extension ThreadView {
    fileprivate var transcriptV2Screen: some View {
        AnyView(transcriptV2Body)
            .modifier(TranscriptV2Hooks(view: self, sends: sends, outboxCount: outbox.messages.count, finding: finding,
                                        findQuery: findQuery))
            .environment(\.threadId, model.threadId)
            .environment(\.openURL, transcriptV2OpenURL)
    }

    private var transcriptV2Body: some View {
        let chrome = transcriptV2Chrome
        let actions = transcriptV2Actions
        let hasTop = transcriptV2HasTop
        let pillNote = transcriptV2PillNote
        let chromeToken = chromeTick.next()
        return Isolated {
            let _ = model.rowsBox.version
            let activeMatch = finding ? currentMatch : nil
            let effectiveTopVersion: AnyHashable = finding
                ? AnyHashable(FindTopToken(tick: chromeToken, matchCount: findMatches.count))
                : AnyHashable(chromeToken)
            TranscriptContainer(
                items: transcriptV2Rows, chrome: chrome, handle: transcriptV2,
                row: { row in ThreadTranscriptRowView(row: row, actions: actions) },
                composer: { Isolated { composer } },
                top: hasTop ? { transcriptV2Top } : nil,
                pill: { state, jump in transcriptV2Pill(state, jump: jump) },
                onNearTop: { transcriptV2LoadOlder() },
                onPage: composerFocused || !flips ? nil : { [session] _, predicted in
                    guard let predicted, predicted < -ThreadView.flipDistance else { return }
                    withAnimation(.snappy(duration: 0.25)) { session.showsWorkbench = true }
                },
                cover: workbench,
                onPillChange: { state in
                    let next = TranscriptPillState(shown: state.shown, unseen: min(state.unseen, 1), note: state.note)
                    Task { @MainActor in if jumpState != next { jumpState = next } }
                },
                log: ScrollLog.on ? { ScrollLog.request($0) } : nil,
                // Not while the window resizes, which reloads the keyboard mid-transition (crash 3).
                dismissKeyboard: { window in
                    ResizeSettling.shared.afterSettling { [weak window] in
                        Breadcrumbs.shared.focus("transcript-tap", "end-editing")
                        window?.endEditing(true)
                    }
                },
                pillNote: pillNote,
                describeID: { ($0.base as? String).map(ScrollLog.id) ?? "?" },
                spotKey: model.threadId,
                composerVersion: chromeToken,
                topVersion: effectiveTopVersion)
            .onChange(of: activeMatch) { _, id in
                if let id { transcriptV2.scrollTo(id, position: .center, animated: true) }
            }
        }
        // Under the header and to the edges; it ends at the keyboard's top.
        .ignoresSafeArea(.container)
        .overlay {
            // Nothing cached yet: the shape of a chat, not a blank screen.
            if !model.loaded { ChatSkeleton().allowsHitTesting(false) }
        }
    }

    /// As the SwiftUI transcript's: Studio paths and in-app thread links open here.
    private var transcriptV2OpenURL: OpenURLAction {
        OpenURLAction { url in
            if let path = FilePathLink.path(from: url) ?? (url.host() == client.baseURL.host() ? url.path() : nil),
                let route = Route(href: path)
            {
                open(route)
                return .handled
            }
            if let path = FilePathLink.path(from: url) {
                openingFile = OpenFile(path: path)
                return .handled
            }
            if AppLink.handles(url), url.host() == "thread", let id = url.pathComponents.dropFirst().first {
                open(.thread(id: id))
                return .handled
            }
            return followLink(url)
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

        func body(content: Content) -> some View {
            content
                .onChange(of: sends) { _, _ in view.transcriptV2.jumpToLatest() }
                .onChange(of: outboxCount) { old, new in if new > old { view.transcriptV2.jumpToLatest() } }
                .onChange(of: finding) { _, finding in if finding { Task { await view.model.loadAll() } } }
                .onChange(of: findQuery) { _, _ in view.findIndex = 0 }
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
                    let target = ids.first { $0 == "a150" } ?? ids.dropFirst(ids.count / 4).first
                    if let target { view.transcriptV2.scrollTo(target, position: .top) }
                }
                #endif
        }
    }

    fileprivate var transcriptV2Rows: [ThreadTranscriptRow] {
        guard model.loaded else { return [] }
        let pending = outbox.messages(for: model.threadId)
        let items = conversation != nil ? ConversationText.clean(model.shownItems) : model.shownItems
        let rows = ThreadTranscriptRow.thread(items: items, hasOlder: model.hasOlder, unread: unreadItem(in: items), match: currentMatch,
            editableId: worker == nil ? lastUserRowId : nil, pending: pending, interactions: shownInteractions,
            working: showsWorking, thinking: model.shelf.thinking, sideThreads: conversation != nil ? sideThreads : [:])
        guard conversation != nil else { return rows }
        // A Bot conversation: its strand tags in the footers, its workers' approvals and its notices at the end.
        return ThreadTranscriptRow.strandTags(ConversationText.rows(rows), tags: StrandTagStore.shared.tags[model.threadId])
            + approvals.cards.map(ThreadTranscriptRow.approval)
            + transcriptNotices.map(ThreadTranscriptRow.notice)
    }

    fileprivate var transcriptV2Actions: ThreadTranscriptActions {
        let inConversation = conversation != nil
        let threadId = model.threadId
        return ThreadTranscriptActions(
            projectId: model.thread?.projectId, reactionItems: reactionSettings.items, cached: model.showsCache,
            draftReply: { draftReply($0) }, sendReply: { send(text: $0) }, quote: { quote($0) },
            select: { selecting = SelectionText(text: $0) }, edit: startEditing,
            saveFiles: canSaveFiles ? { savingFiles = SaveToStudioRequest(threadId: model.threadId, seq: $0) } : nil,
            openThread: { id in shell?.push(.thread(id: id)) }, replyInThread: { _ in },
            messageThread: inConversation ? { replyInThread($0) } : nil,
            forkConversation: inConversation ? { forkConversation($0) } : nil,
            openSideThread: inConversation ? { showThread($0) } : nil,
            replier: conversation?.look,
            resolve: { await model.resolve($0, $1) }, cancel: { await model.cancel($0) }, openWeb: { showingWeb = true },
            notice: { act($0) },
            decide: { decideApproval($0, $1) },
            threadTitle: { [conversation] id in
                guard let conversation else { return nil }
                if id == conversation.mainThreadId { return "Main" }
                if id == conversation.threadId { return conversation.conversation?.title }
                return conversation.allWorkers.first { $0.threadId == id }?.title
            })
    }

    fileprivate var transcriptV2Chrome: TranscriptChrome {
        var chrome = TranscriptChrome()
        // The composer's own 8 pt padding is the gap above the keyboard or the edge.
        chrome.composerGap = 0
        // The Duo's inner screen draws no home indicator (its 34-point inset is reported anyway).
        chrome.composerIgnoresBottomSafeArea = innerScreen && UIDevice.current.userInterfaceIdiom == .phone
        // Over a home indicator alone (the folded Duo, a phone's thread),
        // the card rests on its inset: its own 8 pt padding goes inside it.
        chrome.composerRestDrop = 8
        chrome.restingBackdrop = look.showsScene ? UIColor(look.canvas) : .systemBackground
        chrome.stackBand = look.showsScene ? UIColor(look.canvas) : .systemBackground
        chrome.rows.margin = Self.margin
        chrome.rows.spacing = 10
        chrome.rows.readableWidth = readableWidth
        if posture.splitsWorkbench, !paneAtEdge {
            // A pane left of another: its stack still hands the transcript the
            // window's trailing inset (the status column, a screen away).
            chrome.composerIgnoresTrailingSafeArea = true
            chrome.rowsTrailingClear = 0
        }
        chrome.pill = .inline
        chrome.nearEnd = 120
        return chrome
    }

    fileprivate var transcriptV2HasTop: Bool { finding }

    /// Monotonic token bumped only when `ThreadView.body` runs, never on pure `rowsBox` ticks.
    fileprivate final class ChromeTick {
        private var value = 0
        func next() -> Int {
            value &+= 1
            return value
        }
    }

    fileprivate struct FindTopToken: Hashable {
        var tick: Int
        var matchCount: Int
    }

    /// The find bar, over the top of the rows.
    fileprivate var transcriptV2Top: some View {
        FindBar(query: $findQuery, index: $findIndex, count: findMatches.count, loading: model.loadingAll) {
            finding = false
            findQuery = ""
        }
    }

    /// A question or approval waiting doesn't take the reader to the end;
    /// the pill says so instead (with push and the badge as before).
    fileprivate var transcriptV2PillNote: String? {
        // A Bot conversation's questions are ordinary messages: no orange jump.
        guard conversation == nil else { return nil }
        let waiting = shownInteractions
        guard let first = waiting.first else { return nil }
        if waiting.count > 1 { return "\(waiting.count) waiting" }
        return first.payload.kind == "approval" ? "Approval" : "Question"
    }

    /// The jump button: in the corner on a phone; beside two pages centred
    /// in its band, on its own glass (no scrim over the rows).
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
        .buttonStyle(.glass(state.note != nil ? .regular.tint(look.needsYou) : .regular))
        .background(look.stackFill, in: .capsule)
        .clipShape(.capsule)
        .padding(12)
        .accessibilityLabel(label.map { "Jump to latest, \($0)" } ?? "Jump to latest")
        .accessibilityIdentifier("jumpToLatest")
        button
    }

    /// Older pages while the top is near: the container keeps the reader's
    /// row in place as they go in above, and asks again while still near.
    fileprivate func transcriptV2LoadOlder() {
        guard model.hasOlder else { return }
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

struct InlineJump: ViewModifier {
    let state: TranscriptPillState?
    let jump: () -> Void
    @Environment(\.look) private var look

    func body(content: Content) -> some View {
        HStack(alignment: .bottom, spacing: 8) {
            content
            if let state, state.shown { button(state) }
        }
        .animation(.smooth(duration: 0.2), value: state?.shown == true)
    }

    private func button(_ state: TranscriptPillState) -> some View {
        let label = state.note ?? (state.unseen > 0 ? "new messages" : nil)
        return Button(action: jump) {
            Image(systemName: state.note != nil ? "questionmark.bubble" : "arrow.down")
                .font(.body.weight(.semibold))
                .frame(width: 44, height: 44)
                .background(look.stackFill, in: .circle)
                .glassEffect(state.note != nil ? .regular.tint(look.needsYou) : .regular, in: .circle)
                .overlay(alignment: .topTrailing) {
                    if state.unseen > 0, state.note == nil {
                        Circle().fill(look.accent).frame(width: 9, height: 9).offset(x: -6, y: 6)
                    }
                }
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .padding(.bottom, 4)
        .transition(.opacity.combined(with: .scale(scale: 0.8)))
        .accessibilityLabel(label.map { "Jump to latest, \($0)" } ?? "Jump to latest")
        .accessibilityIdentifier("jumpToLatest")
    }
}

/// A thread view's hold on its session and notes, for the view's life: it
/// lets go when SwiftUI drops the view (popped, replaced), not when it is
/// only out of sight (another tab, a screen pushed over it).
@MainActor
final class ThreadViewLifetime: ObservableObject {
    private var session: ConversationSession?
    private var notes: ThreadNotes?

    func hold(_ session: ConversationSession, notes: ThreadNotes, app: AppModel) {
        guard self.session == nil else { return }
        self.session = session
        self.notes = notes
        session.hold(app)
    }

    /// SwiftUI drops its state on the main thread, but a deinit may run on
    /// any: the release goes to the main actor, inline only when already on it.
    deinit {
        guard let session, let notes else { return }
        if Thread.isMainThread {
            MainActor.assumeIsolated { Self.release(session, notes) }
        } else {
            Task { @MainActor in Self.release(session, notes) }
        }
    }

    private static func release(_ session: ConversationSession, _ notes: ThreadNotes) {
        session.stop()
        notes.detach()
    }
}
