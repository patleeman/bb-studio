import SwiftUI

struct CommandSuggestions: View {
    let query: String
    let projectId: String
    let providerId: String
    let environmentId: String?
    let pick: (Mention) -> Void
    @EnvironmentObject private var app: AppModel
    @State private var commands: [ComposerCommand] = []

    var body: some View {
        let matching = commands.filter {
            query.isEmpty || $0.name.localizedStandardContains(query) ||
                ($0.description?.localizedStandardContains(query) ?? false)
        }
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(matching, id: \.self) { command in
                    Button { pick(command.mention) } label: {
                        HStack(spacing: 10) {
                            Image(systemName: command.source == "skill" ? "sparkles" : "terminal")
                                .foregroundStyle(.secondary).frame(width: 20)
                            VStack(alignment: .leading, spacing: 1) {
                                Text("/\(command.name)").lineLimit(1)
                                if let description = command.description {
                                    Text(description).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                }
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 12).padding(.vertical, 7).contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("composerCommand")
                }
            }
        }
        .frame(maxHeight: min(CGFloat(matching.count) * 46, 200))
        .scrollBounceBehavior(.basedOnSize)
        .background(.fill.tertiary, in: .rect(cornerRadius: 14))
        .opacity(matching.isEmpty ? 0 : 1)
        .task(id: "\(projectId):\(providerId):\(environmentId ?? "")") {
            commands = (try? await app.client.composerCommands(
                projectId: projectId, providerId: providerId, environmentId: environmentId)) ?? []
        }
    }

    static func query(in text: String) -> String? {
        word(in: text, after: "/", limit: 80)
    }

    /// The word being typed at the end of `text`, when it starts with
    /// `marker`, without it. Only the last word is read, and no regex is
    /// built: the composer asks on each key, however long the draft.
    static func word(in text: String, after marker: Character, limit: Int) -> String? {
        let start = text.lastIndex(where: \.isWhitespace).map(text.index(after:)) ?? text.startIndex
        let word = text[start...]
        guard word.first == marker else { return nil }
        let query = word.dropFirst()
        guard query.count <= limit, !query.contains(marker) else { return nil }
        return String(query)
    }
}
