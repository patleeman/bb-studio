import Foundation

/// A Bot's conversations with open strands (`strands.overview`): the Strands
/// screen, in place of Tasks (desktop: `strands/ui/Overview.tsx`). Studio sorts
/// needs you first, then Main, then the most recently active.
public struct StrandOverview: Decodable, Hashable, Sendable {
    public struct Conversation: Decodable, Hashable, Sendable, Identifiable {
        public var id: String { threadId }
        public var threadId: String
        public var title: String
        public var isMain: Bool
        public var lastActiveAt: Double
        public var strands: [Strand]

        public init(threadId: String, title: String, isMain: Bool = false, lastActiveAt: Double = 0, strands: [Strand]) {
            self.threadId = threadId
            self.title = title
            self.isMain = isMain
            self.lastActiveAt = lastActiveAt
            self.strands = strands
        }

        enum CodingKeys: String, CodingKey { case threadId, title, isMain, lastActiveAt, strands }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            threadId = try c.decodeIfPresent(String.self, forKey: .threadId) ?? ""
            title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
            isMain = try c.decodeIfPresent(Bool.self, forKey: .isMain) ?? false
            lastActiveAt = try c.decodeIfPresent(Double.self, forKey: .lastActiveAt) ?? 0
            strands = try c.decodeIfPresent([Strand].self, forKey: .strands) ?? []
        }

        /// The strands that need the user.
        public var needs: [Strand] { strands.filter { $0.state == .needsYou } }
    }

    public var conversations: [Conversation]
    /// Strands that need the user, across the conversations.
    public var needs: Int
    /// Strands running, across the conversations.
    public var running: Int

    public init(conversations: [Conversation], needs: Int, running: Int) {
        self.conversations = conversations
        self.needs = needs
        self.running = running
    }

    enum CodingKeys: String, CodingKey { case conversations, needs, running }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        conversations = StrandOverviewRules.sorted((try c.decodeIfPresent([Conversation].self, forKey: .conversations) ?? []).filter { !$0.threadId.isEmpty })
        needs = try c.decodeIfPresent(Int.self, forKey: .needs) ?? 0
        running = try c.decodeIfPresent(Int.self, forKey: .running) ?? 0
    }
}

/// What the Strands screen shows, from an overview (desktop's `Overview.tsx`).
public enum StrandOverviewRules {
    /// Up to this many asks show as rows on a conversation's card.
    public static let shownAsks = 2

    /// "2 need you · 3 running", the zero parts left out; "" when nothing needs you or runs.
    public static func line(needs: Int, running: Int) -> String {
        [needs > 0 ? "\(needs) \(needs == 1 ? "needs" : "need") you" : nil, running > 0 ? "\(running) running" : nil]
            .compactMap { $0 }.joined(separator: " · ")
    }

    public static func line(_ overview: StrandOverview?) -> String {
        line(needs: overview?.needs ?? 0, running: overview?.running ?? 0)
    }

    /// Needs you first, then Main, then the most recently active (as Studio sorts them; kept stable).
    public static func sorted(_ conversations: [StrandOverview.Conversation]) -> [StrandOverview.Conversation] {
        conversations.enumerated().sorted { a, b in
            let (x, y) = (a.element, b.element)
            let needsX = !x.needs.isEmpty, needsY = !y.needs.isEmpty
            if needsX != needsY { return needsX }
            if x.isMain != y.isMain { return x.isMain }
            if x.lastActiveAt != y.lastActiveAt { return x.lastActiveAt > y.lastActiveAt }
            return a.offset < b.offset
        }.map(\.element)
    }

    /// An ask row on a card: the strand that needs the user, and its ask (nil when it has none listed).
    public struct AskRow: Hashable, Sendable, Identifiable {
        public var id: String { strand.id + ":" + (ask?.id ?? "") }
        public var strand: Strand
        public var ask: Strand.Ask?

        /// "<strand title> · <ask label or detail>".
        public var text: String { "\(strand.title) · \(detail)" }

        public var detail: String {
            if let label = ask?.label, !label.isEmpty { return label }
            if let detail = strand.detail, !detail.isEmpty { return detail }
            return "Needs you"
        }
    }

    public struct Card: Hashable, Sendable {
        /// Up to `shownAsks` asks.
        public var asks: [AskRow]
        /// Asks past those, as "N more need you".
        public var more: Int
        /// The strands that don't need the user, as chips.
        public var chips: [Strand]
    }

    public static func card(_ conversation: StrandOverview.Conversation) -> Card {
        let asks = conversation.needs.flatMap { strand in
            strand.asks.isEmpty ? [AskRow(strand: strand, ask: nil)] : strand.asks.map { AskRow(strand: strand, ask: $0) }
        }
        let shown = Array(asks.prefix(shownAsks))
        return Card(asks: shown, more: asks.count - shown.count, chips: conversation.strands.filter { $0.state != .needsYou })
    }

    /// The "Main" tag beside a card's name: only on Main, and only when its title isn't already "Main".
    public static func showsMainTag(_ conversation: StrandOverview.Conversation) -> Bool {
        conversation.isMain && conversation.title.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() != "main"
    }

    /// A chip's spoken state.
    public static func stateLabel(_ state: Strand.State) -> String {
        switch state {
        case .needsYou: "needs you"
        case .running: "running"
        case .doneUnseen: "finished"
        case .waiting: "waiting"
        case .active: "open"
        case .quiet: "quiet"
        case .other: ""
        }
    }
}

extension BBClient {
    public func strandsOverview(botId: String) async throws -> StrandOverview {
        try await rpc("studio", Studio.Method.strands_overview, .object(["botId": .string(botId)]))
    }
}
