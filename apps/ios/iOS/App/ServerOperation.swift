import Foundation

/// A view's selections and every step of its work belong to one server. Work
/// already accepted there may finish, but cannot navigate a newer server's UI.
@MainActor
struct ServerOperation {
    let client: BBClient

    init(client: BBClient = BBClient()) { self.client = client }

    @discardableResult
    func complete(currentServer: URL, _ action: () -> Void) -> Bool {
        guard currentServer == client.baseURL else { return false }
        action()
        return true
    }

    @discardableResult
    func complete(on app: AppModel, _ action: () -> Void) -> Bool {
        complete(currentServer: app.serverURL, action)
    }

    func run<Value>(currentServer: () -> URL, work: (BBClient) async throws -> Value,
                    completion: (Value) -> Void) async throws {
        let value = try await work(client)
        complete(currentServer: currentServer()) { completion(value) }
    }
}
