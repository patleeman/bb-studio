import SwiftUI
import WatchKit

@main
struct BBGoWatchApp: App {
    var body: some Scene {
        WindowGroup {
            NavigationStack { WatchInboxView() }
        }
    }
}

struct WatchInboxView: View {
    @ObservedObject private var model = WatchModel.shared

    var body: some View {
        List {
            if let error = model.error {
                Text(error).font(.footnote).foregroundStyle(.red)
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
            if !model.bots.isEmpty {
                Section("Bots") {
                    ForEach(model.bots, id: \.bot.id) { entry in
                        NavigationLink {
                            WatchThreadView(threadId: entry.thread.threadId, title: entry.bot.name)
                        } label: {
                            Text("\(entry.bot.avatar ?? "🤖") \(entry.bot.name)")
                        }
                    }
                }
            }
        }
        .navigationTitle("BB")
        .overlay { if model.loading && model.threads.isEmpty { ProgressView() } }
        .task { await model.load() }
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
    private var client: BBClient { WatchModel.shared.client }

    private static let quickReplies = ["Yes", "No", "Continue", "Looks good"]

    var body: some View {
        List {
            ForEach(rows) { row in
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.isUser ? "You" : "Agent").font(.caption2).foregroundStyle(.secondary)
                    Text(LocalizedStringKey(row.text ?? "")).font(.footnote)
                }
                .listRowBackground(row.isUser ? Color.blue.opacity(0.25) : nil)
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
                    .onSubmit { send(reply) }
                ForEach(Self.quickReplies, id: \.self) { text in
                    Button(text) { send(text) }
                }
            }
            if let status { Text(status).font(.caption2).foregroundStyle(.secondary) }
        }
        .navigationTitle(title)
        .task {
            await load()
            try? await client.markRead(threadId)
            // No socket on the watch: poll while the view is open.
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(thread?.isRunning == true ? 4 : 15))
                await load()
            }
        }
    }

    private func load() async {
        async let page = client.timeline(threadId, segments: 3)
        async let detail = client.thread(threadId)
        if let page = try? await page {
            rows = Array(page.rows.filter { $0.isConversation && !($0.text ?? "").isEmpty }.suffix(6))
        }
        thread = (try? await detail) ?? thread
        interactions = (try? await client.interactions(threadId))?.filter { $0.status == "pending" } ?? interactions
    }

    private func answer(_ interaction: PendingInteraction, _ resolution: JSONValue) {
        status = "Sending…"
        Task {
            do {
                try await client.resolve(interaction, resolution)
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

    private func send(_ text: String) {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        reply = ""
        status = "Sending…"
        Task {
            do {
                try await client.send(threadId, text: text)
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
        Label(interaction.payload.kind == "user_question" ? "Question" : "Needs approval", systemImage: "hand.raised.fill")
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
        } else if interaction.payload.kind == "user_question", let questions = interaction.payload.questions {
            Text(questions.map(\.prompt).joined(separator: "\n")).font(.footnote)
            if questions.count == 1, let question = questions.first, !question.multiSelect {
                ForEach(question.options ?? [], id: \.value) { option in
                    Button(option.label) {
                        answer(
                            interaction,
                            PendingInteraction.answerResolution([question.id: InteractionAnswer(selected: [option.value])]))
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
