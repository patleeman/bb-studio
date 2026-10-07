import SwiftUI
import WatchKit

@main
struct BBStudioWatchApp: App {
    @StateObject private var model = WatchModel.shared
    var body: some Scene {
        WindowGroup {
            NavigationStack { WatchInboxView() }.id(model.client.baseURL)
        }
    }
}

struct WatchInboxView: View {
    @ObservedObject private var model = WatchModel.shared
    @Environment(\.scenePhase) private var scenePhase
    private struct LoadKey: Hashable { let selection: UUID; let active: Bool }

    var body: some View {
        List {
            if let error = model.error {
                Text(error).font(.footnote).foregroundStyle(.red)
                Button("Retry") { Task { await model.load() } }
                    .disabled(model.loading)
            }
            ForEach(model.threads.prefix(30)) { thread in
                NavigationLink {
                    WatchThreadView(threadId: thread.id, title: thread.displayTitle)
                } label: {
                    HStack(alignment: .top, spacing: 6) {
                        Circle()
                            .fill(thread.needsAttention ? .orange : thread.isRunning ? .blue : thread.isUnread ? .white : .clear)
                            .frame(width: 7, height: 7)
                            .padding(.top, 6)
                        Text(thread.displayTitle).lineLimit(2)
                    }
                }
            }
        }
        .navigationTitle("BB")
        .overlay { if model.loading && model.threads.isEmpty { ProgressView() } }
        .task(id: LoadKey(selection: model.serverSelection, active: scenePhase == .active)) {
            guard scenePhase == .active else { return }
            await model.load()
        }
        .refreshable { await model.load() }
    }
}

struct WatchThreadView: View {
    let threadId: String
    let title: String
    @State private var rows: [TimelineRow] = []
    @State private var thread: ThreadEntry?
    @State private var interactions: [PendingInteraction] = []
    @State private var reply = ""
    @State private var status: String?
    /// Why the thread couldn't load, when nothing has loaded.
    @State private var loadError: String?
    /// BB says the thread doesn't exist: deleted since the list or notification.
    @State private var gone = false
    @Environment(\.scenePhase) private var scenePhase
    private let client = WatchModel.shared.client

    private static let quickReplies = ["Yes", "No", "Continue", "Looks good"]

    var body: some View {
        if gone {
            VStack(spacing: 6) {
                Image(systemName: "questionmark.bubble").font(.title3).foregroundStyle(.secondary)
                Text("This thread no longer exists.").font(.footnote).multilineTextAlignment(.center)
            }
            .navigationTitle(title)
        } else {
            threadList
        }
    }

    private var threadList: some View {
        List {
            if let loadError, rows.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text(loadError).font(.footnote).foregroundStyle(.red)
                    Button("Retry") { Task { await load() } }
                }
            }
            ForEach(rows) { row in
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.isUser ? "You" : "Agent").font(.caption2).foregroundStyle(.secondary)
                    Text(LocalizedStringKey(row.text ?? "")).font(.footnote)
                }
                .listRowBackground(row.isUser ? Color.accentColor.opacity(0.25) : nil)
            }
            ForEach(interactions) { interaction in
                Section { WatchInteraction(interaction: interaction, answer: answer) }
            }
            if thread?.isRunning == true && interactions.isEmpty {
                HStack {
                    ProgressView().frame(width: 20)
                    Text("Working…").font(.footnote)
                    Spacer()
                    Button { Task { try? await client.stop(threadId) } } label: { Image(systemName: "stop.fill") }
                        .buttonStyle(.plain)
                }
            }
            Section {
                TextField("Reply", text: $reply)
                    .onSubmit { send(reply, clearsDraft: true) }
                ForEach(Self.quickReplies, id: \.self) { text in
                    Button(text) { send(text) }
                }
            }
            if let status { Text(status).font(.caption2).foregroundStyle(.secondary) }
        }
        .navigationTitle(title)
        // No socket on the watch: poll while the view is open and the wrist is up.
        // Each poll relays through the phone, so it costs both batteries.
        .task(id: scenePhase == .active) {
            guard scenePhase == .active else { return }
            await load()
            guard !gone else { return }
            try? await client.markRead(threadId)
            while !Task.isCancelled, !gone {
                try? await Task.sleep(for: .seconds(thread?.isRunning == true ? 8 : 30))
                guard !Task.isCancelled else { return }
                await load()
            }
        }
    }

    private func load() async {
        async let page = client.timeline(threadId, segments: 3)
        async let detail = client.thread(threadId)
        do {
            let page = try await page
            rows = Array(page.rows.filter { $0.isConversation && !($0.text ?? "").isEmpty }.suffix(6))
            loadError = nil
        } catch where !BBClient.isCancellation(error) {
            loadError = BBClient.describe(error, server: client.baseURL)
        } catch {}
        do {
            thread = try await detail
        } catch let error as BBError where error.status == 404 {
            gone = true
            return
        } catch {}
        interactions = (try? await client.interactions(threadId))?.filter { $0.status == "pending" } ?? interactions
    }

    private func answer(_ interaction: PendingInteraction, _ resolution: JSONValue) {
        status = "Sending…"
        Task {
            do {
                try await client.settle(interaction, resolution)
                interactions.removeAll { $0.id == interaction.id }
                status = nil
                WKInterfaceDevice.current().play(.success)
                await load()
            } catch {
                status = error.localizedDescription
                WKInterfaceDevice.current().play(.failure)
            }
        }
    }

    private func send(_ text: String, clearsDraft: Bool = false) {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        let submittedDraft = reply
        let sendsDraft = clearsDraft && submittedDraft.trimmingCharacters(in: .whitespacesAndNewlines) == text
        status = "Sending…"
        Task {
            do {
                try await client.send(threadId, text: text)
                if sendsDraft && reply == submittedDraft { reply = "" }
                status = nil
                await load()
            } catch {
                status = error.localizedDescription
            }
        }
    }
}

/// An approval or question, answerable from the wrist. Multi-part questions reply as text.
struct WatchInteraction: View {
    let interaction: PendingInteraction
    let answer: (PendingInteraction, JSONValue) -> Void
    @State private var text = ""

    var body: some View {
        Label(interaction.allQuestions != nil ? "Question" : "Needs approval", systemImage: "hand.raised.fill")
            .font(.caption2)
            .foregroundStyle(.orange)
        if interaction.payload.kind == "approval" {
            Text(interaction.payload.subject?.command ?? interaction.payload.subject?.plan ?? interaction.summary)
                .font(.footnote)
                .lineLimit(6)
            ForEach(interaction.decisions, id: \.self) { decision in
                Button(approvalLabel(decision, subjectKind: interaction.payload.subject?.kind)) {
                    answer(interaction, interaction.approvalResolution(decision))
                }
                .foregroundStyle(decision == "deny" ? .red : .green)
            }
        } else if let questions = interaction.allQuestions {
            Text(questions.map(\.prompt).joined(separator: "\n")).font(.footnote)
            if questions.count == 1, let question = questions.first, !question.multiSelect {
                ForEach(question.options ?? [], id: \.value) { option in
                    Button(option.label) {
                        answer(interaction, interaction.answer([question.id: InteractionAnswer(selected: [option.value])]))
                    }
                }
            }
            if questions.allSatisfy(\.allowFreeText) {
                TextField("Answer", text: $text).onSubmit {
                    if let resolution = interaction.textAnswer(text) { answer(interaction, resolution) }
                }
            }
        } else {
            Text("\(interaction.summary) — answer on your phone.").font(.footnote)
        }
    }
}
