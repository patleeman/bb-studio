import Foundation

/// One tab in a conversation's Workspace (the desktop's side panel), as
/// Studio keeps it per conversation (`threadWorkbenchGet`).
public struct WorkspaceTab: Identifiable, Hashable, Sendable {
    public enum Support: String, Sendable { case native, web, desktopOnly }

    public struct Ref: Hashable, Sendable {
        /// `tab-kinds.ts`'s kind (`page`, `design`, `file`…) or `plugin`.
        public var kind: String
        public var id: String?
        public var path: String?
        public var environmentId: String?
        public var url: String?
        public var terminalId: String?
        public var pluginId: String?
        public var tabId: String?

        public init(kind: String, id: String? = nil, path: String? = nil, environmentId: String? = nil, url: String? = nil,
                    terminalId: String? = nil, pluginId: String? = nil, tabId: String? = nil) {
            self.kind = kind
            self.id = id
            self.path = path
            self.environmentId = environmentId
            self.url = url
            self.terminalId = terminalId
            self.pluginId = pluginId
            self.tabId = tabId
        }
    }

    public var id: String
    public var ref: Ref
    public var title: String
    public var position: Int
    public var openedByAgent: Bool
    public var support: Support

    public init(id: String, ref: Ref, title: String, position: Int = 0, openedByAgent: Bool = false, support: Support = .native) {
        self.id = id
        self.ref = ref
        self.title = title
        self.position = position
        self.openedByAgent = openedByAgent
        self.support = support
    }

    /// Views that hold a web view or a live document: at most two stay loaded.
    public var heavy: Bool {
        ["page", "design", "whiteboard", "app", "artifact", "browser", "plugin", "recording", "terminal"].contains(ref.kind) || support == .web
    }

    /// A browser tab's URL, only when it is http(s): anything else is refused on the phone.
    public var safeURL: URL? {
        guard let raw = ref.url, let url = URL(string: raw), let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http",
              url.host?.isEmpty == false else { return nil }
        return url
    }
}

/// A conversation's Workspace: its tabs in order, the active one, and the version mutations build on.
public struct WorkspaceState: Equatable, Sendable {
    public var threadId: String
    public var tabs: [WorkspaceTab]
    public var activeTabId: String?
    public var version: Int

    public init(threadId: String, tabs: [WorkspaceTab] = [], activeTabId: String? = nil, version: Int = 0) {
        self.threadId = threadId
        self.tabs = tabs
        self.activeTabId = activeTabId
        self.version = version
    }
}

/// Which heavy tab views stay loaded: the newest first, at most `limit`.
public enum WorkspaceMounted {
    public static func touch(_ mounted: [String], _ id: String, heavy: Bool, limit: Int = 2) -> [String] {
        guard heavy else { return mounted }
        return Array(([id] + mounted.filter { $0 != id }).prefix(limit))
    }

    /// Drops tabs that are gone.
    public static func prune(_ mounted: [String], keeping ids: Set<String>) -> [String] {
        mounted.filter(ids.contains)
    }

    /// The tab views to keep in the hierarchy, in tab order: the loaded heavy
    /// ones and the shown one. One list, so a tab keeps its view (its web view)
    /// whether it shows or hides.
    public static func kept(_ tabs: [WorkspaceTab], mounted: [String], shown: String?) -> [WorkspaceTab] {
        tabs.filter { $0.id == shown || ($0.heavy && mounted.contains($0.id)) }
    }
}

extension WorkspaceTab {
    init?(tabId: String?, kind: String?, id: String?, path: String?, environmentId: String?, url: String?, terminalId: String?,
          pluginId: String?, refTabId: String?, title: String?, position: Int?, agent: Bool, support: String?) {
        guard let tabId, !tabId.isEmpty, let kind else { return nil }
        let ref = Ref(kind: kind, id: id, path: path, environmentId: environmentId, url: url, terminalId: terminalId, pluginId: pluginId,
                      tabId: refTabId)
        let fallback = path.map { ($0 as NSString).lastPathComponent } ?? url ?? kind.capitalized
        self.init(id: tabId, ref: ref, title: (title?.isEmpty == false ? title : nil) ?? fallback, position: position ?? 0,
                  openedByAgent: agent, support: support.flatMap(Support.init(rawValue:)) ?? .web)
    }
}

