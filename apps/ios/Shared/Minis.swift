import Foundation

// Studio mini apps: small React apps with their own records and shared state
// (`minis:<id>`). The server compiles them and serves each version as a
// sandboxed frame document. The frame talks only to its host by postMessage
// (`{type:"bb-mini", op, …}`); the phone is that host, as
// packages/bb-studio/src/minis/ui/mini-frame.tsx is on the desktop. Network,
// BB access and sending to the agent need the desktop's approval flow, so the
// phone refuses them.

/// One mini app, as `minis.get` returns it. Only what the phone shows.
public struct MiniApp: Decodable, Identifiable, Hashable, Sendable {
    public struct Collection: Decodable, Hashable, Sendable {
        public var name: String
        public var count: Int
    }

    public struct Manifest: Decodable, Hashable, Sendable {
        public var description: String?
    }

    public var id: String
    public var name: String
    public var projectId: String?
    /// The version the frame runs; nil before the first save.
    public var versionId: String?
    public var updatedAt: Double
    public var archived: Bool
    public var threadId: String?
    public var manifest: Manifest?
    /// Capabilities the user approved.
    public var granted: [String]
    /// Capabilities that wait for the user, who approves them on the desktop.
    public var pending: [String]
    public var collections: [Collection]

    public var displayName: String {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return name.isEmpty ? "Untitled mini app" : name
    }

    /// How many records it keeps, over every collection.
    public var recordCount: Int { collections.reduce(0) { $0 + $1.count } }

    /// `mini_` and 16 lowercase hex digits.
    public static func isId(_ value: String) -> Bool {
        value.wholeMatch(of: /mini_[0-9a-f]{16}/) != nil
    }

    /// The access banner's text while capabilities wait, as the desktop says it; nil when none wait.
    public var accessText: String? {
        pending.isEmpty ? nil : "This mini app asks for access: \(pending.map(Self.describe).joined(separator: "; "))."
    }

    /// What a capability lets the app do, in plain words (the desktop's `describeCapability`).
    public static func describe(_ capability: String) -> String {
        if capability.hasPrefix("fetch:") {
            let host = String(capability.dropFirst(6))
            return "Reach \(host.hasPrefix("*.") ? "any address under " + host.dropFirst(2) : host) over the internet, through Studio"
        }
        if capability.hasPrefix("secret:") {
            return "Send the secret “\(capability.dropFirst(7))” you store for it, as a request header. The app never sees the value"
        }
        switch capability {
        case "bb.threads.read": return "See the titles of your recent threads"
        case "bb.studio.read": return "Search the titles of your Studio items"
        case "bb.open": return "Open threads and Studio items in BB"
        default: return capability
        }
    }
}

extension BBClient {
    private struct MiniGet: Decodable { var mini: MiniApp? }

    /// One mini app; nil when it's gone.
    public func mini(_ id: String) async throws -> MiniApp? {
        let result: MiniGet = try await rpc("studio", Studio.Method.minis_get, ["id": .string(id)])
        return result.mini
    }

    /// The frame document for one version. It runs in an opaque origin, so it
    /// can't reach BB itself; everything goes through the host.
    public func miniFrameURL(_ id: String, versionId: String, dark: Bool) -> URL {
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        components.path = MiniRelay.framePath
        components.queryItems = [
            URLQueryItem(name: "mini", value: id), URLQueryItem(name: "version", value: versionId),
            URLQueryItem(name: "theme", value: dark ? "dark" : "light"),
        ]
        return components.url!
    }

    /// An RPC whose input and result keep their object keys in order, so a
    /// record's fields reach the server and come back as the app wrote them.
    public func rpc<Result: OrderedRPCResult>(_ pluginId: String, _ method: String, ordered input: OrderedJSON) async throws -> Result {
        let data = try await rpcData(pluginId, method, body: Data(input.jsonText.utf8))
        guard let result = try OrderedJSON.parse(data)["result"] else {
            throw BBError(status: 200, message: "Missing result for \(pluginId).\(method)")
        }
        return try Result(orderedJSON: result)
    }
}

// MARK: The relay

/// What the host does with a frame's messages, without the web view, so it can be tested.
public enum MiniRelay {
    public static let message = "bb-mini"
    public static let framePath = "/api/v1/plugins/studio/http/minis/frame"
    /// How often an open copy tells the server it's still open.
    public static let heartbeat: Duration = .seconds(20)
    /// The fewest seconds between two `minis.live.touch` calls.
    public static let touchEvery: TimeInterval = 2

    /// A frame call as a Studio RPC: the method, its input, and which field of
    /// the result goes back to the frame (nil for the whole result).
    public struct Call: Equatable, Sendable {
        public var method: String
        public var input: OrderedJSON
        public var pick: String?
    }

