import Foundation

/// A conversation's strands (its lines of work), from Studio's `strands.list`.
/// Studio sorts every conversation's messages into strands; the box above the
/// composer shows them in In flight's old place (desktop: `strands/ui/Strip.tsx`
/// and `strands/ui/model.ts`, which these helpers follow).
public struct StrandList: Decodable, Hashable, Sendable {
    public var threadId: String
    /// Strands run for this conversation (a Bot's conversation, not a worker).
    public var enabled: Bool
    public var strands: [Strand]
    /// Quiet for 3 days and not pinned: folded away.
    public var earlier: [Strand]
    /// Workers no strand holds: running, waiting on the user, or failed in the last 7 days.
    public var strayWorkers: [Strand.Worker]

    public init(threadId: String, enabled: Bool, strands: [Strand], earlier: [Strand] = [], strayWorkers: [Strand.Worker] = []) {
        self.threadId = threadId
        self.enabled = enabled
        self.strands = strands
        self.earlier = earlier
        self.strayWorkers = strayWorkers
    }

    enum CodingKeys: String, CodingKey { case threadId, enabled, strands, earlier, strayWorkers }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        threadId = try c.decodeIfPresent(String.self, forKey: .threadId) ?? ""
        enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled) ?? false
        strands = try c.decodeIfPresent([Strand].self, forKey: .strands) ?? []
        earlier = try c.decodeIfPresent([Strand].self, forKey: .earlier) ?? []
        strayWorkers = try c.decodeIfPresent([Strand.Worker].self, forKey: .strayWorkers) ?? []
    }
}

public struct Strand: Decodable, Hashable, Sendable, Identifiable {
    public enum State: String, Decodable, Sendable {
        case needsYou = "needs-you", running, doneUnseen = "done-unseen", waiting, active, quiet, other

        public init(from decoder: Decoder) throws {
            self = State(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .other
        }
    }

    public struct Ask: Decodable, Hashable, Sendable, Identifiable {
        public enum Kind: String, Decodable, Sendable {
            /// `reply`: a reply that asks the user something; its `seq` is the reply's message.
            case question, approval, gateway, reply, other
            public init(from decoder: Decoder) throws {
                self = Kind(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .other
            }
        }

        public var id: String
        public var kind: Kind
        /// The thread it waits in: the conversation, or one of its workers.
        public var threadId: String
        public var label: String
        /// An approval's details before its buttons: the whole command, working folder, actions.
        public var details: [String]
        /// An approval's choices: `allow_once`, `allow_for_session`, `deny`.
        public var decisions: [String]
        /// A reply's message; nil for every other kind.
        public var seq: Double?

        public init(id: String, kind: Kind, threadId: String, label: String, details: [String] = [], decisions: [String] = [], seq: Double? = nil) {
            self.id = id
            self.kind = kind
            self.threadId = threadId
            self.label = label
            self.details = details
            self.decisions = decisions
            self.seq = seq
        }

        enum CodingKeys: String, CodingKey { case id, kind, threadId, label, details, decisions, seq }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
            kind = try c.decodeIfPresent(Kind.self, forKey: .kind) ?? .other
            threadId = try c.decodeIfPresent(String.self, forKey: .threadId) ?? ""
            label = try c.decodeIfPresent(String.self, forKey: .label) ?? ""
            details = try c.decodeIfPresent([String].self, forKey: .details) ?? []
            decisions = try c.decodeIfPresent([String].self, forKey: .decisions) ?? []
            seq = try? c.decodeIfPresent(Double.self, forKey: .seq)
        }
    }

    public struct Worker: Decodable, Hashable, Sendable, Identifiable {
        public var id: String { threadId }
        public var threadId: String
        public var title: String
        public var status: BotWorker.Status
        /// When it finished or failed (ms).
        public var endedAt: Double?

        public init(threadId: String, title: String, status: BotWorker.Status, endedAt: Double? = nil) {
            self.threadId = threadId
            self.title = title
            self.status = status
            self.endedAt = endedAt
        }

