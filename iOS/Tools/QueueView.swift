import SwiftUI

/// Every message not sent yet, across all threads: scheduled sends,
/// automatic retries, and messages waiting on a busy thread or offline host.
struct QueueView: View {
    @EnvironmentObject private var app: AppModel
    @State private var messages: [QueuedMessage] = []
    @State private var loaded = false
    @State private var error: String?
    @State private var done = 0
    private var titles: [String: String] { ThreadTitles.titles }

    var body: some View {
        List {
            if let error {
                Section { ConnectionBanner(message: error) { await load() } }
            }
            section("Drafts", messages.filter(\.isDraft))
            section("Scheduled", messages.filter { !$0.isRetry && $0.waitingOn?.kind == "time" })
            section("Retries", messages.filter(\.isRetry))
            section("Waiting", messages.filter { !$0.isRetry && !$0.isDraft && $0.waitingOn?.kind != "time" })
        }
        .overlay {
            if !loaded {
                ProgressView()
            } else if messages.isEmpty, error == nil {
                ContentUnavailableView("Nothing queued", systemImage: "tray",
                    description: Text("Drafts, scheduled messages and automatic retries show here."))
            }
        }
        .navigationTitle("Queue")
        .refreshable { await load() }
        .task {
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(for: .seconds(20))
            }
        }
        .sensoryFeedback(.success, trigger: done)
    }

    @ViewBuilder
    private func section(_ title: String, _ rows: [QueuedMessage]) -> some View {
        if !rows.isEmpty {
            Section(title) {
                ForEach(rows) { message in
                    Button {
                        if let thread = message.threadId { app.path.append(.thread(id: thread)) }
                    } label: {
                        QueuedRow(message: message, threadTitle: message.threadId.flatMap { titles[$0] })
                    }
                    .foregroundStyle(.primary)
                    .swipeActions(edge: .leading) {
                        Button { Task { await act(message) { try await $0.sendQueuedNow($1, message.id, mode: "auto") } } } label: {
                            Label(message.isRetry ? "Retry now" : "Send now", systemImage: "arrow.up.circle")
                        }
                        .tint(.accentColor)
                    }
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) { Task { await act(message) { try await $0.deleteQueued($1, message.id) } } } label: {
                            Label(message.isRetry ? "Cancel retry" : "Delete", systemImage: "trash")
                        }
                    }
                    .contextMenu {
                        Button { Task { await act(message) { try await $0.sendQueuedNow($1, message.id, mode: "auto") } } } label: {
                            Label(message.isRetry ? "Retry now" : "Send now", systemImage: "arrow.up.circle")
                        }
                        Button { UIPasteboard.general.string = message.text } label: { Label("Copy", systemImage: "doc.on.doc") }
                        Button(role: .destructive) { Task { await act(message) { try await $0.deleteQueued($1, message.id) } } } label: {
                            Label(message.isRetry ? "Cancel retry" : "Delete", systemImage: "trash")
                        }
                    }
                }
            }
        }
    }

    private func load() async {
        do {
            messages = try await app.client.allQueuedMessages().sorted { ($0.sendAt ?? .infinity) < ($1.sendAt ?? .infinity) }
            error = nil
            for id in Set(messages.compactMap(\.threadId)) where titles[id] == nil {
                if let thread = try? await app.client.thread(id) { ThreadTitles.set(id, thread.displayTitle) }
            }
        } catch where BBClient.isCancellation(error) {
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
        loaded = true
    }

    private func act(_ message: QueuedMessage, _ action: (BBClient, String) async throws -> Void) async {
        guard let thread = message.threadId else { return }
        do {
            try await action(app.client, thread)
            messages.removeAll { $0.id == message.id }
            done += 1
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
        await load()
    }
}

struct QueuedRow: View {
    let message: QueuedMessage
    let threadTitle: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            if let threadTitle {
                Text(threadTitle).font(.caption.weight(.semibold)).foregroundStyle(.secondary).lineLimit(1)
            }
            Text(message.text.isEmpty ? "Attachment" : message.text).lineLimit(3)
            Label(message.status, systemImage: icon)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var icon: String {
        if message.isRetry { return "arrow.clockwise" }
        if message.isDraft { return "doc.text" }
        switch message.waitingOn?.kind {
        case "time": return "clock"
        case "host-offline": return "desktopcomputer"
        default: return "hourglass"
        }
    }
}
