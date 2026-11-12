import Foundation

struct MemoryRecord: Equatable, Identifiable, Hashable {
    enum SourceKind: String { case conversation, worker, thread, page, manual }
    enum SourceState: String { case live, finished, missing }

    struct Source: Equatable, Hashable {
        var kind: SourceKind
        var id: String?
        var title: String
        var section: String?
    }

    var id: String
    var botId: String
    var topic: String
    var text: String
    var createdAt: Double
    var source: Source
    var sourceState: SourceState?
    var replaces: (text: String, createdAt: Double)?
    var replacedById: String?
    var replacedAt: Double?
    var archived: Bool

    var isReplaced: Bool { replacedById != nil }

    static func == (a: MemoryRecord, b: MemoryRecord) -> Bool {
        a.id == b.id && a.topic == b.topic && a.text == b.text && a.replacedById == b.replacedById && a.archived == b.archived
            && a.sourceState == b.sourceState && a.replaces?.text == b.replaces?.text
    }

    func hash(into hasher: inout Hasher) { hasher.combine(id) }

    init(id: String, botId: String, topic: String, text: String, createdAt: Double, source: Source, sourceState: SourceState? = nil,
         replaces: (text: String, createdAt: Double)? = nil, replacedById: String? = nil, replacedAt: Double? = nil, archived: Bool = false) {
        self.id = id
        self.botId = botId
        self.topic = topic
        self.text = text
        self.createdAt = createdAt
        self.source = source
        self.sourceState = sourceState
        self.replaces = replaces
        self.replacedById = replacedById
        self.replacedAt = replacedAt
        self.archived = archived
    }

    init?(_ wire: Studio.MemoryListOutputRecordsItem) {
        guard let id = wire.id, !id.isEmpty else { return nil }
        let kind: SourceKind = switch wire.source?.kind {
        case .conversation: .conversation
        case .worker: .worker
        case .thread: .thread
        case .page: .page
        case .manual, .unknown, nil: .manual
        }
        let state: SourceState? = switch wire.sourceState {
        case .live: .live
        case .finished: .finished
        case .missing: .missing
        case .unknown, nil: nil
        }
        self.init(id: id, botId: wire.botId ?? "", topic: wire.topic ?? "", text: wire.text ?? "", createdAt: wire.createdAt ?? 0,
                  source: Source(kind: kind, id: wire.source?.id.flatMap { $0.isEmpty ? nil : $0 }, title: wire.source?.title ?? "",
                                 section: wire.source?.section.flatMap { $0.isEmpty ? nil : $0 }),
                  sourceState: state,
                  replaces: wire.replaces.flatMap { r in r.text.map { ($0, r.createdAt ?? 0) } },
                  replacedById: wire.replacedById.flatMap { $0.isEmpty ? nil : $0 }, replacedAt: wire.replacedAt,
                  archived: wire.archived ?? false)
    }

    init?<T: Encodable>(converting wire: T) {
        guard let data = try? JSONEncoder().encode(wire),
              let item = try? JSONDecoder().decode(Studio.MemoryListOutputRecordsItem.self, from: data) else { return nil }
        self.init(item)
    }
}

struct MemoryOverview: Equatable {
    struct Profile: Equatable {
        var pageId: String
        var title: String
        var updatedAt: Double
        var chars: Int
        var cap: Int
        var over: Bool
    }

    var botId: String
    var botName: String
    var profile: Profile?
    var current: Int
    var replaced: Int
    var archived: Int
    var topics: [(topic: String, count: Int)]

    static func == (a: MemoryOverview, b: MemoryOverview) -> Bool {
        a.botId == b.botId && a.profile == b.profile && a.current == b.current && a.replaced == b.replaced
            && a.archived == b.archived && a.topics.map(\.topic) == b.topics.map(\.topic) && a.topics.map(\.count) == b.topics.map(\.count)
    }

