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
            LibraryPageView(botId: bot?.id, open: open)
        case .todos:
            LoopsView(attention: nil, openChat: openMain)
                .navigationTitle("Todos")
                .navigationBarTitleDisplayMode(.large)
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

struct MemoryPageView: View {
    let botId: String?
    var open: (BotShellItem) -> Void
    @EnvironmentObject private var app: AppModel
    @State private var overviewLoad = PageLoad<MemoryOverview>()
    @State private var recordsLoad = PageLoad<(records: [MemoryRecord], total: Int)>()
    @State private var query = ""
    @State private var topic: String?
    @State private var sort: MemoryPage.Sort = .newest
    @State private var adding = false
    @State private var profileOpen = false
    @State private var profileText: String?
    @State private var replacedOpen = false
    @State private var listTask: Task<Void, Never>?

    private var overview: MemoryOverview? { overviewLoad.value }
    private var records: [MemoryRecord]? { recordsLoad.value?.records }
    private var total: Int { recordsLoad.value?.total ?? 0 }
    private var scope: String { "\(app.client.baseURL.absoluteString)|\(botId ?? "")" }

    var body: some View {
        List {
            if let overview { chips(overview) }
            if overview != nil, let error = overviewLoad.error {
                PageLoadErrorRow(message: error, id: "memoryOverviewRetry") { overviewLoad.retry() }
            }
            if overview != nil, let error = recordsLoad.error {
                PageLoadErrorRow(message: error, id: "memoryRecordsRetry") { startRecords() }
            }
            if let overview { profile(overview) }
            if records == nil, overview != nil, recordsLoad.waiting {
                ProgressView().frame(maxWidth: .infinity).listRowBackground(Color.clear).accessibilityIdentifier("memoryRecordsLoading")
            }
            if let records {
                let split = MemoryPage.split(records)
                if records.isEmpty {
                    Section {
                        ContentUnavailableView(query.isEmpty && topic == nil ? "No records" : "No records match", systemImage: "brain")
                    }
                    .listRowBackground(Color.clear)
                }
                if !split.current.isEmpty {
                    Section {
                        ForEach(split.current) { row($0) }
                    } header: { header("Records", split.current.count) }
                }
                if !split.replaced.isEmpty {
                    Section {
                        DisclosureGroup(isExpanded: $replacedOpen) {
                            ForEach(split.replaced) { row($0) }
                        } label: { header("Replaced", split.replaced.count) }
                    }
                }
                if total > records.count {
                    Text("Showing \(records.count) of \(total)").font(.footnote).foregroundStyle(.secondary).listRowBackground(Color.clear)
                }
            }
        }
        .listStyle(.insetGrouped)
        .overlay {
            if overview == nil {
                if let error = overviewLoad.error {
                    PageLoadFailed(title: "Memory didn't load", message: error, id: "memoryRetry") { reloadAll() }
                } else {
                    ProgressView().accessibilityIdentifier("memoryLoading")
                }
            }
        }
        .searchable(text: $query, prompt: MemoryPage.searchPrompt((overview?.current ?? 0) + (overview?.replaced ?? 0)))
        .navigationTitle("Memory")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Picker("Sort", selection: $sort) { ForEach(MemoryPage.Sort.allCases) { Text($0.title).tag($0) } }
                } label: { Image(systemName: "arrow.up.arrow.down") }
                .accessibilityLabel("Sort")
            }
            ToolbarItem(placement: .primaryAction) {
                Button { adding = true } label: { Image(systemName: "plus") }
                    .accessibilityLabel("New record")
                    .accessibilityIdentifier("memoryAdd")
            }
        }
        .sheet(isPresented: $adding) {
            MemoryRecordEditor(title: "New record", saveLabel: "Add", initial: (topic ?? "", ""), topics: overview?.topics.map(\.topic) ?? []) { topic, text in
                try await app.client.memoryAdd(botId: botId, topic: topic, text: text)
                await reload()
            }
        }
        .refreshable { await reload() }
        .task(id: scope) { reloadAll(force: false) }
        .onChange(of: botId) { _, _ in
            query = ""
            topic = nil
            profileText = nil
        }
        .onChange(of: query) { _, _ in schedule(after: .milliseconds(250)) }
        .onChange(of: topic) { _, _ in schedule() }
        .onChange(of: sort) { _, _ in schedule() }
        .accessibilityIdentifier("memory-page")
    }

    private func header(_ title: String, _ count: Int) -> some View {
        HStack(spacing: 6) {
            Text(title)
            Text("\(count)").monospacedDigit().foregroundStyle(.tertiary)
        }
    }

    private func chips(_ overview: MemoryOverview) -> some View {
        let pills = MemoryPage.topicPills(overview.topics, picked: topic)
        return BotPageChips(choices: [(String?.none, "All")] + pills.map { (Optional($0), $0) }, selection: $topic)
    }

    private func profile(_ overview: MemoryOverview) -> some View {
        Section {
            DisclosureGroup(isExpanded: $profileOpen) {
                if let profile = overview.profile {
                    Group {
                        if let profileText {
                            PageMarkdown(source: profileText).accessibilityIdentifier("memoryProfileText")
                        } else {
                            ProgressView().frame(maxWidth: .infinity)
                        }
                    }
                    .task { if profileText == nil { profileText = (try? await app.client.memoryProfile(botId: botId)) ?? "" } }
                    NavigationLink(value: Route.page(id: profile.pageId)) {
                        Label("Edit the core profile", systemImage: "pencil")
                    }
                    .accessibilityIdentifier("memoryProfileEdit")
                } else {
                    Text("No core profile").foregroundStyle(.secondary)
                }
            } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Core profile").font(.body.weight(.semibold))
                    if let profile = overview.profile {
                        Text(MemoryPage.profileCount(profile)).font(.footnote).monospacedDigit()
                            .foregroundStyle(profile.over ? AnyShapeStyle(.orange) : AnyShapeStyle(.secondary))
                    }
                }
            }
            .accessibilityIdentifier("memoryProfile")
        }
    }

    private func row(_ record: MemoryRecord) -> some View {
        NavigationLink {
            MemoryRecordScreen(record: record, topics: overview?.topics.map(\.topic) ?? [], open: open) { await reload() }
        } label: {
            VStack(alignment: .leading, spacing: 3) {
                Text(record.text).lineLimit(2)
                    .foregroundStyle(record.isReplaced || record.archived ? .secondary : .primary)
                HStack(spacing: 6) {
                    Text("\(record.topic) · \(MemoryPage.date(record.createdAt))")
                    if record.archived { Text("Archived").foregroundStyle(.orange) }
                }
                .font(.footnote).foregroundStyle(.secondary).lineLimit(1)
            }
            .padding(.vertical, 2)
        }
        .accessibilityIdentifier("memory-record-\(record.id)")
    }

    private func schedule(after delay: Duration = .zero) {
        listTask?.cancel()
        listTask = Task {
            if delay > .zero { try? await Task.sleep(for: delay) }
            guard !Task.isCancelled else { return }
            startRecords()
        }
    }

    private func reload() async {
        listTask?.cancel()
        profileText = nil
        startOverview(force: true)
        startRecords(force: true)
        await overviewLoad.settle()
        await recordsLoad.settle()
    }

    private func reloadAll(force: Bool = true) {
        startOverview(force: force)
        startRecords(force: force)
    }

    private func startOverview(force: Bool = false) {
        let client = app.client
        let botId = botId
        overviewLoad.describe = { BBClient.describe($0, server: client.baseURL) }
        if force, overviewLoad.key == scope { return overviewLoad.retry() }
        overviewLoad.run(key: scope) { try await client.memoryOverview(botId: botId) }
    }

    private func startRecords(force: Bool = false) {
        let client = app.client
        let botId = botId
        let asked = MemoryQuery(query: query, topic: topic, sort: sort)
        let (query, topic, sort) = (query, topic, sort)
        let key = "\(scope)|\(asked.query)|\(asked.topic ?? "")|\(asked.sort)"
        recordsLoad.describe = { BBClient.describe($0, server: client.baseURL) }
        if force, recordsLoad.key == key { return recordsLoad.retry() }
        recordsLoad.run(key: key, scope: scope) { try await client.memoryRecords(botId: botId, query: query, topic: topic, sort: sort) }
    }
}

