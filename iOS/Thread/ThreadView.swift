import SwiftUI

struct ThreadView: View {
    @EnvironmentObject private var app: AppModel
    @StateObject private var model: ThreadModel
    @State private var draft = ""
    @State private var attachments: [PendingAttachment] = []
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var dictating = false
    @State private var showingWeb = false
    @State private var composerFocused = false
    /// Follow new output only while the reader is at the bottom.
    @State private var atBottom = true
    @State private var atTop = false
    @State private var selecting: SelectionText?
    @State private var position = ScrollPosition()

    init(threadId: String) {
        _model = StateObject(wrappedValue: ThreadModel(threadId: threadId))
    }

    var body: some View {
        Group {
            // Built once the first page is in, so it opens at the bottom of real
            // content rather than growing from empty.
            if model.loaded {
                timeline
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .overlay(alignment: .bottomTrailing) { jumpButton }
        .animation(.snappy, value: atBottom)
        .safeAreaInset(edge: .bottom) { composer }
        .environment(\.openURL, OpenURLAction { url in
            guard url.scheme == "bbgo", url.host() == "thread", let id = url.pathComponents.dropFirst().first else {
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
                // One menu rather than a row of buttons, so the title has room.
                Menu {
                    Button { app.startVoiceChat(threadId: model.threadId) } label: {
                        Label("Voice chat", systemImage: "waveform")
                    }
                    Button { showingWeb = true } label: { Label("Open in BB web", systemImage: "safari") }
                    if let thread = model.thread {
                        ShareLink(item: app.client.webURL(forThread: thread).absoluteURL) {
                            Label("Share link", systemImage: "square.and.arrow.up")
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis")
                }
                .accessibilityLabel("More")
            }
        }
        .sheet(isPresented: $showingWeb) {
            if let thread = model.thread {
                NavigationStack {
                    WebView(url: app.client.webURL(forThread: thread))
                        .ignoresSafeArea(edges: .bottom)
                        .toolbar { Button("Done") { showingWeb = false } }
                }
            }
        }
        .sheet(isPresented: $dictating) {
            DictationView(threadId: model.threadId, autoStart: true) { text in
                draft = draft.isEmpty ? text : draft + " " + text
                composerFocused = true
            }
        }
        .sheet(item: $selecting) { selection in
            NavigationStack {
                SelectableText(text: selection.text)
                    .navigationTitle("Select Text")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar { Button("Done") { selecting = nil } }
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
            model.attach(app)
            await model.load()
        }
        .onDisappear { model.detach() }
        .sensoryFeedback(.success, trigger: model.confirmations)
        .sensoryFeedback(.warning, trigger: model.interactions.count) { old, new in new > old }
        .sensoryFeedback(.error, trigger: model.error) { _, new in new != nil }
        .sensoryFeedback(.selection, trigger: attachments.count) { old, new in new > old }
        .userActivity(Spotlight.threadActivityType, isActive: model.thread != nil) { activity in
            guard let thread = model.thread else { return }
            activity.title = thread.displayTitle
            activity.webpageURL = app.client.webURL(forThread: thread).absoluteURL
            activity.targetContentIdentifier = thread.id
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
                ForEach(TimelineItem.group(model.rows)) { item in
                    switch item {
                    case .message(let row):
                        MessageBubble(
                            row: row,
                            projectId: model.thread?.projectId,
                            react: { draftReply($0) },
                            quote: { quote($0) },
                            select: { selecting = SelectionText(text: $0) })
                    case .activity(let rows):
                        ActivityGroup(rows: rows)
                    }
                }
                ForEach(model.interactions) { interaction in
                    InteractionCard(
                        interaction: interaction,
                        resolve: { await model.resolve(interaction, $0) },
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
        }
        .scrollPosition($position)
        .defaultScrollAnchor(.bottom)
        .scrollDismissesKeyboard(.interactively)
        .onScrollGeometryChange(for: Bool.self) { geometry in
            geometry.contentOffset.y + geometry.containerSize.height >= geometry.contentSize.height - 120
        } action: { _, isAtBottom in
            atBottom = isAtBottom
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
        .onChange(of: model.rows.last?.text) { _, _ in
            if atBottom { scrollToBottom(animated: false) }
        }
        .onChange(of: model.interactions.first?.id) { _, id in
            if id != nil { scrollToBottom() }
        }
        .onChange(of: model.confirmations) { _, _ in scrollToBottom() }
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

    private func quote(_ text: String) {
        let quoted = text.trimmingCharacters(in: .whitespacesAndNewlines)
            .components(separatedBy: "\n").map { "> " + $0 }.joined(separator: "\n")
        let current = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        draft = (current.isEmpty ? "" : current + "\n\n") + quoted + "\n\n"
        composerFocused = true
    }

    private var canSend: Bool {
        !(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && attachments.isEmpty) && !model.sending
    }

    /// Clears the field right away and puts the text back if sending fails.
    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let files = attachments
        draft = ""
        attachments = []
        Task {
            if await !model.send(text, attachments: files) {
                if draft.isEmpty { draft = text }
                if attachments.isEmpty { attachments = files }
            }
        }
    }

    private var composer: some View {
        VStack(spacing: 6) {
            ThreadShelf(model: model)
            AttachmentStrip(items: $attachments)
            HStack(alignment: .bottom, spacing: 4) {
                AttachmentMenu(items: $attachments)
                Button { dictating = true } label: {
                    Image(systemName: "mic.fill").font(.title3).frame(width: 36, height: 36)
                }
                .accessibilityLabel("Dictate")
                ComposerField(text: $draft, focused: $composerFocused) { images in
                    attachments += images.compactMap { PendingAttachment.image($0, name: "pasted.jpg") }
                }
                .background(.fill.tertiary, in: .rect(cornerRadius: 18))
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
                .accessibilityLabel(model.thread?.isRunning == true ? "Queue message" : "Send")
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(.bar)
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