    init(_ wire: Studio.MemoryOverviewOutput) {
        botId = wire.bot?.id ?? ""
        botName = wire.bot?.name ?? ""
        profile = wire.profile.flatMap { p in
            p.pageId.map { Profile(pageId: $0, title: p.title ?? "", updatedAt: p.updatedAt ?? 0, chars: Int(p.chars ?? 0), cap: Int(p.cap ?? 0), over: p.over ?? false) }
        }
        current = Int(wire.counts?.current ?? 0)
        replaced = Int(wire.counts?.replaced ?? 0)
        archived = Int(wire.counts?.archived ?? 0)
        topics = (wire.topics ?? []).compactMap { each in each.topic.map { ($0, Int(each.count ?? 0)) } }
    }
}

enum MemoryPage {
    enum Sort: String, CaseIterable, Identifiable {
        case newest, oldest, topic
        var id: String { rawValue }
        var title: String { rawValue.capitalized }
    }

    static func sourceLabel(_ record: MemoryRecord) -> String {
        let source = record.source
        if source.kind == .manual {
            let title = source.title.isEmpty ? "Added by you" : source.title
            return title.prefix(1).lowercased() + title.dropFirst()
        }
        let quoted = source.kind == .worker || source.title == "Main" ? source.title : "“\(source.title)”"
        let state = switch record.sourceState {
        case .finished: " (finished)"
        case .missing: " (removed)"
        default: ""
        }
        return "from \(quoted)" + (source.section.map { " › \($0)" } ?? "") + state
    }

    enum SourceTarget: Equatable { case thread(String), page(String) }

    static func sourceTarget(_ record: MemoryRecord) -> SourceTarget? {
        guard let id = record.source.id, record.source.kind != .manual, record.sourceState != .missing else { return nil }
        return record.source.kind == .page ? .page(id) : .thread(id)
    }

    static func replacesLabel(_ record: MemoryRecord, now: Date = .now) -> String? {
        guard let replaces = record.replaces else { return nil }
        return "replaces “\(snippet(replaces.text))” (\(date(replaces.createdAt, now: now)))"
    }

    static func snippet(_ text: String, max: Int = 60) -> String {
        let line = text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        guard line.count > max else { return line }
        return String(line.prefix(max - 1)).trimmingCharacters(in: .whitespaces) + "…"
    }

    static func date(_ at: Double, now: Date = .now) -> String {
        let date = Date(timeIntervalSince1970: at / 1000)
        let calendar = Calendar.current
        let style = Date.FormatStyle.dateTime.month(.abbreviated).day()
        return calendar.component(.year, from: date) == calendar.component(.year, from: now)
            ? date.formatted(style) : date.formatted(style.year())
    }

    static func topicPills(_ topics: [(topic: String, count: Int)], picked: String?) -> [String] {
        var pills = topics.map(\.topic)
        if let picked, !pills.contains(where: { $0.caseInsensitiveCompare(picked) == .orderedSame }) { pills.append(picked) }
        return pills
    }

    static func searchPrompt(_ count: Int) -> String {
        "Search \(count.formatted()) record" + (count == 1 ? "" : "s")
    }

    static func split(_ records: [MemoryRecord]) -> (current: [MemoryRecord], replaced: [MemoryRecord]) {
        (records.filter { !$0.isReplaced }, records.filter(\.isReplaced))
    }

    static func profileCount(_ profile: MemoryOverview.Profile) -> String {
        "\(profile.chars.formatted()) of \(profile.cap.formatted()) characters"
    }

