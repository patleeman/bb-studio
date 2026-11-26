import SwiftUI

/// History: archived conversations' summaries (the default), or every
/// conversation with full-text search. A row opens its conversation.
struct HistoryLayerView: View {
    enum Mode: String, CaseIterable, Hashable {
        case summaries, conversations
        var title: String { self == .summaries ? "Summaries" : "Past conversations" }
    }

    let store: MemoryStore
    var open: (BotShellItem) -> Void
    @State private var mode: Mode = .summaries
    @State private var query = ""

    var body: some View {
        let words = MemoryHistory.words(query)
        List {
            ShellSearchField(text: $query, prompt: mode == .summaries ? "Search summaries" : "Search every message", id: "memoryHistorySearch")
                .listRowSeparator(.hidden)
            BotPageChips(choices: Mode.allCases.map { ($0, $0.title) }, selection: $mode)
            switch mode {
            case .summaries: SummaryRows(store: store, words: words, open: open)
            case .conversations: ConversationRows(store: store, query: query, words: words, open: open)
            }
        }
        .listStyle(.plain)
        .overlay {
            if mode == .summaries {
                MemoryLoadState(load: store.summaries) { store.loadHistory(force: true) }
            } else {
                MemoryLoadState(load: store.conversations) { store.loadHistory(force: true) }
            }
        }
        .refreshable { await store.refresh(.history) }
        .task(id: ObjectIdentifier(store)) { store.loadHistory() }
        .sensoryFeedback(.selection, trigger: mode)
        .accessibilityIdentifier("memory-history")
    }
}

private struct SummaryRows: View {
    let store: MemoryStore
    let words: [String]
    var open: (BotShellItem) -> Void

    var body: some View {
        if let all = store.summaries.value {
            let shown = MemoryHistory.summaries(all, words: words)
            if shown.isEmpty {
                ContentUnavailableView(words.isEmpty ? "No summaries yet" : "No summaries match", systemImage: "text.document",
                                       description: Text(words.isEmpty ? "Archiving a conversation writes its summary here." : ""))
                    .listRowSeparator(.hidden)
            }
            ForEach(shown) { summary in
                Button { open(.conversation(summary.threadId)) } label: { SummaryCard(summary: summary) }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("memorySummary-\(summary.threadId)")
            }
        }
    }
}

/// A summary: its title and date, then its sections, four items each.
private struct SummaryCard: View {
    let summary: HistorySummary

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(summary.title).font(.body.weight(.semibold)).lineLimit(1)
                Spacer(minLength: 8)
                Text(MemoryFormat.shortDate(summary.archivedAt)).font(.caption).foregroundStyle(.secondary)
            }
            ForEach(Array(SummaryText.sections(summary.summary).enumerated()), id: \.offset) { _, section in
                SummarySectionText(section: section)
            }
        }
        .padding(.vertical, 4)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
    }
}

private struct SummarySectionText: View {
    let section: SummaryText.Section

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            if !section.heading.isEmpty {
                Text(section.heading).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            }
            ForEach(Array(section.items.prefix(4).enumerated()), id: \.offset) { _, item in
                Text((section.list || section.items.count > 1 ? "· " : "") + item).lineLimit(2)
            }
            if section.items.count > 4 {
                Text("+\(section.items.count - 4) more").foregroundStyle(.secondary)
            }
        }
        .font(.subheadline)
    }
}

/// Every conversation; a search also asks the server, which reads the messages.
private struct ConversationRows: View {
    let store: MemoryStore
    let query: String
    let words: [String]
    var open: (BotShellItem) -> Void
    @State private var hits: [String: ConversationHit] = [:]
    @State private var indexing = false

    var body: some View {
        Group {
            if let all = store.conversations.value {
                let shown = MemoryHistory.conversations(all, words: words, hits: hits)
                if !words.isEmpty, indexing {
                    Text("Still reading older messages").font(.footnote).foregroundStyle(.secondary)
                        .accessibilityIdentifier("memoryHistoryIndexing")
                }
                if shown.isEmpty {
                    ContentUnavailableView(words.isEmpty ? "No conversations yet" : "No conversations match", systemImage: "bubble.left.and.bubble.right")
                        .listRowSeparator(.hidden)
                }
                ForEach(shown) { row in
                    Button { open(.conversation(row.threadId)) } label: { ConversationRow(row: row, detail: MemoryHistory.detail(row, hit: hits[row.threadId])) }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("memoryConversation-\(row.threadId)")
                }
            }
        }
        .task(id: query) { await search() }
    }

