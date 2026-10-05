import Foundation

public struct BBError: LocalizedError, Sendable {
    public var status: Int
    public var message: String
    public var errorDescription: String? { message }
}

extension BBClient {
    /// A message that says what to do, for errors that mean "the server is unreachable".
    public static func describe(_ error: Error, server: URL = storedServerURL) -> String {
        guard let urlError = error as? URLError else { return error.localizedDescription }
        switch urlError.code {
        case .notConnectedToInternet, .dataNotAllowed:
            return "You're offline."
        case .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed, .timedOut, .networkConnectionLost,
            .secureConnectionFailed:
            return "Can't reach BB at \(server.host() ?? server.absoluteString). Is Tailscale connected?"
        default:
            return urlError.localizedDescription
        }
    }

    /// A superseded request, such as a reload replaced by a newer one. Not worth showing.
    public static func isCancellation(_ error: Error) -> Bool {
        error is CancellationError || (error as? URLError)?.code == .cancelled
    }

    /// The plugin isn't installed or running, or has no such RPC method: BB answers
    /// 404 (`unknown plugin`, `unknown_method`) or 503 (not running). Handler
    /// failures are 400 or 500, and network errors aren't `BBError`s.
    public static func isMissingRPC(_ error: Error) -> Bool {
        guard let error = error as? BBError else { return false }
        return error.status == 404 || error.status == 503
    }

    /// The request never left the phone or never reached BB, so sending again can't duplicate it.
    /// Timeouts and dropped connections don't count: BB may have acted before the reply was lost.
    public static func neverArrived(_ error: Error) -> Bool {
        guard let code = (error as? URLError)?.code else { return false }
        return [
            .notConnectedToInternet, .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed, .dataNotAllowed,
            .internationalRoamingOff, .callIsActive,
        ].contains(code)
    }
}

/// Talks to a BB server over its public API. BB has no client auth: over
/// Tailscale Serve the tailnet is the boundary. Requests send no `Origin`
/// header, which is what BB's browser-request guard expects from native clients.
public final class BBClient: @unchecked Sendable {
    public static let defaultServerURL = URL(string: "https://patricks-megamac.tail5a01ec.ts.net")!
    private static let serverURLKey = "serverURL"

    /// Kept in the app group so the widgets and share extension use the same server.
    public static var storedServerURL: URL {
        get {
            (AppGroup.defaults.string(forKey: serverURLKey) ?? UserDefaults.standard.string(forKey: serverURLKey))
                .flatMap(URL.init(string:)) ?? defaultServerURL
        }
        set { AppGroup.defaults.set(newValue.absoluteString, forKey: serverURLKey) }
    }

    public typealias Transport = @Sendable (_ method: String, _ path: String, _ body: Data?) async throws -> (Int, Data)

    public var baseURL: URL
    /// Replaces the network for every request. The watch sets this to relay through the phone.
    public var transport: Transport?
    fileprivate let session: URLSession
    fileprivate let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    public init(baseURL: URL = BBClient.storedServerURL) {
        self.baseURL = baseURL
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.waitsForConnectivity = false
        session = URLSession(configuration: config)
    }

    // MARK: Transport

    /// One raw request. Also the unit the Watch relay forwards through the phone.
    public func raw(method: String, path: String, body: Data?) async throws -> (Int, Data) {
        if let transport { return try await transport(method, path, body) }
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw BBError(status: 0, message: "Bad path \(path)")
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("mobile", forHTTPHeaderField: "x-bb-app-surface")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await session.data(for: request)
        return ((response as? HTTPURLResponse)?.statusCode ?? 0, data)
    }

    private func request<T: Decodable>(_ method: String, _ path: String, body: JSONValue?) async throws -> T {
        let data = try body.map { try encoder.encode($0) }
        let (status, responseData) = try await raw(method: method, path: path, body: data)
        guard (200..<300).contains(status) else {
            throw BBError(status: status, message: Self.errorMessage(responseData) ?? "HTTP \(status) for \(path)")
        }
        return try decoder.decode(T.self, from: responseData)
    }