    /// Why the phone won't make a call.
    public struct Refusal: Error, Equatable, Sendable {
        public var message: String
    }

    /// The RPC for a frame's `op:"call"`, as mini-frame.tsx `answer()` maps it.
    /// Network and BB calls need the desktop's approval flow, so they're refused.
    public static func call(_ method: String, params: OrderedJSON, miniId: String, clientId: String) -> Result<Call, Refusal> {
        let id = OrderedJSON.Field("id", .string(miniId))
        let client = OrderedJSON.Field("clientId", .string(clientId))
        // `String(params.collection ?? "")`
        let named = params["collection"].flatMap { $0.isNull ? nil : $0 } ?? .string("")
        let collection = OrderedJSON.Field("collection", .string(jsString(named)))
        let recordId = OrderedJSON.Field("recordId", .string(jsString(params["id"])))
        func object(_ value: OrderedJSON?) -> OrderedJSON {
            if let value, value.isRow { return value }
            return .object([])
        }
        switch method {
        case "db.find":
            return .success(Call(method: Studio.Method.minis_db_find, input: .object([id, collection, .init("query", object(params["query"]))]), pick: "records"))
        case "db.count":
            var query: [OrderedJSON.Field] = []
            if let filter = params["query"]?["where"], !filter.isNull { query.append(.init("where", filter)) }
            return .success(Call(method: Studio.Method.minis_db_count, input: .object([id, collection, .init("query", .object(query))]), pick: "count"))
        case "db.get":
            return .success(Call(method: Studio.Method.minis_db_get, input: .object([id, collection, recordId]), pick: "record"))
        case "db.insert":
            var fields = [id, client, collection, .init("data", object(params["data"]))]
            if truthy(params["id"]) { fields.append(recordId) }
            return .success(Call(method: Studio.Method.minis_db_insert, input: .object(fields), pick: "record"))
        case "db.update":
            var fields = [id, client, collection, recordId, .init("data", object(params["data"]))]
            if case .number(let rev)? = params["rev"] { fields.append(.init("rev", .number(rev))) }
            return .success(Call(method: Studio.Method.minis_db_update, input: .object(fields), pick: "record"))
        case "db.patch":
            return .success(Call(method: Studio.Method.minis_db_patch, input: .object([id, client, collection, recordId, .init("fields", object(params["fields"]))]), pick: "record"))
        case "db.remove":
            return .success(Call(method: Studio.Method.minis_db_remove, input: .object([id, client, collection, recordId]), pick: nil))
        case "fetch":
            return .failure(desktopOnly("reach the internet"))
        case "bb.threads.list":
            return .failure(desktopOnly("read your threads"))
        case "bb.studio.list":
            return .failure(desktopOnly("search Studio"))
        case "bb.open":
            return .failure(desktopOnly("open BB items"))
        default:
            return .failure(Refusal(message: "Unknown call \(method)."))
        }
    }

    public static func desktopOnly(_ what: String) -> Refusal {
        Refusal(message: "Open this mini app in BB on your computer to \(what).")
    }

    /// What the phone says when the app tries to send something to the agent.
    public static let sendRefused = "Open this mini app in BB on your computer to send it to the agent."

    /// The answer to a call, posted back into the frame.
    public static func reply(_ id: OrderedJSON, value: OrderedJSON) -> OrderedJSON {
        .object([.init("type", .string(message)), .init("op", .string("reply")), .init("id", id), .init("ok", .bool(true)), .init("value", value)])
    }

    public static func reply(_ id: OrderedJSON, error: String) -> OrderedJSON {
        .object([.init("type", .string(message)), .init("op", .string("reply")), .init("id", id), .init("ok", .bool(false)), .init("error", .string(error))])
    }

    /// The theme for the frame. Tokens are BB's CSS colors on the desktop; the
    /// phone sends only its font, and the frame keeps its own colors.
    public static func theme(dark: Bool) -> OrderedJSON {
        .object([
            .init("type", .string(message)), .init("op", .string("theme")), .init("theme", .string(dark ? "dark" : "light")),
            .init("tokens", .object([.init("--ui-font", .string("-apple-system, system-ui, sans-serif"))])),
        ])
    }

    /// What a realtime event on Studio's `minis` channel means for one open copy.
    public enum Event: Equatable, Sendable {
        /// Post this to the frame: new state, record changes, or an agent's command for this copy.
        case post(OrderedJSON)
        /// The source or grants changed: load the mini app again.
        case reload
        /// Something else changed, such as the name or record counts.
        case changed
    }