struct MemoryRecordScreen: View {
    @State var record: MemoryRecord
    let topics: [String]
    var open: (BotShellItem) -> Void
    var changed: () async -> Void
    @EnvironmentObject private var app: AppModel
    @State private var editing = false
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        List {
            Section {
                Text(record.text).textSelection(.enabled).accessibilityIdentifier("memoryRecordText")
            }
            Section {
                LabeledContent("Topic", value: record.topic)
                LabeledContent("Added", value: MemoryPage.date(record.createdAt))
                source
                if let replaces = MemoryPage.replacesLabel(record) {
                    LabeledContent("Replaces") { Text(replaces).foregroundStyle(.orange) }
                }
                if record.isReplaced, let at = record.replacedAt { LabeledContent("Replaced", value: MemoryPage.date(at)) }
                if record.archived { LabeledContent("Status", value: "Archived") }
            }
            if let error { Section { Text(error).foregroundStyle(.red).font(.callout) } }
            Section {
                Button(record.archived ? "Restore" : "Archive", systemImage: record.archived ? "arrow.uturn.backward" : "archivebox") {
                    Task { await archive(!record.archived) }
                }
                .disabled(busy)
                .accessibilityIdentifier("memoryArchive")
            }
        }
        .navigationTitle(record.topic)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !record.isReplaced {
                Button("Edit") { editing = true }.accessibilityIdentifier("memoryEdit")
            }
        }
        .sheet(isPresented: $editing) {
            MemoryRecordEditor(title: "Edit record", saveLabel: "Save", initial: (record.topic, record.text), topics: topics,
                               note: "Saves a new record that replaces this one; this one stays as history.") { topic, text in
                let next = try await app.client.memoryUpdate(botId: record.botId, id: record.id, text: text, topic: topic == record.topic ? nil : topic)
                if let next { record = next }
                await changed()
            }
        }
    }

    @ViewBuilder private var source: some View {
        let label = MemoryPage.sourceLabel(record)
        switch MemoryPage.sourceTarget(record) {
        case .thread(let id):
            LabeledContent("Source") { Button(label) { open(.conversation(id)) }.accessibilityIdentifier("memorySource") }
        case .page(let id):
            NavigationLink(value: Route.page(id: id)) { LabeledContent("Source", value: label) }.accessibilityIdentifier("memorySource")
        case nil:
            LabeledContent("Source", value: label)
        }
    }

    private func archive(_ archived: Bool) async {
        busy = true
        defer { busy = false }
        do {
            if let next = try await app.client.memoryArchive(botId: record.botId, id: record.id, archived: archived) { record = next } else { record.archived = archived }
            error = nil
            await changed()
        } catch { self.error = BBClient.describe(error, server: app.client.baseURL) }
    }
}