    public func get<T: Decodable>(_ path: String) async throws -> T {
        try await request("GET", path, body: nil)
    }

    public func post<T: Decodable>(_ path: String, _ body: JSONValue? = nil) async throws -> T {
        try await request("POST", path, body: body)
    }

    public func patch<T: Decodable>(_ path: String, _ body: JSONValue) async throws -> T {
        try await request("PATCH", path, body: body)
    }

    public func put<T: Decodable>(_ path: String, _ body: JSONValue) async throws -> T {
        try await request("PUT", path, body: body)
    }

    private struct RPCEnvelope<T: Decodable>: Decodable {
        var ok: Bool
        var result: T?
        var error: JSONValue?
    }

    /// Calls a plugin's `bb.rpc` method: `POST /api/v1/plugins/<id>/rpc/<method>` with the raw input as the body.
    public func rpc<T: Decodable>(_ pluginId: String, _ method: String, _ input: JSONValue = .null) async throws -> T {
        let data = try encoder.encode(input)
        let (status, responseData) = try await raw(
            method: "POST", path: "/api/v1/plugins/\(pluginId)/rpc/\(method)", body: data)
        let envelope = try? decoder.decode(RPCEnvelope<T>.self, from: responseData)
        guard let envelope, envelope.ok, let result = envelope.result else {
            throw BBError(
                status: status,
                message: Self.errorMessage(responseData) ?? "\(pluginId).\(method) failed (HTTP \(status))")
        }
        return result
    }

    /// For methods whose result can be `null`.
    public func rpcIfPresent<T: Decodable>(_ pluginId: String, _ method: String, _ input: JSONValue = .null) async throws -> T? {
        let data = try encoder.encode(input)
        let (status, responseData) = try await raw(
            method: "POST", path: "/api/v1/plugins/\(pluginId)/rpc/\(method)", body: data)
        guard let envelope = try? decoder.decode(RPCEnvelope<T>.self, from: responseData), envelope.ok else {
            throw BBError(
                status: status,
                message: Self.errorMessage(responseData) ?? "\(pluginId).\(method) failed (HTTP \(status))")
        }
        return envelope.result
    }

    static func errorMessage(_ data: Data) -> String? {
        guard let json = try? JSONDecoder().decode(JSONValue.self, from: data) else {
            return String(data: data, encoding: .utf8).map { String($0.prefix(200)) }
        }
        let error = json["error"]
        return error?["message"]?.stringValue ?? error?.stringValue ?? json["message"]?.stringValue
    }

    // MARK: URLs

    public func webURL(forThread thread: ThreadEntry) -> URL {
        URL(string: "/projects/\(thread.projectId)/threads/\(thread.id)", relativeTo: baseURL)!
    }

    public var webSocketURL: URL {
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        components.scheme = components.scheme == "https" ? "wss" : "ws"
        components.path = "/ws"
        return components.url!
    }
}

// MARK: Threads

extension BBClient {
    public func threads(limit: Int = 200) async throws -> [ThreadEntry] {
        try await get("/api/v1/threads?archived=false&limit=\(limit)")
    }

    /// The threads the web sidebar shows, grouped by project.
    public func sidebar() async throws -> SidebarBootstrap {
        try await get("/api/v1/sidebar-bootstrap")
    }

    /// Studio Sidebar's (`thread-list-plus`) when it runs, which is what the web
    /// sidebar shows then; otherwise BB's own Thread List's. Only a missing Studio
    /// Sidebar falls back: a timeout or failure throws, so callers keep what they had.
    public func sidebarPreferences() async throws -> SidebarPreferences {
        struct Envelope: Decodable { var preferences: SidebarPreferences }
        do {
            let envelope: Envelope = try await rpc(Self.studioSidebarPlugin, "listPreferences")
            return envelope.preferences
        } catch where Self.isMissingRPC(error) {
            let envelope: Envelope = try await rpc("thread-list", "listPreferences")
            return envelope.preferences
        }
    }

