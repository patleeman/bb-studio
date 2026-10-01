import Foundation

extension BBClient {
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
