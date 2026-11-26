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
    var push: (Route) -> Void
    var openConversation: (String) -> Void
    var showList: () -> Void
    var refresh: () -> Void
    /// The Bot is paused or stopped (`bot_spaces` state); "stopped" or "paused", nil while active.
    var botPause: String? = nil

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
    /// Opens a fork made at this message; its "Forked here" line shows when set.
    var openFork: ((String) -> Void)? = nil

    var body: some View {
        HStack(spacing: 2) {
            if let thread, ConversationReplies.indicator(thread) != nil {
                Button(action: open) {
                    TimelineView(.periodic(from: .now, by: 60)) { context in
                        HStack(spacing: 6) {
                            if !thread.working { replier(thread) }
                            Text(ConversationReplies.indicator(thread, now: context.date) ?? "")
                                .font(.caption.weight(.medium))
                                .foregroundStyle(Color.accentColor)
                                .monospacedDigit()
                        }
                    }
                    .padding(.horizontal, 10)
                    .frame(minHeight: 28)
                    .background(Color.accentColor.opacity(0.12), in: .capsule)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                    .padding(.vertical, -8)
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(ConversationReplies.indicator(thread) ?? "")
                .accessibilityAddTraits(.isButton)
                .accessibilityIdentifier("replies-\(messageId)")
            }
            if let openFork, let fork = thread?.fork, let label = ConversationReplies.forkIndicator(thread) {
                Button { openFork(fork.threadId) } label: {
                    Text(label)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(Color.accentColor)
                        .padding(.horizontal, 6)
                        .frame(minHeight: 32)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("forked-\(messageId)")
            }
        }
    }

    static func shows(_ thread: BotSideThread?, forks: Bool) -> Bool {
        guard let thread else { return false }
        return ConversationReplies.indicator(thread) != nil || (forks && ConversationReplies.forkIndicator(thread) != nil)
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