    /// Studio Sidebar's plugin id, kept from when it was Thread List Plus.
    public static let studioSidebarPlugin = "thread-list-plus"

    /// Sets one of Studio Sidebar's synced preferences, like `hiddenThreads`.
    public func setSidebarPreference(_ key: String, _ value: JSONValue) async throws {
        let _: JSONValue = try await rpc(Self.studioSidebarPlugin, "setPreference", ["key": .string(key), "value": value])
    }

    public func thread(_ id: String) async throws -> ThreadEntry {
        try await get("/api/v1/threads/\(id)")
    }

    public func projects() async throws -> [Project] {
        try await get("/api/v1/projects")
    }

    /// `after` asks for a delta against the page that had that `maxSeq`; the server
    /// answers with a full page when it no longer has it.
    public func timeline(_ threadId: String, before cursor: TimelineCursor? = nil, after: Int? = nil, segments: Int = 8)
        async throws -> TimelinePage
    {
        var path = "/api/v1/threads/\(threadId)/timeline?segmentLimit=\(segments)"
        if let after { path += "&afterSequence=\(after)" }
        if let cursor {
            let anchor = cursor.anchorId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? cursor.anchorId
            path += "&beforeAnchorSeq=\(cursor.anchorSeq)&beforeAnchorId=\(anchor)"
        }
        return try await get(path)
    }

    @discardableResult
    public func send(_ threadId: String, text: String, mentions: [Mention] = []) async throws -> SendResult {
        try await send(threadId, text: text, attachments: [], mentions: mentions)
    }

    /// The newest assistant message in a thread.
    public func latestReply(_ threadId: String) async throws -> TimelineRow? {
        try await timeline(threadId, segments: 2).rows.last { $0.isConversation && $0.role == "assistant" }
    }

    /// Polls until the thread stops running with an assistant reply newer than `baselineId`.
    /// Returns nil on timeout.
    public func waitForReply(_ threadId: String, after baselineId: String?, timeout: Duration) async throws -> String? {
        let deadline = ContinuousClock.now + timeout
        try await Task.sleep(for: .seconds(1))
        while ContinuousClock.now < deadline {
            if try await !thread(threadId).isRunning, let reply = try await latestReply(threadId),
                reply.id != baselineId, let text = reply.text
            {
                return text
            }
            try await Task.sleep(for: .seconds(2))
        }
        return nil
    }

    public func stop(_ threadId: String) async throws {
        let _: JSONValue = try await post("/api/v1/threads/\(threadId)/stop")
    }

    public func queuedMessages(_ threadId: String) async throws -> [QueuedMessage] {
        try await get("/api/v1/threads/\(threadId)/queued-messages")
    }

    public func deleteQueued(_ threadId: String, _ id: String) async throws {
        let (status, data) = try await raw(method: "DELETE", path: "/api/v1/threads/\(threadId)/queued-messages/\(id)", body: nil)
        guard (200..<300).contains(status) else {
            throw BBError(status: status, message: Self.errorMessage(data) ?? "HTTP \(status) removing the queued message")
        }
    }

