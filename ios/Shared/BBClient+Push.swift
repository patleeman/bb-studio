import Foundation

extension BBClient {
    /// Notification actions must belong to this server, including after a URL change.
    /// Older pushes have no origin and can only be reviewed manually in the app.
    public func validateNotificationOrigin(_ serverId: String?) async throws {
        guard let serverId, !serverId.isEmpty else {
            throw BBError(status: 409, message: "Open BB to review this older notification.")
        }
        guard try await mobileServerIdentity() == serverId else {
            throw BBError(status: 409, message: "This notification belongs to another BB server. Switch servers to review it.")
        }
    }

    public func mobileServerIdentity() async throws -> String {
        struct Identity: Decodable { let serverId: String }
        let identity: Identity = try await get("/api/v1/plugins/mobile/http/identity")
        return identity.serverId
    }

    /// The `apns:` prefix tells the Studio Mobile relay to deliver through APNs.
    public func registerPush(apnsToken: String, label: String) async throws -> String {
        struct Result: Decodable { let id: String }
        let result: Result = try await rpc(
            "push-notifications", "pushSubscriptions.add",
            ["expoPushToken": .string("apns:\(apnsToken)"), "platform": "ios", "deviceLabel": .string(label)])
        return result.id
    }

    public func removePushSubscription(_ id: String) async throws {
        let _: JSONValue = try await rpc("push-notifications", "pushSubscriptions.remove", ["id": .string(id)])
    }
}
