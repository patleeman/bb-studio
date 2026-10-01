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
        guard let match = text.firstMatch(of: /(?:^|\s)\/([^\s\/]{0,80})$/) else { return nil }
        return String(match.1)
    }
}