struct MemoryRecordEditor: View {
    let title: String
    let saveLabel: String
    let initial: (topic: String, text: String)
    let topics: [String]
    var note: String?
    var save: (String, String) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var topic = ""
    @State private var text = ""
    @State private var saving = false
    @State private var error: String?

    init(title: String, saveLabel: String, initial: (topic: String, text: String), topics: [String], note: String? = nil,
         save: @escaping (String, String) async throws -> Void) {
        self.title = title
        self.saveLabel = saveLabel
        self.initial = initial
        self.topics = topics
        self.note = note
        self.save = save
        _topic = State(initialValue: initial.topic)
        _text = State(initialValue: initial.text)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Topic") {
                    HStack {
                        TextField("Topic", text: $topic).accessibilityIdentifier("memoryTopicField")
                        if !topics.isEmpty {
                            Menu {
                                ForEach(topics, id: \.self) { each in Button(each) { topic = each } }
                            } label: { Image(systemName: "chevron.up.chevron.down") }
                            .accessibilityLabel("Topics")
                        }
                    }
                }
                Section {
                    TextField("A fact, decision or note", text: $text, axis: .vertical)
                        .lineLimit(3...12)
                        .accessibilityIdentifier("memoryTextField")
                } header: { Text("Record") } footer: { if let note { Text(note) } }
                if let error { Section { Text(error).foregroundStyle(.red).font(.callout) } }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : saveLabel) { Task { await submit() } }
                        .disabled(saving || !MemoryPage.canSave(topic: topic, text: text, initial: initial))
                        .accessibilityIdentifier("memorySave")
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func submit() async {
        saving = true
        do {
            try await save(topic.trimmingCharacters(in: .whitespacesAndNewlines), text.trimmingCharacters(in: .whitespacesAndNewlines))
            dismiss()
        } catch {
            self.error = "Couldn't save the record: " + BBClient.describe(error)
            saving = false
        }
    }
}

struct LibraryPageView: View {
    let botId: String?
    var open: (BotShellItem) -> Void
    var tiles = false
    @EnvironmentObject private var app: AppModel
    @AppStorage("studio.library.group") private var groupBy: LibraryPage.GroupBy = .conversation
    @State private var load = PageLoad<[BotLibraryItem]>()
    @State private var query = ""
    @State private var kind: BotLibraryItem.Kind?
    @State private var unfolded: Set<String> = []

    private var items: [BotLibraryItem]? { load.value }
    private var scope: String { "\(app.client.baseURL.absoluteString)|\(botId ?? "")" }

