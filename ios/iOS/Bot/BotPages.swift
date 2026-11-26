import SwiftUI

struct BotPageScreen: View {
    let page: BotPage
    let bot: BotSpace?
    var open: (BotShellItem) -> Void
    var openMain: () -> Void
    var refresh: () -> Void

    var body: some View {
        switch page {
        case .memory:
            MemoryPageView(botId: bot?.id, open: open)
        case .library:
            LibraryPageView(botId: bot?.id)
        case .strands:
            StrandsOverviewView(botId: bot?.id) { open(.conversation($0)) }
        case .automations:
            BotAutomationsSheet(botId: bot?.id, botName: bot?.name ?? BotInfo.defaultName, embedded: true)
                .id(bot?.id)
        case .archive:
            ArchivePageView(botId: bot?.id, open: open, refresh: refresh)
        }
    }
}

struct BotPageChips<Value: Hashable>: View {
    let choices: [(value: Value, label: String)]
    @Binding var selection: Value

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(choices, id: \.value) { choice in
                    let selected = choice.value == selection
                    Button { withAnimation(.snappy) { selection = choice.value } } label: {
                        Text(choice.label).font(.subheadline.weight(.medium))
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .foregroundStyle(selected ? Color.white : .primary)
                            .background(selected ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(.background.secondary), in: .capsule)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("chip-\(choice.label)")
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }
            .padding(.horizontal, 16)
        }
        .scrollIndicators(.hidden)
        .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
    }
}

struct ArchivePageView: View {
    let botId: String?
    var open: (BotShellItem) -> Void
    var refresh: () -> Void
    @EnvironmentObject private var app: AppModel
    @State private var load = PageLoad<ArchiveData>()
    @State private var error: String?
    @State private var query = ""
    @State private var filter: ArchivePage.Filter = .all
    @State private var deleting: ArchiveData.Conversation?

    private var data: ArchiveData? { load.value }
    private var scope: String { "\(app.client.baseURL.absoluteString)|\(botId ?? "")" }

    var body: some View {
        let shown = data.map { ArchivePage.shown($0, query: query, filter: filter) } ?? (conversations: [], workers: [])
        List {
            BotPageChips(choices: ArchivePage.Filter.allCases.map { each in
                (each, each.title + (data.flatMap { ArchivePage.count($0, each) }.map { " \($0)" } ?? ""))
            }, selection: $filter)
            if let error { Section { Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.secondary) } }
            if data != nil, let error = load.error {
                PageLoadErrorRow(message: error, id: "archiveRowRetry") { load.retry() }
            }
            if !shown.conversations.isEmpty {
                Section {
                    ForEach(shown.conversations) { conversationRow($0) }
                } header: { Text("Conversations") }
            }
            if !shown.workers.isEmpty {
                Section {
                    ForEach(shown.workers) { workerRow($0) }
                } header: { Text(filter == .failed ? "Failed workers" : "Workers") }
            }
            if data != nil, shown.conversations.isEmpty, shown.workers.isEmpty {
                Section {
                    ContentUnavailableView(ArchivePage.emptyText(query: query, filter: filter), systemImage: "archivebox")
                }
                .listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .overlay {
            if data == nil {
                if let error = load.error {
                    PageLoadFailed(title: "The archive didn't load", message: error, id: "archiveRetry") { load.retry() }
                } else {
                    ProgressView()
                }
            }
        }
        .alert(ConversationFinish.deleteTitle(deleting?.title ?? ""),
               isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), presenting: deleting) { row in
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) { Task { await delete(row.threadId) } }
                .accessibilityIdentifier("confirmDelete")
        } message: { _ in
            Text(ConversationFinish.deleteMessage)
        }
        .modifier(PageChrome(title: "Archive", query: $query, prompt: "Search the archive") { EmptyView() })
        .navigationBarTitleDisplayMode(.large)
        .refreshable { await load.reload() }
        .task(id: scope) { start() }
        .accessibilityIdentifier("archive-page")
    }

    @ViewBuilder private func conversationRow(_ row: ArchiveData.Conversation) -> some View {
        if row.finished {
            NavigationLink {
                FinishedConversationScreen(threadId: row.threadId, title: row.title, open: open) { await reopened() }
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "checkmark.circle").foregroundStyle(.green).frame(width: 22)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(row.title).lineLimit(1)
                        Text("Finished · " + MemoryFormat.shortDate(row.at)).font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }
            .swipeActions(edge: .trailing, allowsFullSwipe: false) { archiveActions(row, swipe: true) }
            .contextMenu { archiveActions(row, swipe: false) }
            .accessibilityIdentifier("archive-finished-\(row.threadId)")
        } else {
            Button { open(.conversation(row.threadId)) } label: {
                HStack(spacing: 12) {
                    Image(systemName: "bubble.left").foregroundStyle(.secondary).frame(width: 22)
                    Text(row.title).lineLimit(1).foregroundStyle(.primary)
                    Spacer(minLength: 8)
                    Text(BotShell.shortAge(row.at)).font(.subheadline).monospacedDigit().foregroundStyle(.secondary)
                }
            }
            .tint(.primary)
            .swipeActions(edge: .trailing, allowsFullSwipe: false) { archiveActions(row, swipe: true) }
            .contextMenu { archiveActions(row, swipe: false) }
            .accessibilityIdentifier("archive-conversation-\(row.threadId)")
        }
    }

    @ViewBuilder private func archiveActions(_ row: ArchiveData.Conversation, swipe: Bool) -> some View {
        if row.finished {
            Button { Task { await reopen(row.threadId) } } label: { Label("Restore", systemImage: "arrow.uturn.backward") }
                .tint(.accentColor)
                .accessibilityIdentifier("archiveRestore-\(row.threadId)")
        } else {
            Button { Task { await archive(row.threadId) } } label: { Label("Archive", systemImage: "archivebox") }
                .tint(.indigo)
                .accessibilityIdentifier("archiveArchive-\(row.threadId)")
        }
        Button(role: swipe ? nil : .destructive) { deleting = row } label: { Label("Delete", systemImage: "trash") }
            .tint(.red)
            .accessibilityIdentifier("archiveDelete-\(row.threadId)")
    }

    private func archive(_ threadId: String) async {
        do {
            try await app.client.finishConversation(threadId: threadId)
            await reopened()
        } catch { self.error = "It didn't archive: " + BBClient.describe(error) }
    }

    private func delete(_ threadId: String) async {
        do {
            try await app.client.delete(threadId, withChildren: true)
            await reopened()
        } catch { self.error = "It didn't delete: " + BBClient.describe(error) }
    }

    private func workerRow(_ row: ArchiveData.Worker) -> some View {
        let stale = ArchivePage.staleFailure(row)
        return Button { open(.worker(row.threadId)) } label: {
            HStack(spacing: 12) {
                Group {
                    if stale {
                        Image(systemName: "xmark.circle").foregroundStyle(.secondary).accessibilityLabel("Failed, a while ago")
                    } else {
                        BotWorkerGlyph(status: row.status)
                    }
                }
                .frame(width: 22)
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.title).lineLimit(1).foregroundStyle(.primary)
                    Text(([ArchivePage.statusLabel(row), row.ownerTitle.map { "for \($0)" }, row.tag, BotShell.shortAge(row.updatedAt)] as [String?])
                        .compactMap { $0 }.joined(separator: " · "))
                        .font(.footnote)
                        .foregroundStyle(row.status == .failed && !stale ? AnyShapeStyle(.red) : AnyShapeStyle(.secondary))
                        .lineLimit(1)
                }
            }
        }
        .tint(.primary)
        .accessibilityIdentifier("archive-worker-\(row.threadId)")
    }

    private func reopen(_ threadId: String) async {
        do {
            try await app.client.botReopen(threadId: threadId)
            await reopened()
        } catch { self.error = "It didn't reopen: " + BBClient.describe(error) }
    }

    private func reopened() async {
        refresh()
        error = nil
        await load.reload()
    }

    private func start() {
        let client = app.client
        let botId = botId
        load.describe = { BBClient.describe($0, server: client.baseURL) }
        load.run(key: scope) { try await client.botArchive(botId: botId) }
    }
}

