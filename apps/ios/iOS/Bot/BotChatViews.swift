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
    /// Threads the Bot started, placed where they were made, with live status.
    let started: [BotStartedThread]
    /// Compactions Studio ran before the cache expired.
    var compactions: [BotActivity.Compaction] = []
    var react: (String) -> Void
    var quote: (String) -> Void
    var select: (String) -> Void
    var edit: ((String) -> Void)?
    var editableId: String?
    var openThread: (String) -> Void
    /// Side threads on replies in the current thread, by reply id.
    var sideThreads: [String: BotSideThread] = [:]
    var replyInThread: (String) -> Void = { _ in }
    /// The current thread's row ids: only its replies can start a side thread (earlier ones are archived).
    var threadRows: Set<String> = []
    /// The rows are the cached ones, for timing.
    var cached = false
    var measure: (String, TranscriptResizeAnchor.Row) -> Void = { _, _ in }
    var unmeasure: (String) -> Void = { _ in }

    var body: some View {
        let entries = BotChatEntry.memo.entries(rows, started: started, compactions: compactions)
        let live = Dictionary(started.map { ($0.id, $0.status) }, uniquingKeysWith: { first, _ in first })
        ForEach(entries) { entry in
            Group {
                switch entry {
                case .day(let date, _):
                    BotDaySeparator(date: date)
                case .message(let row, let first, let last):
                    BotMessageRow(
                        bot: bot, row: row, first: first, last: last, projectId: projectId,
                        react: react, quote: quote, select: select,
                        edit: row.id == editableId ? edit : nil,
                        sideThread: sideThreads[row.id],
                        replyInThread: !row.isUser && threadRows.contains(row.id) ? { replyInThread(row.id) } : nil)
                    .modifier(ChatPerfRow(row: row, cached: cached))
                case .work(let rows):
                    BotWorkRow(rows: rows)
                case .autoCompacted(let compaction, _):
                    BotAutoCompactedMarker(compaction: compaction)
                case .child(let event, _):
                    BotChildCard(event: event, live: event.threadId.flatMap { live[$0] }) {
                        if let id = event.threadId { openThread(id) }
                    }
                }
            }
            .id(entry.id)
            .onGeometryChange(for: TranscriptResizeAnchor.Row.self) { proxy in
                let isMessage: Bool
                if case .message = entry { isMessage = true } else { isMessage = false }
                return .init(width: proxy.bounds(of: .scrollView)?.width ?? 0,
                    frame: proxy.frame(in: .global), isMessage: isMessage)
            } action: { row in measure(entry.id, row) }
            .onDisappear { unmeasure(entry.id) }
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

/// Studio's "/compact" before the cache expired, centered and quiet like a day.
struct BotAutoCompactedMarker: View {
    let compaction: BotActivity.Compaction

    var body: some View {
        Text(BotChatEntry.autoCompactedLabel(compaction))
            .font(.caption)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .frame(maxWidth: .infinity)
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
    /// This reply's side thread, when it has one.
    var sideThread: BotSideThread?
    /// Opens (or starts) the reply's side thread; nil where replies can't have one.
    var replyInThread: (() -> Void)?
    @EnvironmentObject private var app: AppModel

    private static let avatarSize: CGFloat = 28
    private var text: String { row.text ?? "" }
    private var tint: Color { BotPalette.color(bot.color) }

    var body: some View {
        Group {
            if row.isUser { user } else { reply }
        }
        // A run reads as one: bubbles 4pt apart, runs 20pt (the stack's 14 plus 6).
        .padding(.top, first ? 6 : -10)
        // On its way to the server.
        .opacity(row.id.hasPrefix("pending:") ? 0.6 : 1)
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
        // As on the desktop: the avatar and name open the Bot's run.
        HStack(alignment: .top, spacing: 8) {
            Group {
                if first { BotAvatar(bot.look, size: Self.avatarSize) } else { Color.clear }
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
                if let sideThread, let replyInThread { BotSideThreadRow(thread: sideThread, tint: tint, open: replyInThread) }
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
            : UnevenRoundedRectangle(topLeadingRadius: first ? small : small, bottomLeadingRadius: last ? big : small, bottomTrailingRadius: big, topTrailingRadius: big, style: .continuous)
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
        if let replyInThread {
            Button(action: replyInThread) { Label(sideThread == nil ? "Reply in Thread" : "Open Thread", systemImage: "bubble.left.and.bubble.right") }
        }
        if let edit { Button { edit(plainText) } label: { Label("Edit", systemImage: "pencil") } }
        ShareLink(item: plainText) { Label("Share", systemImage: "square.and.arrow.up") }
    }
}

/// "💬 2 replies · 5m ago" under a reply with a side thread; opens it.
struct BotSideThreadRow: View {
    let thread: BotSideThread
    let tint: Color
    var open: () -> Void

    var body: some View {
        Button(action: open) {
            TimelineView(.periodic(from: .now, by: 60)) { context in
                Label(thread.label(now: context.date), systemImage: "bubble.left.and.bubble.right.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(tint)
                    .monospacedDigit()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 4)
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens the side thread on this reply")
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
                        Image(systemName: failed ? "exclamationmark.triangle.fill" : "checkmark")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(failed ? AnyShapeStyle(.orange) : AnyShapeStyle(.secondary))
                    }
                    Text(title).lineLimit(1)
                    if steps > 0 { Text("· \(steps) step\(steps == 1 ? "" : "s")").foregroundStyle(.tertiary).lineLimit(1) }
                    Image(systemName: "chevron.right")
                        .font(.caption2.weight(.semibold))
                        .rotationEffect(.degrees(expanded ? 90 : 0))
                        .foregroundStyle(.tertiary)
                }
                .font(.footnote)
                .foregroundStyle(.secondary)
                .padding(.vertical, 4)
                .contentShape(.rect)
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

    private var title: String { running ? "Working…" : failed ? "Hit a snag" : steps == 0 ? "Thought it through" : "Worked" }
    private var summary: String { steps == 0 ? title : "\(title), \(steps) step\(steps == 1 ? "" : "s")" }
}

/// A thread the Bot started or heard back from, as one compact card (desktop's ChildCard).
struct BotChildCard: View {
    let event: BotChildEvent
    /// The thread's status now, from the Bot's Activity.
    let live: BotChildStatus?
    let open: () -> Void

    private var status: BotChildStatus { live ?? event.status }
    private var symbol: String {
        if event.verb == .started { return "arrow.up.right" }
        switch status {
        case .finished: return "checkmark.circle"
        case .failed: return "exclamationmark.circle"
        default: return "text.bubble"
        }
    }
    private var dot: Color {
        switch status {
        case .running, .finished: .green
        case .failed: .red
        case .needsYou: .orange
        case .stopped, .waiting: .secondary
        }
    }
    private var label: String { "\(event.verb == .started ? "Started " : "")‘\(event.title)’" }

    var body: some View {
        Button(action: open) {
            HStack(spacing: 10) {
                Image(systemName: symbol)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 30, height: 30)
                    .background(.fill.tertiary, in: .rect(cornerRadius: 8, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    (Text(event.verb == .started ? "Started " : "").foregroundStyle(.secondary) + Text("‘\(event.title)’"))
                        .font(.subheadline)
                        .lineLimit(1)
                    HStack(spacing: 5) {
                        Circle().fill(dot).frame(width: 6, height: 6)
                        Text(status.label).font(.caption).foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 0)
                if event.threadId != nil {
                    Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .frame(maxWidth: 360, alignment: .leading)
            .background(Color(uiColor: .systemBackground), in: .rect(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(.separator))
        }
        .buttonStyle(.plain)
        .disabled(event.threadId == nil)
        .padding(.leading, 36)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityLabel("\(label), \(status.label)")
        .accessibilityHint(event.threadId != nil ? "Opens the thread" : "")
    }
}

/// Three dots that pulse while the Bot is thinking, beside its avatar.
struct BotTypingRow: View {
    let bot: BotInfo
    let thinking: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            BotAvatar(bot.look, size: 28, working: true)
            VStack(alignment: .leading, spacing: 4) {
                // A symbol effect runs in the render server, so the dots cost
                // nothing per frame here; it stops in the background.
                Image(systemName: "ellipsis")
                    .font(.system(size: 22, weight: .heavy))
                    .foregroundStyle(.secondary)
                    .symbolEffect(.variableColor.iterative.dimInactiveLayers.nonReversing, options: .repeating,
                                  isActive: !reduceMotion && scenePhase == .active)
                    .frame(height: 8)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 13)
                    .background(Color(uiColor: .secondarySystemBackground), in: UnevenRoundedRectangle(topLeadingRadius: 6, bottomLeadingRadius: 20, bottomTrailingRadius: 20, topTrailingRadius: 20, style: .continuous))
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
    @State private var hasTrailingOverflow = false

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
        // Keep overflow inside the same safe-area width as the composer.
        // Horizontal scrolling exposes additional replies without drawing
        // them into the system's status-bar column.
        .onScrollGeometryChange(for: Bool.self) { geometry in
            geometry.contentSize.width - geometry.contentOffset.x - geometry.containerSize.width > 1
        } action: { _, overflowing in
            hasTrailingOverflow = overflowing
        }
        .mask {
            HStack(spacing: 0) {
                Rectangle()
                LinearGradient(colors: [.black, hasTrailingOverflow ? .clear : .black],
                    startPoint: .leading, endPoint: .trailing)
                    .frame(width: 24)
            }
        }
        .accessibilityIdentifier("botQuickReplies")
        .accessibilityValue(hasTrailingOverflow ? "More replies to the right" : "No more replies to the right")
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