    static func canSave(topic: String, text: String, initial: (topic: String, text: String)) -> Bool {
        let topic = topic.trimmingCharacters(in: .whitespacesAndNewlines)
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !topic.isEmpty, !text.isEmpty, topic.count <= 60, text.count <= 4000 else { return false }
        return topic != initial.topic || text != initial.text.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

struct BotLibraryItem: Equatable, Identifiable {
    enum Kind: String, CaseIterable { case page, whiteboard, design, app, artifact, other }

    struct MadeIn: Equatable {
        var threadId: String
        var title: String
        var worker: Bool
        var conversationId: String?
        var conversationTitle: String?
    }

    var id: String { pluginId + ":" + itemId }
    var pluginId: String
    var itemId: String
    var title: String
    var kind: Kind
    var type: String?
    var href: String?
    var updatedAt: Double
    var madeIn: MadeIn?

    init(pluginId: String, itemId: String, title: String, kind: Kind, type: String? = nil, href: String? = nil, updatedAt: Double, madeIn: MadeIn? = nil) {
        self.pluginId = pluginId
        self.itemId = itemId
        self.title = title
        self.kind = kind
        self.type = type
        self.href = href
        self.updatedAt = updatedAt
        self.madeIn = madeIn
    }

    init?(_ wire: Studio.BotLibraryOutputItemsItem) {
        guard let pluginId = wire.pluginId, let id = wire.id, !id.isEmpty else { return nil }
        let kind: Kind = switch wire.kind {
        case .page: .page
        case .whiteboard: .whiteboard
        case .design: .design
        case .app: .app
        case .artifact: .artifact
        case .other, .unknown, nil: .other
        }
        let title = wire.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        self.init(pluginId: pluginId, itemId: id, title: title.isEmpty ? "Untitled" : title, kind: kind, type: wire.type, href: wire.href,
                  updatedAt: wire.updatedAt ?? 0,
                  madeIn: wire.madeIn.flatMap { made in
                      made.threadId.map { MadeIn(threadId: $0, title: made.title ?? "", worker: made.kind == .worker,
                                                 conversationId: made.conversationId, conversationTitle: made.conversationTitle) }
                  })
    }

    var route: Route? {
        switch pluginId {
        case "pages": .page(id: itemId)
        case "talk": .recording(id: itemId)
        case "excalidraw": .drawing(id: itemId)
        case "artifacts": .artifact(id: itemId)
        case "design": .design(id: itemId)
        case "dashboards": .dashboard(id: itemId)
        case "minis": .mini(id: itemId)
        default: href.flatMap(Route.init(href:))
        }
    }

    var studioKind: String {
        switch pluginId {
        case "pages": "page"
        case "talk": "recording"
        case "excalidraw": "drawing"
        case "artifacts": "artifact"
        case "design": "design"
        case "dashboards": "dashboard"
        case "minis": "mini"
        default: type ?? "other"
        }
    }
}

struct BotLibraryRow: Equatable, Identifiable {
    var id: String
    var item: BotLibraryItem
    var count: Int
}

struct BotLibraryGroup: Equatable, Identifiable {
    var id: String
    var title: String
    var threadId: String?
    var count: Int
    var rows: [BotLibraryRow]
}

enum LibraryPage {
    enum GroupBy: String, CaseIterable, Identifiable {
        case conversation, kind, date
        var id: String { rawValue }
        var title: String { rawValue.capitalized }
    }

    static let fold = 8
    static let filters: [BotLibraryItem.Kind] = [.page, .whiteboard, .design, .app, .artifact]

    static func label(_ kind: BotLibraryItem.Kind) -> String {
        kind == .other ? "Other" : kind.rawValue.capitalized
    }

    static func provenance(_ item: BotLibraryItem) -> String {
        guard let made = item.madeIn else { return "made by you" }
        return made.worker ? "by \(made.title)" : "made in \(made.title)"
    }

    static func meta(_ item: BotLibraryItem, groupBy: GroupBy, now: Date = .now) -> String {
        var parts: [String] = []
        if groupBy != .kind { parts.append(label(item.kind)) }
        if !(groupBy == .conversation && item.madeIn.map { !$0.worker } == true) { parts.append(provenance(item)) }
        parts.append(BotShell.shortAge(item.updatedAt, now: now))
        return parts.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    static func passes(_ item: BotLibraryItem, query: String, kind: BotLibraryItem.Kind?) -> Bool {
        if let kind, item.kind != kind { return false }
        let words = query.lowercased().split(whereSeparator: \.isWhitespace)
        guard !words.isEmpty else { return true }
        let text = "\(item.title) \(provenance(item)) \(item.madeIn?.conversationTitle ?? "")".lowercased()
        return words.allSatisfy { text.contains($0) }
    }

    static func titleStem(_ title: String) -> String {
        let clean = title.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        var head = clean
        if let colon = clean.firstIndex(of: ":"), clean.distance(from: clean.startIndex, to: colon) >= 12 { head = String(clean[..<colon]) }
        head = head.replacingOccurrences(of: #"\.[a-z0-9]{2,4}$"#, with: "", options: .regularExpression)
        head = head.replacingOccurrences(of: #"\d+"#, with: "#", options: .regularExpression)
        head = head.replacingOccurrences(of: #"[\s…·-]+"#, with: " ", options: .regularExpression)
        return head.trimmingCharacters(in: .whitespaces)
    }

    static func rows(_ items: [BotLibraryItem]) -> [BotLibraryRow] {
        var order: [String] = []
        var rows: [String: BotLibraryRow] = [:]
        for item in items {
            let key = item.madeIn.map { "\($0.threadId)|\(item.kind.rawValue)|\(titleStem(item.title))" } ?? item.id
            if rows[key] != nil { rows[key]?.count += 1 } else {
                order.append(key)
                rows[key] = BotLibraryRow(id: key, item: item, count: 1)
            }
        }
        return order.compactMap { rows[$0] }
    }

    static func folded(_ rows: [BotLibraryRow], open: Bool) -> (shown: [BotLibraryRow], more: Int) {
        guard !open, rows.count > fold else { return (rows, 0) }
        return (Array(rows.prefix(fold)), rows.count - fold)
    }

    static func dateGroup(_ at: Double, now: Date) -> (key: String, title: String, order: Int) {
        let today = Calendar.current.startOfDay(for: now).timeIntervalSince1970 * 1000
        let day = 86_400_000.0
        if at >= today { return ("today", "Today", 0) }
        if at >= today - day { return ("yesterday", "Yesterday", 1) }
        if at >= today - 6 * day { return ("week", "This week", 2) }
        if at >= today - 29 * day { return ("month", "This month", 3) }
        return ("older", "Older", 4)
    }

    static func groups(_ items: [BotLibraryItem], query: String, kind: BotLibraryItem.Kind?, groupBy: GroupBy, now: Date = .now) -> [BotLibraryGroup] {
        let shown = items.filter { passes($0, query: query, kind: kind) }.sorted { $0.updatedAt > $1.updatedAt }
        var order: [String] = []
        var groups: [String: (group: BotLibraryGroup, order: Int, items: [BotLibraryItem])] = [:]
        for item in shown {
            let key: String, title: String, rank: Int
            var threadId: String?
            switch groupBy {
            case .kind:
                key = item.kind.rawValue
                title = label(item.kind) + "s"
                rank = BotLibraryItem.Kind.allCases.firstIndex(of: item.kind) ?? 0
            case .date:
                (key, title, rank) = dateGroup(item.updatedAt, now: now)
            case .conversation:
                threadId = item.madeIn.map { $0.conversationId ?? $0.threadId }
                key = threadId ?? "you"
                title = item.madeIn.map { $0.conversationTitle ?? $0.title } ?? "Made by you"
                rank = 0
            }
            if groups[key] == nil {
                order.append(key)
                groups[key] = (BotLibraryGroup(id: key, title: title, threadId: threadId, count: 0, rows: []), rank, [])
            }
            groups[key]?.items.append(item)
        }
        var list = order.compactMap { groups[$0] }
        if groupBy != .conversation { list.sort { $0.order < $1.order } }
        return list.map { entry in
            var group = entry.group
            group.count = entry.items.count
            group.rows = rows(entry.items)
            return group
        }
    }
}

struct ArchiveData: Equatable {
    struct Conversation: Equatable, Identifiable {
        var id: String { threadId }
        var threadId: String
        var title: String
        var at: Double
        var finished: Bool
        var summary: String
    }

    struct Worker: Equatable, Identifiable {
        var id: String { threadId }
        var threadId: String
        var title: String
        var status: BotWorker.Status
        var ownerTitle: String?
        var tag: String?
        var updatedAt: Double
    }

    var conversations: [Conversation]
    var workers: [Worker]

    init(conversations: [Conversation], workers: [Worker]) {
        self.conversations = conversations
        self.workers = workers
    }

    init(_ wire: Studio.BotThreadsOlderOutput) {
        let older = (wire.conversations ?? []).compactMap { row -> Conversation? in
            guard let id = row.threadId else { return nil }
            return Conversation(threadId: id, title: row.title.flatMap { $0.isEmpty ? nil : $0 } ?? "Untitled", at: row.updatedAt ?? 0, finished: false, summary: "")
        }
        let finished = (wire.finished ?? []).compactMap { row -> Conversation? in
            guard let id = row.threadId else { return nil }
            return Conversation(threadId: id, title: row.title.flatMap { $0.isEmpty ? nil : $0 } ?? "Untitled", at: row.finishedAt ?? 0, finished: true, summary: row.summary ?? "")
        }
        conversations = (older + finished).sorted { $0.at > $1.at }
        workers = (wire.workers ?? []).compactMap { row in
            guard let id = row.threadId else { return nil }
            let status: BotWorker.Status = switch row.status {
            case .running: .running
            case .needs_you: .needsYou
            case .failed: .failed
            case .done, nil: .done
            case .unknown(let value): .other(value)
            }
            return Worker(threadId: id, title: row.title.flatMap { $0.isEmpty ? nil : $0 } ?? "Worker", status: status,
                          ownerTitle: row.ownerTitle.flatMap { $0.isEmpty ? nil : $0 }, tag: row.tag.flatMap { $0.isEmpty ? nil : $0 }, updatedAt: row.updatedAt ?? 0)
        }
    }
}

enum ArchivePage {
    enum Filter: String, CaseIterable, Identifiable {
        case all, conversations, workers, failed
        var id: String { rawValue }
        var title: String { rawValue.capitalized }
    }

    static func matches(_ query: String, _ texts: String?...) -> Bool {
        let words = query.lowercased().split(whereSeparator: \.isWhitespace)
        let text = texts.compactMap { $0 }.joined(separator: " ").lowercased()
        return words.allSatisfy { text.contains($0) }
    }

    static func shown(_ data: ArchiveData, query: String, filter: Filter) -> (conversations: [ArchiveData.Conversation], workers: [ArchiveData.Worker]) {
        let conversations = filter == .all || filter == .conversations ? data.conversations.filter { matches(query, $0.title) } : []
        let workers = filter == .conversations ? [] : data.workers.filter {
            (filter != .failed || $0.status == .failed) && matches(query, $0.title, $0.ownerTitle, $0.tag)
        }
        return (conversations, workers)
    }

    static func count(_ data: ArchiveData, _ filter: Filter) -> Int? {
        switch filter {
        case .all: nil
        case .conversations: data.conversations.count
        case .workers: data.workers.count
        case .failed: data.workers.filter { $0.status == .failed }.count
        }
    }

    static func staleFailure(_ worker: ArchiveData.Worker, now: Date = .now) -> Bool {
        worker.status == .failed && now.timeIntervalSince1970 * 1000 - worker.updatedAt > 7 * 86_400_000
    }

    static func statusLabel(_ worker: ArchiveData.Worker) -> String {
        switch worker.status {
        case .running: "Running"
        case .needsYou: "Waiting on you"
        case .failed: "Failed"
        case .done, .other: "Done"
        }
    }

    static func emptyText(query: String, filter: Filter) -> String {
        !query.trimmingCharacters(in: .whitespaces).isEmpty || filter != .all ? "Nothing matches" : "Nothing archived"
    }
}

struct FinishedConversation: Equatable {
    var threadId: String
    var title: String
    var summary: String
    var startedAt: Double?
    var finishedAt: Double?
    var records: Int
    var archived: Bool

    init?(_ wire: Studio.BotFinishedOutputFinished?) {
        guard let wire, let id = wire.threadId else { return nil }
        threadId = id
        title = wire.title.flatMap { $0.isEmpty ? nil : $0 } ?? "Untitled"
        summary = wire.summary ?? ""
        startedAt = wire.startedAt
        finishedAt = wire.finishedAt
        records = Int(wire.records ?? 0)
        archived = wire.archived ?? true
    }

    var recordsLabel: String? {
        records == 0 ? nil : records == 1 ? "1 memory record" : "\(records) memory records"
    }
}

extension BBClient {
    func memoryOverview(botId: String?) async throws -> MemoryOverview {
        let output: Studio.MemoryOverviewOutput = try await rpc("studio", Studio.Method.memory_overview, Self.scoped(botId))
        return MemoryOverview(output)
    }

    func memoryRecords(botId: String?, query: String, topic: String?, sort: MemoryPage.Sort) async throws -> (records: [MemoryRecord], total: Int) {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let input = Self.scoped(botId, ["query": trimmed.isEmpty ? JSONValue?.none : .string(trimmed), "topic": topic.map(JSONValue.string),
                                        "sort": .string(sort.rawValue), "limit": .number(300)])
        let output: Studio.MemoryListOutput = try await rpc("studio", Studio.Method.memory_list, input)
        return ((output.records ?? []).compactMap(MemoryRecord.init), Int(output.total ?? 0))
    }

    func memoryRecord(id: String) async throws -> MemoryRecord? {
        let output: Studio.MemoryGetOutput = try await rpc("studio", Studio.Method.memory_get, ["id": .string(id)])
        return output.record.flatMap { MemoryRecord(converting: $0) }
    }

    func memoryProfile(botId: String?) async throws -> String? {
        let output: Studio.MemoryProfileOutput = try await rpc("studio", Studio.Method.memory_profile, Self.scoped(botId))
        return output.profile?.markdown
    }

    @discardableResult
    func memoryAdd(botId: String?, topic: String, text: String) async throws -> MemoryRecord? {
        let output: Studio.MemoryAddOutput = try await rpc("studio", Studio.Method.memory_add,
                                                           Self.scoped(botId, ["topic": .string(topic), "text": .string(text)]))
        return output.record.flatMap { MemoryRecord(converting: $0) }
    }

    @discardableResult
    func memoryUpdate(botId: String?, id: String, text: String, topic: String?) async throws -> MemoryRecord? {
        let output: Studio.MemoryUpdateOutput = try await rpc("studio", Studio.Method.memory_update,
                                                              Self.scoped(botId, ["id": .string(id), "text": .string(text), "topic": topic.map(JSONValue.string)]))
        return output.record.flatMap { MemoryRecord(converting: $0) }
    }

    @discardableResult
    func memoryArchive(botId: String?, id: String, archived: Bool) async throws -> MemoryRecord? {
        let output: Studio.MemoryArchiveOutput = try await rpc("studio", Studio.Method.memory_archive,
                                                               Self.scoped(botId, ["id": .string(id), "archived": .bool(archived)]))
        return output.record.flatMap { MemoryRecord(converting: $0) }
    }

    func botLibrary(botId: String?) async throws -> [BotLibraryItem] {
        let output: Studio.BotLibraryOutput = try await rpc("studio", Studio.Method.bot_library, Self.scoped(botId))
        return (output.items ?? []).compactMap(BotLibraryItem.init)
    }

    func botArchive(botId: String?) async throws -> ArchiveData {
        let output: Studio.BotThreadsOlderOutput = try await rpc("studio", Studio.Method.bot_threads_older, Self.scoped(botId))
        return ArchiveData(output)
    }

    func botFinished(threadId: String) async throws -> FinishedConversation? {
        let output: Studio.BotFinishedOutput = try await rpc("studio", Studio.Method.bot_finished, ["threadId": .string(threadId)])
        return FinishedConversation(output.finished)
    }

    func botReopen(threadId: String) async throws {
        let output: Studio.BotReopenOutput = try await rpc("studio", Studio.Method.bot_reopen, ["threadId": .string(threadId)])
        guard output.ok != false else { throw BBError(status: 200, message: "It didn't reopen.") }
    }
}