    /// Waits for typing to settle, then searches the messages.
    private func search() async {
        let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { hits = [:]; indexing = false; return }
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled, let found = try? await store.client.memorySearchConversations(botId: store.botId, query: text), !Task.isCancelled else { return }
        hits = found.hits
        indexing = found.indexing
    }
}

private struct ConversationRow: View {
    let row: PastConversation
    let detail: String?
    @Environment(\.look) private var look

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: row.archived ? (row.summary != nil ? "checkmark.circle" : "archivebox") : "bubble.left")
                .foregroundStyle(row.archived && row.summary != nil ? AnyShapeStyle(look.success) : AnyShapeStyle(.secondary))
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline) {
                    Text(row.title).lineLimit(1)
                    Spacer(minLength: 8)
                    Text(row.archived ? MemoryFormat.shortDate(row.updatedAt) : BotShell.shortAge(row.updatedAt))
                        .font(.caption).monospacedDigit().foregroundStyle(.secondary)
                }
                if let detail { Text(detail).font(.subheadline).foregroundStyle(.secondary).lineLimit(2) }
            }
        }
        .padding(.vertical, 2)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
    }
}


/// Search across all three layers: Core's lines, the skills, the summaries
/// and every conversation's messages.
struct MemorySearchView: View {
    let store: MemoryStore
    var open: (BotShellItem) -> Void
    /// Ends the search on a layer.
    var show: (MemoryLayer) -> Void
    @State private var query = ""

    var body: some View {
        let words = MemoryHistory.words(query)
        List {
            ShellSearchField(text: $query, prompt: "Search memory", id: "memorySearchField", focusOnAppear: true)
                .listRowSeparator(.hidden)
            if !words.isEmpty {
                CoreMatches(store: store, words: words, show: show)
                SkillMatches(store: store, words: words)
                HistoryMatches(store: store, query: query, words: words, open: open)
            }
        }
        .listStyle(.plain)
        .task {
            store.loadCore()
            store.loadSkills()
            store.loadHistory()
        }
        .accessibilityIdentifier("memory-search")
    }
}

private struct CoreMatches: View {
    let store: MemoryStore
    let words: [String]
    var show: (MemoryLayer) -> Void

    var body: some View {
        let lines = (store.core.value?.skills ?? []).flatMap { skill in
            CoreText.split(skill.body).flatMap { section in
                section.text.split(separator: "\n").map { (section.heading, String($0)) }
            }
        }.filter { _, line in words.allSatisfy(line.lowercased().contains) }
        if !lines.isEmpty {
            Section("Core") {
                ForEach(Array(lines.enumerated()), id: \.offset) { _, match in
                    Button { show(.core) } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(match.0).font(.caption).foregroundStyle(.secondary)
                            Text(SummaryText.inline(match.1.replacing(/^\s*[-*+]\s+/, with: "")))
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }
}

private struct SkillMatches: View {
    let store: MemoryStore
    let words: [String]

    var body: some View {
        let skills = (store.skills.value ?? []).filter(\.listed).filter { skill in
            words.allSatisfy("\(skill.name) \(skill.description)".lowercased().contains)
        }
        if !skills.isEmpty {
            Section("Skills") {
                ForEach(skills) { skill in
                    Button { Router.shared.push(.memorySkill(botId: store.botId, name: skill.name)) } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(skill.name)
                            Text(skill.description).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                    .tint(.primary)
                    .accessibilityIdentifier("memorySkill-\(skill.name)")
                }
            }
        }
    }
}

private struct HistoryMatches: View {
    let store: MemoryStore
    let query: String
    let words: [String]
    var open: (BotShellItem) -> Void

    var body: some View {
        Section("History") {
            ConversationRows(store: store, query: query, words: words, open: open)
        }
    }
}