    /// Rewrites a queued message's text. Attachments stay; @-mentions stay
    /// when their text is still there. Fails if it was sent or changed meanwhile.
    /// `original` is the text the editor opened with.
    public func editQueued(_ threadId: String, _ id: String, from original: String, to text: String) async throws {
        let rows: JSONValue = try await get("/api/v1/threads/\(threadId)/queued-messages")
        guard let row = rows.arrayValue?.first(where: { $0["id"]?.stringValue == id }),
            case .number(let updatedAt)? = row["updatedAt"], let content = row["content"]?.arrayValue
        else { throw BBError(status: 404, message: "That message already sent.") }
        let current = content.compactMap { $0["type"]?.stringValue == "text" ? $0["text"]?.stringValue : nil }.joined(separator: "\n")
        guard current == original else { throw BBError(status: 409, message: "That message changed while you were editing it.") }

        // Every old mention's text, in order.
        var mentions: [(label: String, resource: JSONValue)] = []
        for item in content where item["type"]?.stringValue == "text" {
            let itemText = item["text"]?.stringValue ?? ""
            for mention in item["mentions"]?.arrayValue ?? [] {
                guard case .number(let start)? = mention["start"], case .number(let end)? = mention["end"],
                    let resource = mention["resource"], start >= 0, end <= Double(itemText.utf16.count), start < end
                else { continue }
                mentions.append((String(decoding: Array(itemText.utf16)[Int(start)..<Int(end)], as: UTF16.self), resource))
            }
        }
        // Keep each mention whose text still appears, in order.
        var kept: [JSONValue] = [], cursor = text.startIndex
        for mention in mentions {
            guard let range = text.range(of: mention.label, range: cursor..<text.endIndex) else { continue }
            let start = text.utf16.distance(from: text.startIndex, to: range.lowerBound)
            kept.append(["start": .number(Double(start)), "end": .number(Double(start + mention.label.utf16.count)), "resource": mention.resource])
            cursor = range.upperBound
        }
        let textItem: JSONValue = ["type": "text", "text": .string(text), "mentions": .array(kept)]
        var input: [JSONValue] = [], placed = false
        for item in content {
            if item["type"]?.stringValue == "text" {
                if !placed, !text.isEmpty { input.append(textItem) }
                placed = true
            } else {
                input.append(item)
            }
        }
        if !placed, !text.isEmpty { input.insert(textItem, at: 0) }
        guard !input.isEmpty else { throw BBError(status: 400, message: "A queued message can't be empty.") }
        let _: JSONValue = try await patch("/api/v1/threads/\(threadId)/queued-messages/\(id)",
            ["expectedUpdatedAt": .number(updatedAt), "input": .array(input)])
    }

    /// Moves a queued message between two neighbours in the thread's queue.
    public func reorderQueued(_ threadId: String, _ id: String, previous: String?, next: String?) async throws {
        let _: JSONValue = try await patch("/api/v1/threads/\(threadId)/queued-messages/\(id)/order", [
            "previousQueuedMessageId": previous.map(JSONValue.string) ?? .null,
            "nextQueuedMessageId": next.map(JSONValue.string) ?? .null,
        ])
    }

    /// Sends a queued message now. `steer` puts it into the running turn;
    /// `auto` waits for the turn to end if one is running.
    public func sendQueuedNow(_ threadId: String, _ id: String, mode: String = "steer") async throws {
        let _: JSONValue = try await post("/api/v1/threads/\(threadId)/queued-messages/\(id)/send", ["mode": .string(mode)])
    }

    public func clearGoal(_ threadId: String) async throws {
        let _: JSONValue = try await post("/api/v1/threads/\(threadId)/goal/clear")
    }

    public func exitPlanMode(_ threadId: String) async throws {
        let _: JSONValue = try await post("/api/v1/threads/\(threadId)/plan/cancel")
    }