private func kindName<K: Encodable>(_ kind: K?) -> String? {
    guard let kind, let data = try? JSONEncoder().encode(kind), let string = try? JSONDecoder().decode(String.self, from: data) else { return nil }
    return string
}

extension WorkspaceState {
    init(_ output: Studio.ThreadWorkbenchGetOutput, threadId: String) {
        self.init(threadId: output.threadId ?? threadId, tabs: (output.tabs ?? []).compactMap { item in
            WorkspaceTab(tabId: item.tabId, kind: kindName(item.ref?.kind), id: item.ref?.id, path: item.ref?.path,
                         environmentId: item.ref?.environmentId, url: item.ref?.url, terminalId: item.ref?.terminalId,
                         pluginId: item.ref?.pluginId, refTabId: item.ref?.tabId, title: item.title, position: item.position,
                         agent: kindName(item.openedBy) == "agent", support: kindName(item.mobileSupport))
        }.sorted { $0.position < $1.position }, activeTabId: output.activeTabId, version: output.version ?? 0)
    }

    init(_ output: Studio.ThreadWorkbenchMutateOutput, threadId: String) {
        self.init(threadId: output.threadId ?? threadId, tabs: (output.tabs ?? []).compactMap { item in
            WorkspaceTab(tabId: item.tabId, kind: kindName(item.ref?.kind), id: item.ref?.id, path: item.ref?.path,
                         environmentId: item.ref?.environmentId, url: item.ref?.url, terminalId: item.ref?.terminalId,
                         pluginId: item.ref?.pluginId, refTabId: item.ref?.tabId, title: item.title, position: item.position,
                         agent: kindName(item.openedBy) == "agent", support: kindName(item.mobileSupport))
        }.sorted { $0.position < $1.position }, activeTabId: output.activeTabId, version: output.version ?? 0)
    }
}

/// What a mutation came back with.
public enum WorkspaceResult: String, Sendable { case ok, unchanged, conflict, notFound, refused, other }

extension BBClient {
    public func workspace(threadId: String) async throws -> WorkspaceState? {
        let output: Studio.ThreadWorkbenchGetOutput? = try await rpcIfPresent(
            "studio", Studio.Method.threadWorkbenchGet, .object(["threadId": .string(threadId)]))
        return output.map { WorkspaceState($0, threadId: threadId) }
    }

    /// One mutation (`open`, `close`, `focus`, `reorder`, `update`) against `baseVersion`.
    public func mutateWorkspace(threadId: String, baseVersion: Int, op: String, tabId: String? = nil, ref: WorkspaceTab.Ref? = nil,
                                title: String? = nil, position: Int? = nil, focus: Bool? = nil, origin: String)
        async throws -> (WorkspaceState, WorkspaceResult, String?)
    {
        var input: [String: JSONValue] = ["threadId": .string(threadId), "baseVersion": .number(Double(baseVersion)), "op": .string(op),
                                          "origin": .string(origin)]
        if let tabId { input["tabId"] = .string(tabId) }
        if let title { input["title"] = .string(title) }
        if let position { input["position"] = .number(Double(position)) }
        if let focus { input["focus"] = .bool(focus) }
        if let ref {
            var tab: [String: JSONValue] = ["kind": .string(ref.kind)]
            for (key, value) in [("id", ref.id), ("path", ref.path), ("environmentId", ref.environmentId), ("url", ref.url),
                                 ("terminalId", ref.terminalId), ("pluginId", ref.pluginId), ("tabId", ref.tabId)] {
                if let value { tab[key] = .string(value) }
            }
            input["tab"] = .object(tab)
        }
        let output: Studio.ThreadWorkbenchMutateOutput = try await rpc("studio", Studio.Method.threadWorkbenchMutate, .object(input))
        let result = kindName(output.result).flatMap(WorkspaceResult.init(rawValue:)) ?? .other
        return (WorkspaceState(output, threadId: threadId), result, output.message)
    }

    /// Tells Studio which conversations this phone shows, so agents' `workbench_open` reaches it (forgotten after 12 s).
    public func workspaceShown(threadIds: [String], origin: String) async throws {
        let _: JSONValue = try await rpc("studio", Studio.Method.threadWorkbenchShown,
                                         .object(["threadIds": .array(threadIds.prefix(50).map(JSONValue.string)), "origin": .string(origin)]))
    }
}
