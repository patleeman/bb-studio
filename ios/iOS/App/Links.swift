import Foundation

enum LinkKind: String, CaseIterable, Hashable {
    case conversation, worker, bot
    case page, whiteboard, design, app, dashboard, artifact, recording
    case board
    case memory, library, automations, todos, archive
    case automation, todo, record
    case vscode
    case file, diff, browser, terminal, workflow

    enum Ref { case thread, item, bot, entry, run, none, path, url }

    var ref: Ref {
        switch self {
        case .conversation, .worker, .board: .thread
        case .page, .whiteboard, .design, .app, .dashboard, .artifact, .recording: .item
        case .bot, .memory, .library, .automations, .todos, .archive: .bot
        case .automation, .todo, .record: .entry
        case .workflow: .run
        case .vscode, .terminal: .none
        case .file, .diff: .path
        case .browser: .url
        }
    }

    var name: String {
        switch self {
        case .app: "App"
        case .board: "Visual Chat board"
        case .record: "Memory record"
        case .vscode: "VS Code"
        case .workflow: "Workflow run"
        case .browser: "Browser"
        default: rawValue.prefix(1).uppercased() + rawValue.dropFirst()
        }
    }
}

struct LinkRef: Hashable {
    var kind: LinkKind
    var id: String?

    var link: String {
        guard let id else { return "bb://\(kind.rawValue)" }
        return "bb://\(kind.rawValue)/" + (id.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-._~"))) ?? id)
    }
}

enum LinkTarget: Hashable {
    case entity(LinkRef)
    case action(String)
    case external(URL)
}

enum LinkDestination: Equatable {
    case thread(String, worker: Bool)
    case bot(String)
    case botPage(BotPage, botId: String?)
    case route(Route)
    case record(String)
    case automation(String)
    case todo(String)
    case safari(URL)
    case threadFiles
    case elsewhere(String)
}

enum Links {
    static let actions = ["accounts", "edit-space"]