    /// A file attached to a message, as BB's web client loads it. Web URLs pass through.
    public func attachmentURL(projectId: String, path: String) -> URL? {
        if path.hasPrefix("http:") || path.hasPrefix("https:") || path.hasPrefix("data:") { return URL(string: path) }
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)
        components?.path = "/api/v1/projects/\(projectId)/attachments/content"
        components?.queryItems = [URLQueryItem(name: "path", value: path)]
        return components?.url
    }

    public func markRead(_ threadId: String) async throws {
        let _: JSONValue = try await post("/api/v1/threads/\(threadId)/read")
    }

    public func createThread(projectId: String, text: String, attachments: [JSONValue] = [], options: ExecutionChoice? = nil)
        async throws -> ThreadEntry
    {
        var body: [String: JSONValue] = [
            "projectId": .string(projectId),
            "origin": "app",
            "input": Self.input(text, attachments),
            "environment": ["type": "project-default"],
        ]
        if let options {
            if let providerId = options.providerId { body["providerId"] = .string(providerId) }
            if let model = options.model { body["model"] = .string(model) }
            if let reasoning = options.reasoningLevel { body["reasoningLevel"] = .string(reasoning) }
            if let permissionMode = options.permissionMode { body["permissionMode"] = .string(permissionMode) }
        }
        return try await post("/api/v1/threads", .object(body))
    }

    @discardableResult
    public func send(_ threadId: String, text: String, attachments: [JSONValue], mentions: [Mention] = []) async throws
        -> SendResult
    {
        var body: [String: JSONValue] = ["input": Self.input(text, attachments, mentions), "mode": "queue-if-active"]
        PermissionMode.apply(threadId, to: &body, serverURL: baseURL)
        let result: SendResult = try await post("/api/v1/threads/\(threadId)/send", .object(body))
        PermissionMode.sent(threadId, body, serverURL: baseURL)
        return result
    }

    static func input(_ text: String, _ attachments: [JSONValue], _ mentions: [Mention] = []) -> JSONValue {
        var input = attachments
        if !text.isEmpty {
            input.append(["type": "text", "text": .string(text), "mentions": .array(Mention.ranges(in: text, mentions))])
        }
        return .array(input)
    }

    // MARK: Thread management

    public func archive(_ threadId: String) async throws {
        let _: JSONValue = try await post("/api/v1/threads/\(threadId)/archive-all")
    }

    /// Permanent. BB refuses when the thread has child threads, and the error says so.
    public func delete(_ threadId: String) async throws {
        let body = try encoder.encode(["childThreadsConfirmed": false] as JSONValue)
        let (status, data) = try await raw(method: "DELETE", path: "/api/v1/threads/\(threadId)", body: body)
        guard (200..<300).contains(status) else {
            throw BBError(status: status, message: Self.errorMessage(data) ?? "HTTP \(status) deleting the thread")
        }
    }

    public func unarchive(_ threadId: String) async throws {
        let _: JSONValue = try await post("/api/v1/threads/\(threadId)/unarchive")
    }

    public func setPinned(_ threadId: String, _ pinned: Bool) async throws {
        let _: JSONValue = try await post("/api/v1/threads/\(threadId)/\(pinned ? "pin" : "unpin")")
    }

    public func markUnread(_ threadId: String) async throws {
        let _: JSONValue = try await post("/api/v1/threads/\(threadId)/unread")
    }

    public func rename(_ threadId: String, title: String?) async throws {
        let _: JSONValue = try await patch("/api/v1/threads/\(threadId)", ["title": .from(title)])
    }

    /// Title and message search; needs at least two non-space characters.
    public func search(_ query: String, limit: Int = 20) async throws -> ThreadSearchResults {
        let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
        return try await get("/api/v1/threads/search?query=\(encoded)&limitPerGroup=\(limit)")
    }

    // MARK: New-thread options

    public func executionOptions(providerId: String? = nil) async throws -> ExecutionOptions {
        try await get("/api/v1/system/execution-options" + (providerId.map { "?providerId=\($0)" } ?? ""))
    }

    public func projectDefaults(_ projectId: String) async throws -> ExecutionChoice? {
        try await get("/api/v1/projects/\(projectId)/default-execution-options")
    }

    // MARK: Attachments

    /// Uploads one file to a project; returns the prompt input that references it.
    /// Must be the project of the thread the message goes to. HEIC is rejected, so send JPEG.
    public func upload(projectId: String, data: Data, name: String, mimeType: String) async throws -> JSONValue {
        let boundary = "bbgo-\(UUID().uuidString)"
        var body = Data()
        let safeName = name.replacingOccurrences(of: "\"", with: "")
        body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(safeName)\"\r\n".utf8))
        body.append(Data("Content-Type: \(mimeType)\r\n\r\n".utf8))
        body.append(data)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        var request = URLRequest(url: URL(string: "/api/v1/projects/\(projectId)/attachments", relativeTo: baseURL)!)
        request.httpMethod = "POST"
        request.timeoutInterval = 120
        request.setValue("mobile", forHTTPHeaderField: "x-bb-app-surface")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        let (responseData, response) = try await session.upload(for: request, from: body)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw BBError(status: status, message: Self.errorMessage(responseData) ?? "Upload failed (HTTP \(status))")
        }
        let uploaded = try decoder.decode(JSONValue.self, from: responseData)
        guard let type = uploaded["type"]?.stringValue, let path = uploaded["path"]?.stringValue else {
            throw BBError(status: status, message: "Unexpected upload response")
        }
        if type == "localImage" { return ["type": "localImage", "path": .string(path)] }
        var file: [String: JSONValue] = ["type": "localFile", "path": .string(path), "name": uploaded["name"] ?? .string(name)]
        if let size = uploaded["sizeBytes"] { file["sizeBytes"] = size }
        if let mime = uploaded["mimeType"] { file["mimeType"] = mime }
        return .object(file)
    }
}

