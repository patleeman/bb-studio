import Foundation

struct BotLibraryItem: Equatable, Identifiable {
    enum Kind: String, CaseIterable { case page, whiteboard, design, app, artifact, recording, other }

    var id: String { pluginId + ":" + itemId }
    var pluginId: String
    var itemId: String
    var title: String
    var kind: Kind
    var type: String?
    var href: String?
    var updatedAt: Double

    init(pluginId: String, itemId: String, title: String, kind: Kind, type: String? = nil, href: String? = nil, updatedAt: Double) {
        self.pluginId = pluginId
        self.itemId = itemId
        self.title = title
        self.kind = kind
        self.type = type
        self.href = href
        self.updatedAt = updatedAt
    }

    init?(_ wire: Studio.BotLibraryOutputItemsItem) {
        guard let pluginId = wire.pluginId, let id = wire.id, !id.isEmpty else { return nil }
        let kind: Kind = switch wire.kind {
        case .page: .page
        case .whiteboard: .whiteboard
        case .design: .design
        case .app: .app
        case .artifact: .artifact
        case .recording: .recording
        case .other, .unknown, nil: .other
        }
        self.init(pluginId: pluginId, itemId: id, title: MemoryFormat.title(wire.title), kind: kind, type: wire.type, href: wire.href,
                  updatedAt: wire.updatedAt ?? 0)
    }

    /// Where it opens, pushed with the same bar.
    var route: Route? {
        switch pluginId {
        case "pages": .page(id: itemId)
        case "talk": .recording(id: itemId)
        case "excalidraw": .drawing(id: itemId)
        case "artifacts": .artifact(id: itemId)
        case "design": .design(id: itemId)
        case "minis": .mini(id: itemId)
        default: href.flatMap(Route.init(href:))
        }
    }

    /// Its kind as StudioKind names them, for the glyph.
    var studioKind: String {
        switch pluginId {
        case "pages": "page"
        case "talk": "recording"
        case "excalidraw": "drawing"
        case "artifacts": "artifact"
        case "design": "design"
        case "minis": "mini"
        default: type ?? "other"
        }
    }
}

/// The Library (design 8e): everything the Bot made, newest first, by kind.
enum LibraryPage {
    enum Filter: String, CaseIterable, Identifiable {
        case all, pages, designs, recordings, drawings, apps
        var id: String { rawValue }
        var title: String { rawValue.capitalized }

        func matches(_ kind: BotLibraryItem.Kind) -> Bool {
            switch self {
            case .all: true
            case .pages: kind == .page
            case .designs: kind == .design
            case .recordings: kind == .recording
            case .drawings: kind == .whiteboard
            case .apps: kind == .app || kind == .artifact
            }
        }
    }

    struct Section: Equatable, Identifiable {
        var id: String
        var title: String
        var items: [BotLibraryItem]
    }

    static func label(_ kind: BotLibraryItem.Kind) -> String {
        switch kind {
        case .app, .artifact: "App"
        case .whiteboard: "Drawing"
        case .other: "File"
        default: kind.rawValue.capitalized
        }
    }

    static func passes(_ item: BotLibraryItem, query: String, filter: Filter) -> Bool {
        guard filter.matches(item.kind) else { return false }
        let title = item.title.lowercased()
        return MemoryHistory.words(query).allSatisfy(title.contains)
    }

    static func dateGroup(_ at: Double, now: Date) -> (key: String, title: String) {
        let today = Calendar.current.startOfDay(for: now).timeIntervalSince1970 * 1000
        let day = 86_400_000.0
        if at >= today { return ("today", "Today") }
        if at >= today - day { return ("yesterday", "Yesterday") }
        if at >= today - 6 * day { return ("week", "This week") }
        if at >= today - 29 * day { return ("month", "This month") }
        return ("older", "Older")
    }

    /// The shown items in date sections, newest first.
    static func sections(_ items: [BotLibraryItem], query: String, filter: Filter, now: Date = .now) -> [Section] {
        var sections: [Section] = []
        for item in items.filter({ passes($0, query: query, filter: filter) }).sorted(by: { $0.updatedAt > $1.updatedAt }) {
            let group = dateGroup(item.updatedAt, now: now)
            if sections.last?.id == group.key { sections[sections.count - 1].items.append(item) } else {
                sections.append(Section(id: group.key, title: group.title, items: [item]))
            }
        }
        return sections
    }

    /// "Page · 9:40" today, "Page · Tue" this week, else "Page · Nov 3".
    static func meta(_ item: BotLibraryItem, now: Date = .now) -> String {
        let date = Date(timeIntervalSince1970: item.updatedAt / 1000)
        let when: String = switch dateGroup(item.updatedAt, now: now).key {
        case "today": date.formatted(date: .omitted, time: .shortened)
        case "yesterday": "Yesterday"
        case "week": date.formatted(.dateTime.weekday(.abbreviated))
        default: MemoryFormat.shortDate(item.updatedAt, now: now)
        }
        return "\(label(item.kind)) · \(when)"
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
    var archived: Bool

    init?(_ wire: Studio.BotFinishedOutputFinished?) {
        guard let wire, let id = wire.threadId else { return nil }
        threadId = id
        title = wire.title.flatMap { $0.isEmpty ? nil : $0 } ?? "Untitled"
        summary = wire.summary ?? ""
        startedAt = wire.startedAt
        finishedAt = wire.finishedAt
        archived = wire.archived ?? true
    }
}

extension BBClient {
    func botLibrary(botId: String?) async throws -> [BotLibraryItem] {
        let output: Studio.BotLibraryOutput = try await rpc("studio", Studio.Method.bot_library, Self.scoped(botId))
        return (output.items ?? []).compactMap(BotLibraryItem.init).filter { $0.pluginId != "dashboards" }
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
