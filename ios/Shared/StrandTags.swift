import Foundation

/// Each sorted turn's strand (`strands.tags`): which strand a message is in,
/// for the small tag in a reply's footer. Strands show nowhere else (round 7).
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

        public init(id: String, title: String) {
            self.id = id
            self.title = title
        }
    }

    /// Oldest first.
    public var tags: [Tag]
    public var strands: [Name]

    public init(tags: [Tag], strands: [Name] = []) {
        self.tags = tags.sorted { $0.seq < $1.seq }
        self.strands = strands
    }

    enum CodingKeys: String, CodingKey { case tags, strands }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tags = (try c.decodeIfPresent([Tag].self, forKey: .tags) ?? []).sorted { $0.seq < $1.seq }
        strands = try c.decodeIfPresent([Name].self, forKey: .strands) ?? []
    }

    public func title(_ strandId: String) -> String? { strands.first { $0.id == strandId }?.title }

    /// The strand of the turn a row came from: its last event (`sourceSeqEnd`)
    /// falls in the turn that starts at the last tag at or before it. Nil when
    /// it's older than every sorted turn or its turn has no strand.
    public func strand(atSeq seq: Double?) -> String? { turn(atSeq: seq)?.strandId }

    /// The strand's name for a row, for its footer.
    public func strandTitle(atSeq seq: Double?) -> String? { strand(atSeq: seq).flatMap(title) }

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
}

extension BBClient {
    public func strandsTags(threadId: String) async throws -> StrandTags {
        try await rpc("studio", Studio.Method.strands_tags, .object(["threadId": .string(threadId)]))
    }
}