        enum CodingKeys: String, CodingKey { case threadId, title, status, endedAt }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            threadId = try c.decodeIfPresent(String.self, forKey: .threadId) ?? ""
            title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
            status = BotWorker.Status(rawValue: try c.decodeIfPresent(String.self, forKey: .status) ?? "done")
            endedAt = try c.decodeIfPresent(Double.self, forKey: .endedAt)
        }
    }

    public var id: String
    public var title: String
    public var summary: String?
    public var state: State
    public var detail: String?
    public var asks: [Ask]
    public var workers: [Worker]
    public var lastAt: Double
    public var latestSeq: Double?

    public init(id: String, title: String, summary: String? = nil, state: State, detail: String? = nil,
                asks: [Ask] = [], workers: [Worker] = [], lastAt: Double = 0, latestSeq: Double? = nil) {
        self.id = id
        self.title = title
        self.summary = summary
        self.state = state
        self.detail = detail
        self.asks = asks
        self.workers = workers
        self.lastAt = lastAt
        self.latestSeq = latestSeq
    }

    enum CodingKeys: String, CodingKey { case id, title, summary, state, detail, asks, workers, lastAt, latestSeq }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        summary = try c.decodeIfPresent(String.self, forKey: .summary)
        state = try c.decodeIfPresent(State.self, forKey: .state) ?? .other
        detail = try c.decodeIfPresent(String.self, forKey: .detail)
        asks = try c.decodeIfPresent([Ask].self, forKey: .asks) ?? []
        workers = try c.decodeIfPresent([Worker].self, forKey: .workers) ?? []
        lastAt = try c.decodeIfPresent(Double.self, forKey: .lastAt) ?? 0
        latestSeq = try c.decodeIfPresent(Double.self, forKey: .latestSeq)
    }
}