// MARK: Talk

extension BBClient {
    public func createRecording(kind: String, threadId: String?, projectId: String?) async throws -> Recording {
        try await rpc(
            "talk", "recording_create",
            ["kind": .string(kind), "projectId": .from(projectId), "threadId": .from(threadId)])
    }

    public func putSegment(
        recordingId: String, sessionId: String, index: Int, startedAt: Int, durationMs: Int, mimeType: String,
        audio: Data
    ) async throws {
        let _: JSONValue = try await rpc(
            "talk", "segment_put",
            [
                "recordingId": .string(recordingId), "sessionId": .string(sessionId), "index": .from(index),
                "startedAt": .from(startedAt), "durationMs": .from(durationMs), "mimeType": .string(mimeType),
                "audioBase64": .string(audio.base64EncodedString()),
            ])
    }

    @discardableResult
    public func setRecordingState(_ id: String, _ status: String) async throws -> Recording {
        try await rpc("talk", "recording_state", ["id": .string(id), "status": .string(status)])
    }

    public func heartbeat(_ id: String) async throws {
        let _: JSONValue = try await rpc("talk", "recording_heartbeat", ["id": .string(id)])
    }

    public func recording(_ id: String) async throws -> RecordingDetail {
        try await rpc("talk", "recording_get", ["id": .string(id)])
    }

    /// One segment's audio, as it was recorded: WebM/Opus from a browser, MP4/AAC from the phone.
    public func recordingAudio(_ id: String, segment: String) async throws -> Data {
        var query = URLComponents()
        query.queryItems = [URLQueryItem(name: "recording", value: id), URLQueryItem(name: "segment", value: segment)]
        let path = "/api/v1/plugins/talk/http/audio?" + (query.percentEncodedQuery ?? "")
        let (status, data) = try await raw(method: "GET", path: path, body: nil)
        guard (200..<300).contains(status) else {
            throw BBError(status: status, message: Self.errorMessage(data) ?? "HTTP \(status) for the segment's audio")
        }
        return data
    }

    public func recordings(limit: Int = 50) async throws -> [Recording] {
        struct List: Decodable { var recordings: [Recording] }
        let list: List = try await rpc("talk", "recordings_list", ["limit": .from(limit)])
        return list.recordings
    }
}

extension PermissionMode {
    /// Adds the pending mode to a send body.
    static func apply(_ threadId: String, to body: inout [String: JSONValue], serverURL: URL) {
        guard let mode = pending(threadId, serverURL: serverURL) else { return }
        body["permissionMode"] = .string(mode)
        body["executionInputSources"] = ["permissionMode": "explicit"]
    }

    /// The message carried it; from now on the thread has it.
    static func sent(_ threadId: String, _ body: [String: JSONValue], serverURL: URL) {
        if case .string(let mode)? = body["permissionMode"], pending(threadId, serverURL: serverURL) == mode { setPending(nil, for: threadId, serverURL: serverURL) }
    }
}
