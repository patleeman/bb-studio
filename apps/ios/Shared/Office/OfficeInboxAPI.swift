import Foundation

/// The office Inbox page uses `cursor` for the next page on the wire.
public struct OfficeInboxPage: Codable, Sendable {
    public var events: [OfficeInboxEvent]
    public var nextCursor: String?
    enum CodingKeys: String, CodingKey { case events, nextCursor = "cursor" }
}

extension BBClient {
    public func officeInbox(spaceId: String = "all", type: OfficeInboxEvent.Kind? = nil, cursor: String? = nil) async throws -> OfficeInboxPage {
        try await rpc("studio", Studio.Method.inbox_list, .object(omittingNil: [
            "spaceId": .string(spaceId), "type": type.map { .string($0.rawValue) }, "cursor": cursor.map(JSONValue.string),
        ]))
    }
    public func officeInboxCounts() async throws -> OfficeInboxCounts {
        try await rpc("studio", Studio.Method.inbox_counts, [:])
    }
    public func officeInboxAct(key: String, actionId: String, text: String? = nil) async throws {
        let result: OfficeInboxAcknowledgement = try await rpc("studio", Studio.Method.inbox_act, .object(omittingNil: [
            "key": .string(key), "actionId": .string(actionId), "text": text.map(JSONValue.string),
        ]))
        try result.requireSuccess()
    }
    public func officeInboxDone(keys: [String]) async throws {
        let result: OfficeInboxAcknowledgement = try await rpc("studio", Studio.Method.inbox_done, ["keys": .array(keys.map(JSONValue.string))])
        try result.requireSuccess()
    }
    public func officeInboxRead(keys: [String]) async throws {
        let result: OfficeInboxAcknowledgement = try await rpc("studio", Studio.Method.inbox_read, ["keys": .array(keys.map(JSONValue.string))])
        try result.requireSuccess()
    }
}

private struct OfficeInboxAcknowledgement: Decodable {
    var ok: Bool
    func requireSuccess() throws {
        guard ok else { throw BBError(status: 0, message: "The Inbox action was not completed.") }
    }
}
