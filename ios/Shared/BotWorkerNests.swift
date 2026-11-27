import Foundation

/// The Bot's workers nested under their conversations, as the desktop
/// sidebar lists them (`ui/conversations/model.ts`: `workerNests`,
/// `foldLevel`, `nestLabel`). Each worker sits under the worker that started
/// it when that one is listed too; each top worker under its conversation's
/// row (`nestUnder`, else its owner). A worker whose conversation has no row
/// goes to `other`. Runners' threads are workers owned by Main, so they sit
/// under Main. Order stays the server's: needs you, running, then newest.
public struct BotWorkerNode: Hashable, Sendable, Identifiable {
    public var id: String { worker.threadId }
    public var worker: BotWorker
    public var children: [BotWorkerNode]

    /// This worker and every worker under it.
    public var subtree: [BotWorker] { [worker] + children.flatMap(\.subtree) }

    /// It, or a worker under it, runs or waits on the user.
    public var live: Bool { subtree.contains { $0.status == .running || $0.status == .needsYou } }
}

public struct BotWorkerNest: Hashable, Sendable {
    public var nodes: [BotWorkerNode] = []
}

public enum BotWorkerNests {
    /// A fold holds at least this many workers; fewer show as they are.
    public static let foldMin = 2

    public static func make(conversations: [String], workers: [BotWorker]) -> (nests: [String: BotWorkerNest], other: BotWorkerNest?) {
        let listed = Set(conversations)
        let byId = Dictionary(workers.map { ($0.threadId, $0) }, uniquingKeysWith: { first, _ in first })
        // A worker's parent: the listed worker that started it, unless that loops back to it.
        func parent(of worker: BotWorker) -> String? {
            var seen: Set<String> = [worker.threadId]
            var at = worker.spawnedBy
            while let id = at, let next = byId[id] {
                if !seen.insert(id).inserted { return nil }
                at = next.spawnedBy
            }
            guard let spawnedBy = worker.spawnedBy, byId[spawnedBy] != nil else { return nil }
            return spawnedBy
        }
        var childIds: [String: [String]] = [:]
        var roots: [String] = []
        var seenIds: Set<String> = []
        for worker in workers where seenIds.insert(worker.threadId).inserted {
            if let up = parent(of: worker) { childIds[up, default: []].append(worker.threadId) } else { roots.append(worker.threadId) }
        }
        func node(_ id: String) -> BotWorkerNode {
            BotWorkerNode(worker: byId[id]!, children: (childIds[id] ?? []).map(node))
        }
        var nests: [String: BotWorkerNest] = [:]
        var other: BotWorkerNest?
        for id in roots {
            let root = node(id)
            let home = root.worker.home.flatMap { listed.contains($0) ? $0 : nil }
            var nest = home.flatMap { nests[$0] } ?? (home == nil ? other : nil) ?? BotWorkerNest()
            nest.nodes.append(root)
            if let home { nests[home] = nest } else { other = nest }
        }
        return (nests, other)
    }

    /// One level of a nest: the workers shown (live, or with a live worker
    /// under them) and the rest folded into "N done", with the count of
    /// every worker they hold. Fewer than `foldMin` finished: nothing folds.
    public static func fold(_ nodes: [BotWorkerNode]) -> (shown: [BotWorkerNode], done: [BotWorkerNode], doneCount: Int) {
        let done = nodes.filter { !$0.live }
        let count = done.reduce(0) { $0 + $1.subtree.count }
        guard count >= foldMin else { return (nodes, [], 0) }
        return (nodes.filter(\.live), done, count)
    }
}

/// A line under a conversation in the list: a worker at its depth, or a
/// level's "N done" fold (closed until opened).
public enum BotWorkerLine: Hashable, Sendable, Identifiable {
    case worker(BotWorker, depth: Int)
    case fold(key: String, count: Int, depth: Int)

    public var id: String {
        switch self {
        case .worker(let worker, _): "w:" + worker.threadId
        case .fold(let key, _, _): "f:" + key
        }
    }
}

extension BotWorkerNests {
    /// A nest's lines, in order: each level's live workers (and the workers under
    /// them), then its "N done" fold, opened when `openFolds` holds its key (the
    /// level's parent: the conversation or worker id).
    public static func lines(_ nodes: [BotWorkerNode], parent: String, openFolds: Set<String>, depth: Int = 0) -> [BotWorkerLine] {
        let level = fold(nodes)
        var out: [BotWorkerLine] = []
        func add(_ node: BotWorkerNode) {
            out.append(.worker(node.worker, depth: depth))
            out += lines(node.children, parent: node.worker.threadId, openFolds: openFolds, depth: depth + 1)
        }
        level.shown.forEach(add)
        if level.doneCount > 0 {
            out.append(.fold(key: parent, count: level.doneCount, depth: depth))
            if openFolds.contains(parent) { level.done.forEach(add) }
        }
        return out
    }
}