    static func itemKind(ofId id: String) -> LinkKind? {
        func match(_ pattern: String) -> Bool { id.range(of: pattern, options: .regularExpression) != nil }
        if match(#"^pg_[\w-]+$"#) { return .page }
        if match(#"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"#) || match(#"^drw_[0-9a-f]{16}$"#) { return .whiteboard }
        if match(#"^dsn_[0-9a-f]{16}$"#) { return .design }
        if match(#"^dsh_[0-9a-f]{16}$"#) { return .dashboard }
        if match(#"^mini_[0-9a-f]{16}$"#) { return .app }
        if match(#"^art_[0-9a-z]{16}$"#) { return .artifact }
        if match(#"^rec_[a-z0-9]{8,32}$"#) { return .recording }
        return nil
    }

    static func ref(_ kind: LinkKind, _ id: String?) -> LinkRef? {
        let id = id.flatMap { $0.isEmpty ? nil : $0 }
        switch kind.ref {
        case .item:
            guard let id, let actual = itemKind(ofId: id) else { return nil }
            return LinkRef(kind: actual, id: id)
        case .thread, .run, .entry, .path, .url:
            return id.map { LinkRef(kind: kind, id: $0) }
        case .none:
            return LinkRef(kind: kind, id: nil)
        case .bot:
            return kind == .bot && id == nil ? nil : LinkRef(kind: kind, id: id)
        }
    }

    private static let directiveKinds: [String: LinkKind] = [
        "page": .page, "drawing": .whiteboard, "whiteboard": .whiteboard, "design": .design, "mini": .app, "app": .app,
        "dashboard": .dashboard, "artifact": .artifact, "recording": .recording, "loop": .todos, "loops": .todos,
        "bot-thread": .conversation, "board": .board,
    ]

    private static func directive(_ text: String) -> LinkRef?? {
        guard let match = text.firstMatch(of: /^::([a-zA-Z-]+)\{([^}]*)\}$/) else { return .none }
        guard let kind = directiveKinds[String(match.1).lowercased()] else { return .some(nil) }
        var attributes: [String: String] = [:]
        for each in String(match.2).matches(of: /([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s"']+)))?/) {
            attributes[String(each.1)] = (each.2 ?? each.3 ?? each.4).map(String.init) ?? ""
        }
        let id = [attributes["id"], attributes["threadId"]].compactMap { $0 }.first { !$0.isEmpty }
        return .some(ref(kind, kind == .todos ? nil : id))
    }

    private static func scheme(_ rest: String) -> LinkRef? {
        let clean = String(rest.split(whereSeparator: { $0 == "?" || $0 == "#" }).first ?? "").trimmingPrefix(while: { $0 == "/" })
        let parts = clean.split(separator: "/", maxSplits: 1, omittingEmptySubsequences: false)
        let first = parts.first.map(String.init) ?? ""
        let tail = parts.count > 1 ? String(parts[1]) : ""
        if let kind = LinkKind(rawValue: first) {
            if tail.isEmpty { return ref(kind, nil) }
            guard let id = tail.removingPercentEncoding else { return nil }
            return ref(kind, id)
        }
        return refOfPath("/" + clean)
    }

    static func parse(_ text: String?, origin: URL? = nil) -> LinkTarget? {
        let link = text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !link.isEmpty else { return nil }
        if let parsed = directive(link) { return parsed.map(LinkTarget.entity) }
        if let match = link.firstMatch(of: /^(page|thread):([^\s\/?#]+)$/) {
            return ref(match.1 == "page" ? .page : .conversation, String(match.2).removingPercentEncoding).map(LinkTarget.entity)
        }
        let lower = link.lowercased()
        for prefix in ["bb://", "bbstudio://", "bbgo://"] where lower.hasPrefix(prefix) {
            let rest = String(link.dropFirst(prefix.count))
            let action = rest.split(whereSeparator: { $0 == "?" || $0 == "#" }).first.map { $0.trimmingCharacters(in: CharacterSet(charactersIn: "/")).lowercased() } ?? ""
            if prefix == "bb://", actions.contains(action) { return .action(action) }
            return scheme(rest).map(LinkTarget.entity)
        }
        if link.hasPrefix("/"), !link.hasPrefix("//") { return refOfPath(link).map(LinkTarget.entity) }
        guard let url = URL(string: link), let scheme = url.scheme?.lowercased() else { return nil }
        if scheme == "file" { return ref(.file, url.path(percentEncoded: false)).map(LinkTarget.entity) }
        if scheme == "http" || scheme == "https" {
            if let origin, url.host()?.lowercased() == origin.host()?.lowercased(), url.port == origin.port {
                return refOfPath(url.path(percentEncoded: true)).map(LinkTarget.entity)
            }
            return .external(url)
        }
        return scheme == "mailto" || scheme == "tel" ? .external(url) : nil
    }

    static func refOfPath(_ pathname: String) -> LinkRef? {
        var path = String(pathname.split(whereSeparator: { $0 == "?" || $0 == "#" }).first ?? "")
        while path.hasSuffix("/") { path.removeLast() }
        func decode(_ part: Substring) -> String? { String(part).removingPercentEncoding.flatMap { $0.isEmpty ? nil : $0 } }
        if let thread = path.firstMatch(of: /^\/(?:projects\/[^\/?#]+\/)?threads\/([^\/?#]+)(?:\/|$)/) {
            return decode(thread.1).map { LinkRef(kind: .conversation, id: $0) }
        }
        if let board = path.firstMatch(of: /^\/plugins\/studio-visual-chat\/canvas\/([^\/]+)$/) {
            guard let id = decode(board.1), id != "new" else { return nil }
            return LinkRef(kind: .board, id: id)
        }
        if path == "/plugins/studio/automations" { return LinkRef(kind: .automations, id: nil) }
        if path == "/plugins/studio/vscode" || path.hasPrefix("/plugins/studio/vscode/") { return LinkRef(kind: .vscode, id: nil) }
        let root = "/plugins/studio/studio"
        if path == root { return LinkRef(kind: .library, id: nil) }
        guard path.hasPrefix(root + "/") else { return nil }
        let parts = path.dropFirst(root.count + 1).split(separator: "/", omittingEmptySubsequences: false)
        let first = parts.first.map(String.init) ?? ""
        let id = parts.count > 1 ? decode(parts[1]) : nil
        let extra = parts.count > 2
        switch first {
        case "memory": return extra ? nil : LinkRef(kind: .memory, id: id)
        case "conversations": return extra ? nil : LinkRef(kind: .archive, id: id)
        case "automation", "todo", "record":
            guard let id, !extra, let kind = LinkKind(rawValue: first) else { return nil }
            return LinkRef(kind: kind, id: id)
        case "bot":
            guard let id, id != "new" else { return nil }
            if parts.count == 3, parts[2] == "loops" { return LinkRef(kind: .todos, id: id) }
            return extra ? nil : LinkRef(kind: .bot, id: id)
        default:
            let segments: Set<String> = ["pages", "apps", "drawings", "designs", "dashboards", "minis", "artifacts", "recordings"]
            guard let id, segments.contains(first), let kind = itemKind(ofId: id) else { return nil }
            return LinkRef(kind: kind, id: id)
        }
    }

    static func needsResolution(_ ref: LinkRef) -> Bool {
        guard ref.kind.ref != .none, ref.kind != .browser else { return false }
        return ref.id != nil
    }

    static func destination(_ ref: LinkRef) -> LinkDestination {
        let id = ref.id
        switch ref.kind {
        case .conversation: return id.map { .thread($0, worker: false) } ?? .elsewhere("That link names no conversation.")
        case .worker: return id.map { .thread($0, worker: true) } ?? .elsewhere("That link names no worker.")
        case .bot: return id.map(LinkDestination.bot) ?? .elsewhere("That link names no Bot.")
        case .memory: return .botPage(.memory, botId: id)
        case .library: return .botPage(.library, botId: id)
        case .automations: return .botPage(.automations, botId: id)
        case .todos: return .botPage(.todos, botId: id)
        case .archive: return .botPage(.archive, botId: id)
        case .automation: return id.map(LinkDestination.automation) ?? .botPage(.automations, botId: nil)
        case .todo: return id.map(LinkDestination.todo) ?? .botPage(.todos, botId: nil)
        case .record: return id.map(LinkDestination.record) ?? .botPage(.memory, botId: nil)
        case .page: return id.map { .route(.page(id: $0)) } ?? .elsewhere("That link names no page.")
        case .whiteboard: return id.map { .route(.drawing(id: $0)) } ?? .elsewhere("That link names no whiteboard.")
        case .design: return id.map { .route(.design(id: $0)) } ?? .elsewhere("That link names no design.")
        case .app: return id.map { .route(.mini(id: $0)) } ?? .elsewhere("That link names no app.")
        case .dashboard: return id.map { .route(.dashboard(id: $0)) } ?? .elsewhere("That link names no dashboard.")
        case .artifact: return id.map { .route(.artifact(id: $0)) } ?? .elsewhere("That link names no artifact.")
        case .recording: return id.map { .route(.recording(id: $0)) } ?? .elsewhere("That link names no recording.")
        case .board: return .route(.visualChat(threadId: id))
        case .browser:
            guard let id, let url = URL(string: id), ["http", "https"].contains(url.scheme?.lowercased() ?? "") else { return .elsewhere("That link names no web page.") }
            return .safari(url)
        case .file, .diff: return .threadFiles
        case .terminal: return .elsewhere("Open terminals from the thread's ⋯ menu.")
        case .vscode: return .elsewhere("VS Code opens on your Mac.")
        case .workflow: return .elsewhere("Workflow runs open on your Mac.")
        }
    }
}

struct LinkResolution: Equatable {
    var found: Bool
    var title: String?
}

extension BBClient {
    func resolveLink(_ ref: LinkRef, threadId: String?) async throws -> LinkResolution {
        let output: Studio.LinksResolveOutput = try await rpc("studio", Studio.Method.links_resolve, [
            "kind": .string(ref.kind.rawValue), "id": .from(ref.id), "threadId": .from(threadId),
        ])
        return LinkResolution(found: output.found ?? true, title: output.title)
    }
}
