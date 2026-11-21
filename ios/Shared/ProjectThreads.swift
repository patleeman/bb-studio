import Foundation

/// The one conversation list's Projects: BB's threads that belong to no Bot,
/// grouped by project, each with the threads it started nested under it. A
/// thread is a Bot's when a Bot lists it (a conversation, a worker, its Main,
/// or an older or finished one) or when it descends from one of those.
public enum ProjectThreads {
    public struct Line: Identifiable, Hashable, Sendable {
        public var thread: ThreadEntry
        public var depth: Int
        public var id: String { thread.id }
    }

    public struct Group: Identifiable, Hashable, Sendable {
        public var id: String
        public var name: String
        public var lines: [Line]
        /// Its threads, nested ones included.
        public var count: Int { lines.count }
        public var updatedAt: Double { lines.map(\.thread.updatedAt).max() ?? 0 }
    }

    /// The groups, most recently active project first. With a query, only the
    /// threads whose title has it, each on its own line.
    public static func groups(_ sidebar: SidebarBootstrap, botThreads: Set<String>, query: String = "") -> [Group] {
        let projects = sidebar.projects + [sidebar.personalProject]
        let names = Dictionary(projects.map { ($0.id, $0.id == NewThreadProject.personalId ? NewThreadProject.personalLabel : $0.name) },
                               uniquingKeysWith: { first, _ in first })
        let all = projects.flatMap(\.threads).filter { $0.visibility != "hidden" && $0.archivedAt == nil }
        let byId = Dictionary(all.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        var owned: [String: Bool] = [:]
        func isBots(_ thread: ThreadEntry, _ seen: Set<String> = []) -> Bool {
            if let known = owned[thread.id] { return known }
            if botThreads.contains(thread.id) { return true }
            let parents = [thread.parentThreadId, thread.lifecycleOwnerThreadId, thread.sourceThreadId].compactMap { $0 }
            let result = parents.contains { parent in
                if botThreads.contains(parent) { return true }
                guard !seen.contains(parent), let up = byId[parent] else { return false }
                return isBots(up, seen.union([thread.id]))
            }
            owned[thread.id] = result
            return result
        }
        let free = all.filter { !isBots($0) }
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        var lines: [String: [Line]] = [:]
        if !needle.isEmpty {
            for thread in free.sorted(by: { $0.updatedAt > $1.updatedAt })
            where thread.displayTitle.localizedCaseInsensitiveContains(needle) {
                lines[thread.projectId, default: []].append(Line(thread: thread, depth: 0))
            }
        } else {
            let ids = Set(free.map(\.id))
            let children = Dictionary(grouping: free.filter { $0.parentThreadId.map(ids.contains) ?? false }) { $0.parentThreadId! }
            func add(_ thread: ThreadEntry, depth: Int, into list: inout [Line]) {
                list.append(Line(thread: thread, depth: depth))
                for child in (children[thread.id] ?? []).sorted(by: { $0.updatedAt > $1.updatedAt }) {
                    add(child, depth: min(depth + 1, 4), into: &list)
                }
            }
            for top in free.filter({ $0.parentThreadId.map { !ids.contains($0) } ?? true }).sorted(by: { $0.updatedAt > $1.updatedAt }) {
                add(top, depth: 0, into: &lines[top.projectId, default: []])
            }
        }
        return lines.map { Group(id: $0.key, name: names[$0.key] ?? NewThreadProject.personalLabel, lines: $0.value) }
            .sorted { $0.updatedAt > $1.updatedAt }
    }
}

extension BBClient {
    /// Every thread a Bot lists (its conversations, workers and Main, the
    /// older and finished ones too), for telling them from project threads.
    public func botThreadIds(bots: [BotSpace]) async -> Set<String> {
        var ids = Set(bots.compactMap(\.mainThreadId))
        await withTaskGroup(of: Set<String>.self) { group in
            for bot in bots {
                group.addTask {
                    var found = Set<String>()
                    if let view = try? await self.botThreadsView(botId: bot.id) {
                        found.formUnion(view.conversations.map(\.threadId))
                        found.formUnion(view.workers.map(\.threadId))
                    }
                    if let older: Studio.BotThreadsOlderOutput = try? await self.rpc("studio", Studio.Method.bot_threads_older,
                                                                                     ["botId": .string(bot.id)]) {
                        found.formUnion((older.conversations ?? []).compactMap(\.threadId))
                        found.formUnion((older.workers ?? []).compactMap(\.threadId))
                        found.formUnion((older.finished ?? []).compactMap(\.threadId))
                    }
                    return found
                }
            }
            for await found in group { ids.formUnion(found) }
        }
        return ids
    }
}