    public static func event(_ payload: JSONValue, miniId: String, clientId: String) -> Event? {
        guard payload["miniId"]?.stringValue == miniId else { return nil }
        let header: [OrderedJSON.Field] = [.init("type", .string(message))]
        switch payload["type"]?.stringValue {
        case "source", "grants":
            return .reload
        case "changed":
            return .changed
        case "state" where payload["origin"]?.stringValue != clientId:
            return .post(.object(header + [.init("op", .string("state")), .init("state", OrderedJSON(payload["state"] ?? .null))]))
        case "records":
            return .post(.object(header + [
                .init("op", .string("records")), .init("collection", OrderedJSON(payload["collection"] ?? .null)),
                .init("changes", OrderedJSON(payload["changes"] ?? .array([]))),
            ]))
        case "do" where payload["clientId"]?.stringValue == clientId:
            return .post(.object(header + [
                .init("op", .string("do")), .init("id", OrderedJSON(payload["commandId"] ?? .null)),
                .init("action", OrderedJSON(payload["action"] ?? .null)), .init("args", OrderedJSON(payload["args"] ?? .array([]))),
            ]))
        default:
            return nil
        }
    }

    /// `minis.live.result` input for a frame's answer to an agent's command.
    public static func result(_ message: OrderedJSON, clientId: String) -> OrderedJSON {
        var fields: [OrderedJSON.Field] = [.init("commandId", .string(jsString(message["id"]))), .init("clientId", .string(clientId))]
        if message["ok"]?.bool == true {
            fields += [.init("ok", .bool(true)), .init("value", message["value"] ?? .null)]
        } else {
            let error = message["error"].flatMap { $0.isNull ? nil : jsString($0) } ?? "The action failed."
            fields += [.init("ok", .bool(false)), .init("error", .string(String(error.prefix(2000))))]
        }
        return .object(fields)
    }

    /// The page the phone loads: the frame filling it, sandboxed as on the desktop.
    /// `frame` is relative to the server, which is the page's base URL.
    public static func hostDocument(frame: String, dark: Bool) -> String {
        let scheme = dark ? "dark" : "light"
        let escaped = frame.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "\"", with: "&quot;")
        return #"<!doctype html><html style="color-scheme:\#(scheme)"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0;height:100%;background:transparent}iframe{display:block;border:0;width:100%;height:100%;background:transparent}</style></head><body><iframe id="mini" sandbox="allow-scripts allow-forms allow-modals allow-downloads" referrerpolicy="no-referrer" src="\#(escaped)"></iframe></body></html>"#
    }

    /// Which loads the host's web view allows: the host page itself (its base
    /// URL is the server), and in the iframe only this mini app's frame.
    public static func allows(_ url: URL?, mainFrame: Bool, server: URL, miniId: String) -> Bool {
        guard let url else { return false }
        if url.absoluteString == "about:blank" { return true }
        guard url.scheme == server.scheme, url.host() == server.host(), url.port == server.port else { return false }
        if mainFrame { return ["", "/", server.path()].contains(url.path()) && url.query() == nil }
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        return url.path() == framePath && query.first { $0.name == "mini" }?.value == miniId
    }

    /// The path and query of a frame URL, for the host page's iframe.
    public static func relative(_ url: URL) -> String {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url.absoluteString }
        return components.percentEncodedPath + (components.percentEncodedQuery.map { "?" + $0 } ?? "")
    }

    /// JavaScript's `String(value)` for the values a frame sends as ids and names.
    static func jsString(_ value: OrderedJSON?) -> String {
        switch value {
        case nil: "undefined"
        case .null?: "null"
        case .string(let text)?: text
        case .number(let number)?: OrderedJSON.jsNumber(number)
        case .bool(let flag)?: flag ? "true" : "false"
        default: "[object Object]"
        }
    }

    /// JavaScript truthiness, for `params.id ? … : …`.
    static func truthy(_ value: OrderedJSON?) -> Bool {
        switch value {
        case nil, .null?: false
        case .bool(let flag)?: flag
        case .number(let number)?: number != 0 && !number.isNaN
        case .string(let text)?: !text.isEmpty
        default: true
        }
    }
}

extension OrderedJSON {
    /// Loose JSON in key order: dictionaries have none, so keys come sorted.
    public init(_ value: JSONValue) {
        switch value {
        case .null: self = .null
        case .bool(let flag): self = .bool(flag)
        case .number(let number): self = .number(number)
        case .string(let text): self = .string(text)
        case .array(let items): self = .array(items.map(OrderedJSON.init))
        case .object(let object): self = .object(object.keys.sorted().map { .init($0, OrderedJSON(object[$0]!)) })
        }
    }
}
