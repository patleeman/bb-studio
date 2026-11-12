import SwiftUI

struct BotConversationContext {
    enum Kind: Equatable { case conversation, worker, reply }

    var threadId: String
    var kind: Kind
    var botId: String
    var botName: String
    var look: BotLook
    var mainThreadId: String?
    var conversation: BotConversation?
    var workers: WorkersLine
    var allWorkers: [BotWorker]
    var splitsThreads: Bool
    var push: (Route) -> Void
    var openConversation: (String) -> Void
    var showList: () -> Void
    var refresh: () -> Void

    func worker(_ threadId: String) -> WorkerInfo? {
        allWorkers.first { $0.threadId == threadId }.map { WorkerInfo($0, botName: botName, mainThreadId: mainThreadId) }
    }

    func isWorker(_ threadId: String) -> Bool {
        (kind == .worker && self.threadId == threadId) || allWorkers.contains { $0.threadId == threadId }
    }

    func reply(_ threadId: String, close: @escaping () -> Void) -> BotConversationContext {
        var context = self
        context.threadId = threadId
        context.kind = .reply
        context.conversation = nil
        context.workers = WorkersLine(conversationId: threadId, view: nil)
        let push = self.push, open = self.openConversation
        context.push = { route in
            close()
            push(route)
        }
        context.openConversation = { id in
            close()
            open(id)
        }
        return context
    }
}

private struct BotConversationKey: EnvironmentKey {
    static let defaultValue: BotConversationContext? = nil
}

extension EnvironmentValues {
    var botConversation: BotConversationContext? {
        get { self[BotConversationKey.self] }
        set { self[BotConversationKey.self] = newValue }
    }
}

struct ReplyThreadSheet: Identifiable {
    let id: String
}

struct ConversationReplyRow: View {
    let messageId: String
    let thread: BotSideThread?
    let look: BotLook?
    let open: () -> Void
    @ScaledMetric(relativeTo: .caption) private var iconSize: CGFloat = 13

    var body: some View {
        HStack(spacing: 2) {
            Button(action: open) {
                Image(systemName: "bubble.left.and.bubble.right")
                    .font(.system(size: iconSize))
                    .foregroundStyle(.secondary)
                    .frame(width: 32, height: 32)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(ConversationReplies.replyTitle)
            .accessibilityIdentifier("reply-in-thread-\(messageId)")
            if let thread {
                Button(action: open) {
                    TimelineView(.periodic(from: .now, by: 60)) { context in
                        HStack(spacing: 6) {
                            replier(thread)
                            Text(ConversationReplies.indicator(thread, now: context.date) ?? "")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(Color.accentColor)
                                .monospacedDigit()
                        }
                    }
                    .padding(.horizontal, 6)
                    .frame(minHeight: 32)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(ConversationReplies.indicator(thread) ?? "")
                .accessibilityAddTraits(.isButton)
                .accessibilityIdentifier("replies-\(messageId)")
            }
        }
        .padding(.leading, -8)
    }

    @ViewBuilder private func replier(_ thread: BotSideThread) -> some View {
        switch ConversationReplies.replier(thread) {
        case .bot:
            if let look { BotAvatar(look, size: 16) }
        case .you:
            Image(systemName: "person.crop.circle.fill")
                .font(.system(size: 15))
                .foregroundStyle(.secondary)
                .accessibilityLabel("You")
        case nil:
            EmptyView()
        }
    }
}

struct ConversationTitle: View {
    let title: String
    let model: String?
    let choose: () -> Void

    var body: some View {
        VStack(spacing: 1) {
            Text(title).font(.headline).lineLimit(1)
            Button(action: choose) {
                HStack(spacing: 3) {
                    Text(model ?? "Model").lineLimit(1)
                    Image(systemName: "chevron.down").font(.caption2.weight(.semibold))
                }
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 8)
                .padding(.vertical, 2)
                .background(.fill.tertiary, in: .capsule)
                .contentShape(.capsule)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Model: \(model ?? "unknown")")
            .accessibilityIdentifier("conversationModelChip")
        }
    }
}

struct WorkersLineView: View {
    let line: WorkersLine
    let open: (String) -> Void

    var body: some View {
        Menu {
            ForEach(line.workers) { worker in
                Button { open(worker.threadId) } label: {
                    Label(worker.title.isEmpty ? "Worker" : worker.title,
                          systemImage: worker.status == .needsYou ? "exclamationmark.circle" : "arrow.triangle.2.circlepath")
                }
            }
        } label: {
            HStack(spacing: 8) {
                HStack(spacing: 5) {
                    if line.needsYou { Circle().fill(.orange).frame(width: 8, height: 8) }
                    if line.running { ProgressView().controlSize(.mini).tint(.green) }
                }
                Text(line.label)
                Image(systemName: "chevron.right").font(.caption2.weight(.semibold))
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .padding(.leading, 12)
            .padding(.trailing, 14)
            .frame(height: 36)
            .glassEffect(.regular, in: .capsule)
            .contentShape(.capsule)
        }
        .tint(Color(uiColor: .secondaryLabel))
        .accessibilityLabel(line.label)
        .accessibilityIdentifier("conversationWorkers")
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct NewConversationSheet: View {
    let botName: String
    let start: (String) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var starting = false
    @State private var error: String?
    @FocusState private var focused: Bool

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                TextField("Message \(botName)", text: $text, axis: .vertical)
                    .lineLimit(3...10)
                    .focused($focused)
                    .padding(12)
                    .background(.fill.tertiary, in: .rect(cornerRadius: 18))
                    .accessibilityIdentifier("newConversationField")
                if let error {
                    Text(error).font(.footnote).foregroundStyle(.red)
                }
                Spacer(minLength: 0)
            }
            .padding(16)
            .navigationTitle("New conversation")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if starting {
                        ProgressView()
                    } else {
                        Button("Start") { run() }
                            .disabled(trimmed.isEmpty)
                            .keyboardShortcut(.return, modifiers: .command)
                            .accessibilityIdentifier("newConversationStart")
                    }
                }
            }
            .onAppear { focused = true }
        }
        .presentationDetents([.medium, .large])
    }

