import SwiftUI

/// What `@` offers while typing: threads by title, then bots and other
/// plugin items from BB's mention search.
struct MentionSuggestions: View {
    let query: String
    let threadId: String
    let projectId: String?
    let pick: (Mention) -> Void
    @EnvironmentObject private var app: AppModel
    @State private var threads = Self.recent[ServerScope.selectedURL] ?? []
    @State private var groups: [MentionResults.Group] = []

    private struct Suggestion: Identifiable {
        let id: String
        let icon: String
        let title: String
        let subtitle: String?
        let mention: Mention
    }

    var body: some View {
        let suggestions = self.suggestions
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(suggestions) { suggestion in
                    Button { pick(suggestion.mention) } label: {
                        HStack(spacing: 10) {
                            Image(systemName: suggestion.icon)
                                .foregroundStyle(.secondary)
                                .frame(width: 20)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(suggestion.title).lineLimit(1)
                                if let subtitle = suggestion.subtitle {
                                    Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                }
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("mention")
                }
            }
        }
        .frame(maxHeight: min(CGFloat(suggestions.count) * 46, 200))
        .scrollBounceBehavior(.basedOnSize)
        .background(.fill.tertiary, in: .rect(cornerRadius: 14))
        .opacity(suggestions.isEmpty ? 0 : 1)
        .task {
            let client = app.client
            guard let fresh = try? await client.threads() else { return }
            Self.recent[client.baseURL] = fresh
            threads = fresh
        }
        .task(id: query) {
            try? await Task.sleep(for: .milliseconds(150))
            guard !Task.isCancelled else { return }
            groups = (try? await app.client.mentionSearch(query, projectId: projectId, threadId: threadId).groups) ?? groups
        }
    }

    private var suggestions: [Suggestion] {
        let matching = threads.filter { thread in
            thread.id != threadId && thread.archivedAt == nil
                && (query.isEmpty || thread.displayTitle.localizedStandardContains(query))
        }
        let threadSuggestions = matching.sorted { $0.updatedAt > $1.updatedAt }.prefix(4).map { thread in
            let title = ThreadTitles.resolve(thread.displayTitle)
            return Suggestion(
                id: thread.id, icon: Symbols.thread, title: title, subtitle: "Thread",
                mention: .thread(thread.id, projectId: thread.projectId, label: title))
        }
        let pluginSuggestions = groups.flatMap { group in
            group.items.prefix(4).map { item in
                Suggestion(
                    id: "\(group.pluginId):\(item.itemId)", icon: Self.icon(group.providerId), title: item.title,
                    subtitle: item.subtitle ?? group.label, mention: .plugin(group.pluginId, item))
            }
        }
        return threadSuggestions + pluginSuggestions
    }

    private static func icon(_ provider: String) -> String {
        if provider == "bots" { return "person.crop.circle" }
        // Providers are named for their Studio kind ("page", "table"), some in the plural ("recordings").
        let kind = provider.hasSuffix("s") ? String(provider.dropLast()) : provider
        return StudioKind.known.first { $0.id == provider || $0.id == kind }?.symbol ?? "at"
    }

    /// The last thread list, so suggestions show at once the next time.
    @MainActor private static var recent: [URL: [ThreadEntry]] = [:]

    /// The `@word` being typed at the end of `text`, without the `@`.
    static func query(in text: String) -> String? {
        guard let match = text.firstMatch(of: /(?:^|\s)@([^\s@]{0,40})$/) else { return nil }
        return String(match.1)
    }
}
