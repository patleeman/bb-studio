import SwiftUI

struct ThreadContextView: View {
    let threadId: String
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var report: ThreadContextReport?
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                if let usage = report?.usage {
                    Section {
                        contextRow(usage.estimated ? "Estimated context" : "Context window",
                            "\(usage.usedTokens.formatted()) / \(usage.modelContextWindow.formatted()) tokens")
                    }
                    if let snapshot = usage.snapshot {
                        Section {
                            contextRow("Captured", captureDate(snapshot.capturedAt))
                        }
                        ForEach(snapshot.categories, id: \.label) { category in
                            Section(category.kind == "used" ? category.label : "\(category.label) (\(category.kind))") {
                                contextRow("Total", category.tokens.formatted())
                                ForEach(category.entries, id: \.label) { entry in
                                    contextRow(entry.label, entry.tokens.formatted())
                                }
                            }
                        }
                    }
                } else if let errorMessage {
                    ContentUnavailableView("Context unavailable", systemImage: "exclamationmark.triangle", description: Text(errorMessage))
                } else if report != nil {
                    ContentUnavailableView("No context usage yet", systemImage: "chart.bar")
                } else {
                    ProgressView()
                }
            }
            .navigationTitle("Context usage")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Done") { dismiss() } }
        }
        .task {
            do { report = try await app.client.threadContext(threadId) }
            catch { errorMessage = BBClient.describe(error, server: app.client.baseURL) }
        }
    }

    private func contextRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
            Spacer()
            Text(value).foregroundStyle(.secondary)
        }
    }

    private func captureDate(_ value: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value)?.formatted(date: .abbreviated, time: .shortened) ?? value
    }
}