    private func run() {
        let message = trimmed
        guard !message.isEmpty else { return }
        starting = true
        error = nil
        Task {
            do {
                try await start(message)
                dismiss()
            } catch {
                self.error = error.localizedDescription
            }
            starting = false
        }
    }
}

struct WorkerTitle: View {
    let info: WorkerInfo

    var body: some View {
        VStack(spacing: 1) {
            Text(info.displayTitle).font(.headline).lineLimit(1)
            TimelineView(.periodic(from: .now, by: 60)) { context in
                HStack(spacing: 5) {
                    BotWorkerGlyph(status: info.status).accessibilityHidden(true)
                    Text(info.headerLabel(now: context.date)).lineLimit(1)
                }
                .font(.caption)
                .foregroundStyle(info.status == .needsYou ? AnyShapeStyle(.orange) : AnyShapeStyle(.secondary))
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(info.displayTitle), \(info.stateLabel)")
        .accessibilityValue(info.status.rawValue)
        .accessibilityIdentifier("workerTitle")
    }
}

struct WorkerAskLine: View {
    let info: WorkerInfo
    let look: BotLook
    let openOwner: () -> Void
    let answerHere: (() -> Void)?

    var body: some View {
        HStack(spacing: 6) {
            HStack(spacing: 5) {
                BotAvatar(look, size: 16)
                Text(info.botName).lineLimit(1)
            }
            .modifier(WorkerChip())
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("workerBot")
            if let owner = info.owner {
                Button(action: openOwner) {
                    HStack(spacing: 4) {
                        Image(systemName: "bubble.left").font(.caption)
                        Text(owner.title).lineLimit(1)
                        Image(systemName: "chevron.right").font(.caption2.weight(.semibold))
                    }
                    .modifier(WorkerChip())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Open \(owner.title)")
                .accessibilityIdentifier("workerOwner")
            }
            if let branch = info.branch {
                HStack(spacing: 4) {
                    Image(systemName: "arrow.triangle.branch").font(.caption)
                    Text(branch).font(.footnote.monospaced()).lineLimit(1).truncationMode(.middle)
                }
                .modifier(WorkerChip())
                .layoutPriority(-1)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Branch \(branch)")
            }
            if let answerHere {
                Button("Answer it here", action: answerHere)
                    .font(.footnote.weight(.semibold))
                    .padding(.horizontal, 4)
                    .accessibilityIdentifier("workerAnswerHere")
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct WorkerChip: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(.footnote)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 10)
            .frame(height: 30)
            .glassEffect(.regular, in: .capsule)
            .contentShape(.capsule)
    }
}
