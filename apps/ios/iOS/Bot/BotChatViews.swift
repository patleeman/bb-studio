import SwiftUI

// MARK: The Bot's chat, row by row

/// The Bot's chat timeline: day separators, the Bot's replies on the left with
/// its avatar on the first of a run, yours on the right, work folded away and
/// the threads it starts as small cards.
struct BotChatTimeline: View {
    let bot: BotInfo
    let rows: [TimelineRow]
    let threadId: String
    let projectId: String?
    let running: Bool
    let thinking: String?
    /// Threads the Bot started, by id, for their cards' titles and status.
    let started: [String: BotActivity.Thread]
    var react: (String) -> Void
    var quote: (String) -> Void
    var select: (String) -> Void
    var edit: ((String) -> Void)?
    var editableId: String?
    var openThread: (String) -> Void

    var body: some View {
        let entries = BotChatEntry.build(rows, botThreadId: threadId)
        ForEach(entries) { entry in
            switch entry {
            case .day(let date, _):
                BotDaySeparator(date: date)
            case .message(let row, let first, let last):
                BotMessageRow(
                    bot: bot, row: row, first: first, last: last, projectId: projectId,
                    react: react, quote: quote, select: select,
                    edit: row.id == editableId ? edit : nil)
            case .work(let rows):
                BotWorkRow(rows: rows)
            case .child(let id, _):
                BotChildCard(threadId: id, info: started[id]) { openThread(id) }
            }
        }
    }
}

/// "Today", centered and quiet.
struct BotDaySeparator: View {
    let date: Date

    var body: some View {
        Text(BotChatEntry.dayLabel(date))
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .frame(maxWidth: .infinity)
            .padding(.top, 10)
            .accessibilityAddTraits(.isHeader)
    }
}

/// One message. The Bot's sit in a soft bubble on the left; yours in its
/// color on the right.
struct BotMessageRow: View {
    let bot: BotInfo
    let row: TimelineRow
    let first: Bool
    let last: Bool
    var projectId: String?
    var react: (String) -> Void
    var quote: (String) -> Void
    var select: (String) -> Void
    var edit: ((String) -> Void)?
    @EnvironmentObject private var app: AppModel

    private static let avatarSize: CGFloat = 28
    private var text: String { row.text ?? "" }
    private var tint: Color { BotPalette.color(bot.color) }

    var body: some View {
        Group {
            if row.isUser { user } else { reply }
        }
        .padding(.top, first ? 8 : 0)
    }