    var body: some View {
        let groups = LibraryPage.groups(items ?? [], query: query, kind: kind, groupBy: tiles ? .date : groupBy)
        Group {
            if tiles { grid(groups) } else { list(groups) }
        }
        .overlay {
            if items == nil {
                if let error = load.error {
                    PageLoadFailed(title: "The library didn't load", message: error, id: "libraryRetry") { load.retry() }
                } else {
                    ProgressView().accessibilityIdentifier("libraryLoading")
                }
            }
        }
        .searchable(text: $query, prompt: "Search files")
        .navigationTitle("Library")
        .navigationBarTitleDisplayMode(.large)
        .libraryOptions(groupBy: $groupBy, tiles: tiles)
        .refreshable { await load.reload() }
        .task(id: scope) { start() }
        .onChange(of: botId) { _, _ in
            query = ""
            kind = nil
            unfolded = []
        }
        .accessibilityIdentifier("library-page")
    }

    private var chips: some View {
        BotPageChips(choices: [(BotLibraryItem.Kind?.none, "All")] + LibraryPage.filters.map { (Optional($0), LibraryPage.chip($0)) }, selection: $kind)
    }

    private func grid(_ groups: [BotLibraryGroup]) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                chips.padding(.horizontal, -16)
                if items != nil, let error = load.error {
                    PageLoadFailed(title: "The library didn't load", message: error, id: "libraryRowRetry") { load.retry() }
                }
                ForEach(groups) { group in
                    Text(group.title).font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
                        .padding(.top, 18).padding(.bottom, 6)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
                        ForEach(group.rows) { tile($0) }
                    }
                }
                if let items, groups.isEmpty {
                    ContentUnavailableView(items.isEmpty ? "No files" : "No files match", systemImage: "books.vertical").padding(.top, 40)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 30)
        }
    }

    @ViewBuilder private func tile(_ row: BotLibraryRow) -> some View {
        let kind = StudioKind.of(row.item.studioKind)
        let label = VStack(alignment: .leading, spacing: 0) {
            ZStack {
                Rectangle().fill(kind.tint.opacity(0.14))
                Image(systemName: kind.symbol).font(.title).foregroundStyle(kind.tint)
            }
            .frame(height: 92)
            HStack(spacing: 4) {
                Text(row.item.title).font(.subheadline.weight(.medium)).lineLimit(1)
                if row.count > 1 {
                    Text("×\(row.count)").font(.caption).monospacedDigit().foregroundStyle(.secondary)
                        .accessibilityLabel("\(row.count) like it")
                }
            }
            .padding(.horizontal, 10).padding(.top, 9).padding(.bottom, 2)
            Text(LibraryPage.label(row.item.kind)).font(.caption).foregroundStyle(.secondary)
                .padding(.horizontal, 10).padding(.bottom, 10)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background.secondary, in: .rect(cornerRadius: 8))
        .clipShape(.rect(cornerRadius: 8))
        .contentShape(.rect)
        if let route = row.item.route {
            NavigationLink(value: route) { label }.buttonStyle(.plain).accessibilityIdentifier("library-row-\(row.item.itemId)")
        } else {
            label.opacity(0.6).accessibilityIdentifier("library-row-\(row.item.itemId)")
        }
    }

    private func list(_ groups: [BotLibraryGroup]) -> some View {
        List {
            chips
            if items != nil, let error = load.error {
                PageLoadErrorRow(message: error, id: "libraryRowRetry") { load.retry() }
            }
            ForEach(groups) { group in
                let fold = LibraryPage.folded(group.rows, open: unfolded.contains(group.id))
                Section {
                    ForEach(fold.shown) { row($0) }
                    if fold.more > 0 {
                        Button("\(fold.more) more in \(group.title)") { withAnimation(.snappy) { _ = unfolded.insert(group.id) } }
                            .font(.subheadline)
                            .accessibilityIdentifier("library-more")
                    }
                } header: { header(group) }
            }
            if let items, groups.isEmpty {
                Section {
                    ContentUnavailableView(items.isEmpty ? "No files" : "No files match", systemImage: "books.vertical")
                }
                .listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
    }

    @ViewBuilder private func header(_ group: BotLibraryGroup) -> some View {
        HStack(spacing: 6) {
            if let threadId = group.threadId {
                Button(group.title) { open(.conversation(threadId)) }.lineLimit(1)
            } else {
                Text(group.title).lineLimit(1)
            }
            Text("\(group.count)").monospacedDigit().foregroundStyle(.tertiary)
        }
    }

    @ViewBuilder private func row(_ row: BotLibraryRow) -> some View {
        let kind = StudioKind.of(row.item.studioKind)
        let label = HStack(spacing: 12) {
            Image(systemName: kind.symbol).foregroundStyle(kind.tint).frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(row.item.title).lineLimit(1)
                    if row.count > 1 {
                        Text("×\(row.count)").font(.caption).monospacedDigit().foregroundStyle(.secondary)
                            .accessibilityLabel("\(row.count) like it")
                    }
                }
                Text(LibraryPage.meta(row.item, groupBy: groupBy)).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        if let route = row.item.route {
            NavigationLink(value: route) { label }.accessibilityIdentifier("library-row-\(row.item.itemId)")
        } else {
            label.foregroundStyle(.secondary).accessibilityIdentifier("library-row-\(row.item.itemId)")
        }
    }

    private func start() {
        let client = app.client
        let botId = botId
        load.describe = { BBClient.describe($0, server: client.baseURL) }
        load.run(key: scope) { try await client.botLibrary(botId: botId) }
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
        .searchable(text: $query, prompt: "Search the archive")
        .navigationTitle("Archive")
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
                        Text("Finished · " + MemoryPage.date(row.at)).font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }
            .swipeActions(edge: .trailing) {
                Button("Reopen", systemImage: "arrow.uturn.backward") { Task { await reopen(row.threadId) } }.tint(.accentColor)
            }
            .accessibilityIdentifier("archive-finished-\(row.threadId)")
        } else {
            Button { open(.conversation(row.threadId)) } label: {
                HStack(spacing: 12) {
                    Image(systemName: "bubble.left").foregroundStyle(.secondary).frame(width: 22)
                    Text(row.title).lineLimit(1).foregroundStyle(.primary)
                    Spacer(minLength: 8)
                    Text(BotShell.shortAge(row.at)).font(.subheadline).monospacedDigit().foregroundStyle(.tertiary)
                }
            }
            .tint(.primary)
            .accessibilityIdentifier("archive-conversation-\(row.threadId)")
        }
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
                    if let at = finished.startedAt { LabeledContent("Started", value: MemoryPage.date(at)) }
                    if let at = finished.finishedAt { LabeledContent("Finished", value: MemoryPage.date(at)) }
                    if let records = finished.recordsLabel { LabeledContent("Saved", value: records) }
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

struct MemoryRecordLoader: View {
    let id: String
    @EnvironmentObject private var app: AppModel
    @State private var record: MemoryRecord?
    @State private var error: String?
    @State private var loaded = false

    var body: some View {
        Group {
            if let record {
                MemoryRecordScreen(record: record, topics: [], open: { item in
                    if case .conversation(let threadId) = item { app.follow(.thread(threadId, worker: false)) }
                }) {}
            } else if loaded {
                ContentUnavailableView(error == nil ? "Record not found" : "Couldn't load the record", systemImage: "brain",
                                       description: error.map(Text.init))
            } else {
                ProgressView()
            }
        }
        .task {
            do { record = try await app.client.memoryRecord(id: id) } catch { self.error = BBClient.describe(error, server: app.client.baseURL) }
            loaded = true
        }
    }
}

/// The search a Memory list load was made for.
struct MemoryQuery: Equatable {
    var query: String
    var topic: String?
    var sort: String

    init(query: String, topic: String?, sort: some Hashable) {
        self.query = query
        self.topic = topic
        self.sort = String(describing: sort)
    }

    func matches(query: String, topic: String?, sort: some Hashable) -> Bool {
        self == MemoryQuery(query: query, topic: topic, sort: sort)
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

private struct LibraryOptions: ViewModifier {
    @Binding var groupBy: LibraryPage.GroupBy
    let tiles: Bool

    func body(content: Content) -> some View {
        content.toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    if !tiles {
                        Picker("Group by", selection: $groupBy) { ForEach(LibraryPage.GroupBy.allCases) { Text($0.title).tag($0) } }
                    }
                    Section {
                        NavigationLink(value: Route.visualChats) { Label("Visual Chat", systemImage: "rectangle.on.rectangle") }
                    }
                } label: { Image(systemName: "ellipsis") }
                .accessibilityLabel("Library options")
                .accessibilityIdentifier("libraryOptions")
            }
        }
    }
}

extension View {
    fileprivate func libraryOptions(groupBy: Binding<LibraryPage.GroupBy>, tiles: Bool) -> some View {
        modifier(LibraryOptions(groupBy: groupBy, tiles: tiles))
    }
}
