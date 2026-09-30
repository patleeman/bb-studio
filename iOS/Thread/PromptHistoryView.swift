import SwiftUI

/// Prompts sent in this thread before, newest first. Picking one puts it in
/// the composer to send again or adjust.
struct PromptHistoryView: View {
    @EnvironmentObject private var app: AppModel
    let threadId: String
    let pick: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var entries: [PromptHistoryEntry] = []
    @State private var loaded = false
    @State private var error: String?
    @State private var query = ""

    var body: some View {
        NavigationStack {
            List {
                if let error {
                    Text(error).font(.footnote).foregroundStyle(.red)
                }
                ForEach(shown) { entry in
                    Button { pick(entry.text) } label: {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(entry.text).lineLimit(4)
                            Text(Date(timeIntervalSince1970: entry.createdAt / 1000), format: .relative(presentation: .named))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .foregroundStyle(.primary)
                }
            }
            .overlay {
                if !loaded {
                    ProgressView()
                } else if shown.isEmpty, error == nil {
                    ContentUnavailableView(query.isEmpty ? "No prompts yet" : "No matches", systemImage: "clock.arrow.circlepath")
                }
            }
            .searchable(text: $query, prompt: "Search prompts")
            .navigationTitle("Recent prompts")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Done") { dismiss() } }
            .task {
                do {
                    entries = try await app.client.promptHistory(threadId).filter { !$0.text.isEmpty }
                } catch {
                    self.error = BBClient.describe(error, server: app.client.baseURL)
                }
                loaded = true
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var shown: [PromptHistoryEntry] {
        query.isEmpty ? entries : entries.filter { $0.text.localizedCaseInsensitiveContains(query) }
    }
}