struct FinishedConversationScreen: View {
    let threadId: String
    let title: String
    var open: (BotShellItem) -> Void
    var reopened: () async -> Void
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var finished: FinishedConversation?
    @State private var loaded = false
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        List {
            if let finished {
                Section("Summary") {
                    Text(finished.summary.isEmpty ? "No summary" : finished.summary)
                        .foregroundStyle(finished.summary.isEmpty ? .secondary : .primary)
                        .textSelection(.enabled)
                        .accessibilityIdentifier("finishedSummary")
                }
                Section {
                    if let at = finished.startedAt { LabeledContent("Started", value: MemoryFormat.shortDate(at)) }
                    if let at = finished.finishedAt { LabeledContent("Finished", value: MemoryFormat.shortDate(at)) }
                }
            } else if loaded {
                Section { Text("This conversation isn't finished.").foregroundStyle(.secondary) }
            }
            if let error { Section { Text(error).foregroundStyle(.red).font(.callout) } }
            Section {
                Button("Reopen", systemImage: "arrow.uturn.backward") { Task { await reopen() } }
                    .disabled(busy || (loaded && finished == nil))
                    .accessibilityIdentifier("archiveReopen")
                Button("Open conversation", systemImage: "bubble.left") { open(.conversation(threadId)) }
            }
        }
        .overlay { if !loaded { ProgressView() } }
        .navigationTitle(finished?.title ?? title)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            do { finished = try await app.client.botFinished(threadId: threadId) } catch { self.error = BBClient.describe(error, server: app.client.baseURL) }
            loaded = true
        }
    }

    private func reopen() async {
        busy = true
        defer { busy = false }
        do {
            try await app.client.botReopen(threadId: threadId)
            await reopened()
            open(.conversation(threadId))
        } catch { self.error = "It didn't reopen: " + BBClient.describe(error) }
    }
}

struct PageLoadFailed: View {
    let title: String
    let message: String
    let id: String
    let retry: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: "exclamationmark.triangle")
        } description: {
            Text(message)
        } actions: {
            Button("Retry", action: retry)
                .buttonStyle(.borderedProminent)
                .frame(minHeight: 44)
                .accessibilityIdentifier(id)
        }
    }
}

struct PageLoadErrorRow: View {
    let message: String
    let id: String
    let retry: () -> Void

    var body: some View {
        Section {
            HStack(spacing: 12) {
                Label(message, systemImage: "exclamationmark.triangle").foregroundStyle(.secondary)
                Spacer(minLength: 8)
                Button("Retry", action: retry)
                    .frame(minWidth: 44, minHeight: 44)
                    .accessibilityIdentifier(id)
            }
        }
    }
}