/// What the box shows, from a list: desktop's `strands/ui/model.ts`.
public enum StrandsBoxModel {
    /// A strand's summary line, or nil when it says nothing: an empty line, or
    /// the sorter's "Continuation of the main conversation; no details
    /// provided." and the like.
    public static func summary(_ line: String?) -> String? {
        guard let line = line?.trimmingCharacters(in: .whitespacesAndNewlines), !line.isEmpty else { return nil }
        let plain = line.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: ".;: "))
        if plain.contains("no details provided") || plain.contains("no details given") { return nil }
        if ["continuation of the main conversation", "continuation of the conversation", "continuation of main"].contains(plain) { return nil }
        return line
    }

    /// A needs-you strand's reply ask, when that's what it waits on first: picking the strand jumps to the reply.
    public static func replyAsk(_ strand: Strand) -> Strand.Ask? {
        guard strand.state == .needsYou, let ask = strand.asks.first, ask.kind == .reply, ask.seq != nil else { return nil }
        return ask
    }

    /// Done workers stay on their strand's row 2 days, failed ones 7 (as the sidebar lists them).
    static let rowDoneMs: Double = 2 * 24 * 60 * 60 * 1000
    static let rowFailedMs: Double = 7 * 24 * 60 * 60 * 1000

    /// The box takes In flight's place: strands run here and there is something to show.
    public static func shown(_ list: StrandList?) -> Bool {
        guard let list, list.enabled else { return false }
        return !list.strands.isEmpty || !list.strayWorkers.isEmpty
    }

    public struct Counts: Equatable, Sendable {
        public var needs = 0, running = 0, finished = 0, waiting = 0
    }

    /// The closed line's counts: strands by state, plus the workers no strand holds.
    public static func counts(_ list: StrandList?) -> Counts {
        var counts = Counts()
        for strand in list?.strands ?? [] {
            switch strand.state {
            case .needsYou: counts.needs += 1
            case .running: counts.running += 1
            case .doneUnseen: counts.finished += 1
            case .waiting: counts.waiting += 1
            default: break
            }
        }
        for worker in list?.strayWorkers ?? [] {
            if worker.status == .needsYou { counts.needs += 1 }
            if worker.status == .running { counts.running += 1 }
        }
        return counts
    }

    /// The line's strand: the first that needs the user, else the one the newest sorted message is in.
    public static func current(_ list: StrandList?) -> Strand? {
        let strands = list?.strands ?? []
        if let needs = strands.first(where: { $0.state == .needsYou }) { return needs }
        return strands.filter { $0.latestSeq != nil }.max { ($0.latestSeq ?? -1) < ($1.latestSeq ?? -1) }
    }

    public struct Group: Identifiable, Equatable, Sendable {
        public var id: String { label }
        public var label: String
        public var strands: [Strand]
    }

    /// The opened box: Needs you, then Active (running, finished, waiting, open), then Quiet; empty ones left out.
    public static func groups(_ list: StrandList?) -> [Group] {
        let all = list?.strands ?? []
        return [
            Group(label: "Needs you", strands: all.filter { $0.state == .needsYou }),
            Group(label: "Active", strands: all.filter { $0.state != .needsYou && $0.state != .quiet }),
            Group(label: "Quiet", strands: all.filter { $0.state == .quiet }),
        ].filter { !$0.strands.isEmpty }
    }

    private static func rank(_ status: BotWorker.Status) -> Int {
        switch status {
        case .needsYou: 0
        case .running: 1
        case .failed: 2
        default: 3
        }
    }

    /// A strand's workers on its row: waiting on you and running ones always,
    /// failed ones for 7 days, finished ones for 2; in that order, newest first.
    public static func rowWorkers(_ strand: Strand, now: Double) -> [Strand.Worker] {
        strand.workers.filter { worker in
            switch worker.status {
            case .running, .needsYou: true
            case .done: worker.endedAt.map { now - $0 < rowDoneMs } ?? true
            case .failed: worker.endedAt.map { now - $0 < rowFailedMs } ?? true
            case .other: false
            }
        }
        .sorted { rank($0.status) != rank($1.status) ? rank($0.status) < rank($1.status) : ($0.endedAt ?? 0) > ($1.endedAt ?? 0) }
    }

    public struct DecisionButton: Equatable, Sendable {
        public var decision: WorkerApproval.Decision
        public var label: String
        public var primary: Bool
    }

    /// An approval's buttons, in desktop's order: Approve, Always allow, Deny.
    public static func decisionButtons(_ ask: Strand.Ask) -> [DecisionButton] {
        let order: [(WorkerApproval.Decision, String)] = [(.allowOnce, "Approve"), (.allowForSession, "Always allow"), (.deny, "Deny")]
        return order.filter { ask.decisions.contains($0.0.rawValue) }.map { DecisionButton(decision: $0.0, label: $0.1, primary: $0.0 == .allowOnce) }
    }

    /// The closed line's words: "2 need you · Plumber quote", or the current strand's title.
    /// The strands line above a Bot conversation's composer says what runs,
    /// never how many need you: the first running strand, else the newest.
    public static func lineStrand(_ list: StrandList?) -> Strand? {
        let strands = list?.strands ?? []
        if let running = strands.first(where: { $0.state == .running }) { return running }
        return strands.filter { $0.latestSeq != nil }.max { ($0.latestSeq ?? -1) < ($1.latestSeq ?? -1) } ?? strands.first
    }

    public static func line(_ list: StrandList?) -> String {
        if let strand = lineStrand(list) { return strand.title }
        if let stray = list?.strayWorkers.first { return stray.title.isEmpty ? "A worker" : stray.title }
        return "Strands"
    }

    public static func headline(_ list: StrandList?) -> String {
        let counts = counts(list)
        let current = current(list)
        if counts.needs > 0 {
            let lead = "\(counts.needs) \(counts.needs == 1 ? "needs" : "need") you"
            return current.map { "\(lead) · \($0.title)" } ?? lead
        }
        if let current { return current.title }
        if let stray = list?.strayWorkers.first { return stray.title.isEmpty ? "A worker" : stray.title }
        return "Strands"
    }
}

extension BBClient {
    public func strandsList(threadId: String) async throws -> StrandList {
        try await rpc("studio", Studio.Method.strands_list, .object(["threadId": .string(threadId)]))
    }

    public func strandOpened(_ strandId: String) async throws {
        let _: Studio.StrandsOpenedOutput = try await rpc("studio", Studio.Method.strands_opened, .object(["strandId": .string(strandId)]))
    }
}
