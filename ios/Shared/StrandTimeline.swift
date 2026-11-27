import Foundation

/// Each sorted turn's strand (`strands.tags`): which strand a message is in,
/// for the dividers between strands and "Only this strand".
public struct StrandTags: Decodable, Hashable, Sendable {
    public struct Tag: Decodable, Hashable, Sendable {
        public var turnId: String
        /// The turn's first message.
        public var seq: Double
        public var strandId: String?

        public init(turnId: String, seq: Double, strandId: String?) {
            self.turnId = turnId
            self.seq = seq
            self.strandId = strandId
        }
    }

    public struct Name: Decodable, Hashable, Sendable {
        public var id: String
        public var title: String
    }

    /// A turn's reply, tagged needs-you or status: its asking sentence (`ask`,
    /// nil when Jev named none) and whether the user is past it.
    public struct Reply: Decodable, Hashable, Sendable {
        public var turnId: String
        /// The reply's message.
        public var seq: Double
        public var tag: String
        public var ask: String?
        /// Answered, marked done, its strand marked done, or a week old.
        public var resolved: Bool

        public init(turnId: String, seq: Double, tag: String, ask: String?, resolved: Bool) {
            self.turnId = turnId
            self.seq = seq
            self.tag = tag
            self.ask = ask
            self.resolved = resolved
        }

        /// Still asking the user.
        public var open: Bool { tag == "needs-you" && !resolved }
    }

    /// Oldest first.
    public var tags: [Tag]
    public var strands: [Name]
    /// Oldest first.
    public var replies: [Reply]

    public init(tags: [Tag], strands: [Name] = [], replies: [Reply] = []) {
        self.tags = tags.sorted { $0.seq < $1.seq }
        self.strands = strands
        self.replies = replies
    }

    enum CodingKeys: String, CodingKey { case tags, strands, replies }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tags = (try c.decodeIfPresent([Tag].self, forKey: .tags) ?? []).sorted { $0.seq < $1.seq }
        strands = try c.decodeIfPresent([Name].self, forKey: .strands) ?? []
        replies = (try? c.decodeIfPresent([Reply].self, forKey: .replies)) ?? []
    }

    public func title(_ strandId: String) -> String? { strands.first { $0.id == strandId }?.title }

    /// The strand of the turn a row came from: its last event (`sourceSeqEnd`)
    /// falls in the turn that starts at the last tag at or before it. Nil when
    /// it's older than every sorted turn or its turn has no strand.
    public func strand(atSeq seq: Double?) -> String? { turn(atSeq: seq)?.strandId }

    /// The sorted turn a row came from (as `strand(atSeq:)`).
    public func turn(atSeq seq: Double?) -> Tag? {
        guard let seq, !tags.isEmpty, seq >= tags[0].seq else { return nil }
        var low = 0, high = tags.count - 1
        while low < high {
            let mid = (low + high + 1) / 2
            if tags[mid].seq <= seq { low = mid } else { high = mid - 1 }
        }
        return tags[low]
    }

    /// The turn's reply that still asks the user, the newest if several.
    public func openReply(turnId: String) -> Reply? { replies.last { $0.turnId == turnId && $0.open } }
}

/// Where a transcript changes strand, and what "Only this strand" keeps.
public enum StrandTimeline {
    public enum Mark: Equatable, Sendable {
        /// A thin divider with the strand's name above the row.
        case divider(strandId: String, title: String)
        /// "N other messages" in place of rows another strand holds.
        case gap(count: Int)
    }

    /// For rows in order (each with its turn's last event seq, nil for rows not
    /// from a turn), the mark before each kept row and which rows to keep.
    /// Without a filter every row stays and a divider goes where the strand
    /// changes; with one, only its rows stay (rows with no seq stay too: the
    /// pending ones, questions waiting on the user) and the others fold into gaps.
    /// `messages` says which rows are messages: only those count in a gap's "N other messages".
    public static func plan(seqs: [Double?], messages: [Bool], tags: StrandTags, only: String?) -> (keep: [Bool], marks: [Int: [Mark]]) {
        var keep = Array(repeating: true, count: seqs.count)
        var marks: [Int: [Mark]] = [:]
        var current: String?
        var skipped = 0
        var hidden = false
        for (index, seq) in seqs.enumerated() {
            let strand = tags.strand(atSeq: seq)
            if let only, seq != nil, strand != only {
                keep[index] = false
                hidden = true
                if messages.indices.contains(index), messages[index] { skipped += 1 }
                continue
            }
            if hidden {
                if skipped > 0 { marks[index, default: []].append(.gap(count: skipped)) }
                skipped = 0
                hidden = false
            }
            if only == nil, let strand, strand != current, let title = tags.title(strand) {
                marks[index, default: []].append(.divider(strandId: strand, title: title))
            }
            if strand != nil { current = strand }
        }
        if skipped > 0 { marks[seqs.count, default: []].append(.gap(count: skipped)) }
        return (keep, marks)
    }
}

extension BBClient {
    public func strandsTags(threadId: String) async throws -> StrandTags {
        try await rpc("studio", Studio.Method.strands_tags, .object(["threadId": .string(threadId)]))
    }
}