    private var user: some View {
        VStack(alignment: .trailing, spacing: 6) {
            if row.hasAttachments {
                MessageBubble(row: TimelineRow.attachmentsOnly(row), projectId: projectId)
            }
            if !text.isEmpty {
                ClampedText(text: text)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .background(userFill, in: bubbleShape(mine: true))
                    .contentShape(.contextMenuPreview, bubbleShape(mine: true))
                    .contextMenu { menu }
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.leading, 56)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("You: \(plainText)")
    }

    /// Your messages in the Bot's color, deepened so white text reads.
    private var userFill: some ShapeStyle {
        LinearGradient(colors: [tint, tint.mix(with: .black, by: 0.18)], startPoint: .top, endPoint: .bottom)
    }

    private var reply: some View {
        HStack(alignment: .bottom, spacing: 8) {
            Group {
                if last { BotAvatar(bot.look, size: Self.avatarSize) } else { Color.clear }
            }
            .frame(width: Self.avatarSize, height: Self.avatarSize)
            VStack(alignment: .leading, spacing: 4) {
                if first {
                    Text(bot.name).font(.caption.weight(.medium)).foregroundStyle(.secondary)
                        .padding(.leading, 12)
                        .accessibilityHidden(true)
                }
                MarkdownText(text)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(Color(uiColor: .secondarySystemBackground), in: bubbleShape(mine: false))
                    .contentShape(.contextMenuPreview, bubbleShape(mine: false))
                    .contextMenu { menu }
                let reactions = Directive.reactions(in: text)
                if !reactions.isEmpty { ReactionChips(items: reactions, react: react).padding(.top, 4) }
            }
            Spacer(minLength: 24)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(bot.name): \(plainText)")
    }

    /// Bubbles in a run tuck their corners on the side of the sender.
    private func bubbleShape(mine: Bool) -> UnevenRoundedRectangle {
        let big: CGFloat = 20, small: CGFloat = 6
        return mine
            ? UnevenRoundedRectangle(topLeadingRadius: big, bottomLeadingRadius: big, bottomTrailingRadius: last ? big : small, topTrailingRadius: first ? big : small, style: .continuous)
            : UnevenRoundedRectangle(topLeadingRadius: first ? big : small, bottomLeadingRadius: last ? small : small, bottomTrailingRadius: big, topTrailingRadius: big, style: .continuous)
    }

    private var plainText: String {
        text.components(separatedBy: "\n")
            .filter { Directive(line: $0.trimmingCharacters(in: .whitespaces)) == nil }
            .joined(separator: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    @ViewBuilder
    private var menu: some View {
        if let createdAt = row.createdAt { Section { Text(MessageBubble.sentLabel(createdAt)) } }
        Button { UIPasteboard.general.string = plainText } label: { Label("Copy", systemImage: "doc.on.doc") }
        Button { select(plainText) } label: { Label("Select Text", systemImage: "selection.pin.in.out") }
        Button { quote(plainText) } label: { Label("Quote", systemImage: "text.quote") }
        if let edit { Button { edit(plainText) } label: { Label("Edit", systemImage: "pencil") } }
        ShareLink(item: plainText) { Label("Share", systemImage: "square.and.arrow.up") }
    }
}

extension TimelineRow {
    /// The row with its text dropped, to draw only its attachments.
    static func attachmentsOnly(_ row: TimelineRow) -> TimelineRow {
        var copy = row
        copy.text = nil
        return copy
    }
}

/// Tool calls folded into one quiet row: "Working… · 3 steps", then a summary
/// once done. Expands to the steps.
struct BotWorkRow: View {
    let rows: [TimelineRow]
    @State private var expanded = false

    private var steps: Int { rows.filter { $0.kind == "work" }.count }
    private var running: Bool { rows.contains { ["inProgress", "running", "pending"].contains($0.status ?? "") } }
    private var failed: Bool { rows.contains { $0.status == "failed" || $0.status == "error" } }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                withAnimation(.snappy) { expanded.toggle() }
            } label: {
                HStack(spacing: 6) {
                    if running {
                        ProgressView().controlSize(.mini)
                    } else {
                        Image(systemName: failed ? "exclamationmark.triangle.fill" : "sparkles")
                            .foregroundStyle(failed ? AnyShapeStyle(.orange) : AnyShapeStyle(.tertiary))
                    }
                    Text(summary).lineLimit(1)
                    Image(systemName: "chevron.right")
                        .font(.caption2.weight(.semibold))
                        .rotationEffect(.degrees(expanded ? 90 : 0))
                        .foregroundStyle(.tertiary)
                }
                .font(.footnote)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(.fill.quaternary, in: .capsule)
                .contentShape(.capsule)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(summary)
            .accessibilityHint(expanded ? "Hides the steps" : "Shows the steps")
            if expanded {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(rows) { ActivityStep(row: $0) }
                }
                .padding(12)
                .background(.fill.quinary, in: .rect(cornerRadius: 14))
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding(.leading, 36)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var summary: String {
        let count = steps == 0 ? "" : " · \(steps) step\(steps == 1 ? "" : "s")"
        if running { return "Working…\(count)" }
        if failed { return "Hit a snag\(count)" }
        return steps == 0 ? "Thought it through" : "Worked\(count)"
    }
}

/// A thread the Bot started: its title and whether it's still running.
struct BotChildCard: View {
    let threadId: String
    let info: BotActivity.Thread?
    let open: () -> Void
    @EnvironmentObject private var app: AppModel
    @State private var thread: ThreadEntry?

    private var title: String { info?.title ?? thread?.displayTitle ?? "A thread" }
    private var needsYou: Bool { info?.needsYou ?? (thread?.hasPendingInteraction == true) }
    private var running: Bool { info.map { ["running", "active", "pending", "inProgress", "starting"].contains($0.status) } ?? (thread?.isRunning == true) }
    private var status: String { needsYou ? "needs you" : running ? "running" : "finished" }

    var body: some View {
        Button(action: open) {
            HStack(spacing: 10) {
                Image(systemName: "arrow.triangle.branch")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 28, height: 28)
                    .background(.fill.tertiary, in: .circle)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Started “\(title)”").font(.subheadline.weight(.medium)).lineLimit(1)
                    HStack(spacing: 4) {
                        Circle().fill(needsYou ? Color.orange : running ? .green : .secondary).frame(width: 6, height: 6)
                        Text(status.prefix(1).uppercased() + status.dropFirst()).font(.caption).foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(Color(uiColor: .secondarySystemBackground), in: .rect(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(.separator.opacity(0.5)))
        }
        .buttonStyle(.plain)
        .padding(.leading, 36)
        .padding(.trailing, 40)
        .accessibilityLabel("Started \(title), \(status)")
        .accessibilityHint("Opens the thread")
        .task(id: threadId) {
            guard info == nil else { return }
            thread = try? await app.client.thread(threadId)
        }
    }
}

/// Three dots that breathe while the Bot is thinking, beside its avatar.
struct BotTypingRow: View {
    let bot: BotInfo
    let thinking: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            BotAvatar(bot.look, size: 28, working: true)
            VStack(alignment: .leading, spacing: 4) {
                TimelineView(.animation(minimumInterval: 1 / 30, paused: reduceMotion)) { context in
                    let t = context.date.timeIntervalSinceReferenceDate
                    HStack(spacing: 5) {
                        ForEach(0..<3) { index in
                            let phase = reduceMotion ? 0.5 : (sin(t * 5 - Double(index) * 0.9) + 1) / 2
                            Circle()
                                .fill(Color.secondary)
                                .frame(width: 7, height: 7)
                                .opacity(0.35 + 0.65 * phase)
                                .offset(y: -2.5 * phase)
                        }
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 13)
                .background(Color(uiColor: .secondarySystemBackground), in: UnevenRoundedRectangle(topLeadingRadius: 20, bottomLeadingRadius: 6, bottomTrailingRadius: 20, topTrailingRadius: 20, style: .continuous))
                if let line = thought {
                    Text(line).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        .padding(.leading, 6)
                        .contentTransition(.opacity)
                }
            }
            Spacer(minLength: 0)
        }
        .animation(.default, value: thought)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(bot.name) is thinking")
    }

    private var thought: String? {
        let line = thinking?.split(whereSeparator: \.isNewline).last.map(String.init)?.replacingOccurrences(of: "**", with: "")
            .trimmingCharacters(in: .whitespaces)
        return line?.isEmpty == false ? line : nil
    }
}

/// The top of the chat: the Bot large, its name, its role and its status.
struct BotHero: View {
    let bot: BotInfo
    let status: String
    let working: Bool

    var body: some View {
        VStack(spacing: 8) {
            BotAvatar(bot.look, size: 84, working: working)
                .shadow(color: BotPalette.color(bot.color).opacity(0.35), radius: 18, y: 8)
                .padding(.bottom, 4)
            Text(bot.name).font(.title2.weight(.semibold))
            if let role = bot.role?.trimmingCharacters(in: .whitespacesAndNewlines), !role.isEmpty {
                Text(role).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center).lineLimit(3)
            }
            Text(status).font(.footnote).foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 24)
        .padding(.bottom, 12)
        .padding(.horizontal, 32)
        .accessibilityElement(children: .combine)
    }
}

/// Quick replies from the Bot's last message (`::next`, `::reactions`), as
/// chips over the composer. A tap sends.
struct BotQuickReplies: View {
    let items: [String]
    let tint: Color
    let pick: (String) -> Void
    @State private var taps = 0

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(items, id: \.self) { item in
                    Button {
                        taps += 1
                        pick(item)
                    } label: {
                        Text(item)
                            .font(.subheadline.weight(.medium))
                            .lineLimit(1)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                    }
                    .buttonStyle(.glass)
                    .accessibilityHint("Sends this reply")
                }
            }
            .padding(.horizontal, 2)
            .padding(.vertical, 2)
        }
        .scrollClipDisabled()
        .sensoryFeedback(.impact(weight: .light), trigger: taps)
    }

    /// The last reply's suggestions, unless the user has answered since.
    static func items(in rows: [TimelineRow]) -> [String] {
        guard let last = rows.last(where: { $0.isConversation && !($0.text ?? "").isEmpty }), !last.isUser, let text = last.text else { return [] }
        let next = Directive.next(in: text)
        if !next.isEmpty { return next.reply + next.ask }
        return Directive.reactions(in: text)
    }
}

/// What needs the user, over the composer: the first pending question or
/// approval, answered in place.
struct BotNeedsYouCard: View {
    let interactions: [PendingInteraction]
    let resolve: (PendingInteraction, JSONValue) async -> Bool
    let cancel: (PendingInteraction) async -> Void
    let openWeb: () -> Void

    var body: some View {
        if let first = interactions.first {
            VStack(alignment: .leading, spacing: 6) {
                if interactions.count > 1 {
                    Text("1 of \(interactions.count) waiting").font(.caption2.weight(.medium)).foregroundStyle(.secondary).padding(.leading, 4)
                }
                InteractionCard(interaction: first, resolve: { await resolve(first, $0) }, cancel: { await cancel(first) }, openWeb: openWeb)
                    .id(first.id)
            }
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }
}
