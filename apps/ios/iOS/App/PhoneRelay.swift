import Foundation
import WatchConnectivity

/// Answers the watch's relayed requests. WatchConnectivity wakes the phone app
/// in the background for `sendMessage`, so this works with the app closed.
final class PhoneRelay: NSObject, WCSessionDelegate {
    static let shared = PhoneRelay()

    func activate() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func session(
        _ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void
    ) {
        let method = message[WatchRelay.method] as? String ?? "GET"
        let path = message[WatchRelay.path] as? String ?? "/"
        let body = message[WatchRelay.body] as? Data
        Task {
            do {
                let (status, data) = try await BBClient().raw(method: method, path: path, body: body)
                replyHandler([WatchRelay.status: status, WatchRelay.body: WatchRelay.pack(data)])
            } catch {
                replyHandler([WatchRelay.status: 0, WatchRelay.error: error.localizedDescription])
            }
        }
    }

    private var lastStatus: StatusSnapshot?

    /// Sends the needs-you counts to the watch complication when they change.
    /// Complication transfers wake the watch app but are budgeted, so only on change.
    func pushStatus(_ threads: [ThreadEntry]) {
        let status = StatusSnapshot(ThreadSummary(threads))
        guard WCSession.isSupported(), WCSession.default.activationState == .activated,
            WCSession.default.isPaired, WCSession.default.isWatchAppInstalled, !status.sameCounts(lastStatus)
        else { return }
        lastStatus = status
        if WCSession.default.isComplicationEnabled, WCSession.default.remainingComplicationUserInfoTransfers > 0 {
            WCSession.default.transferCurrentComplicationUserInfo(status.dictionary)
        } else {
            try? WCSession.default.updateApplicationContext(status.dictionary)
        }
    }

    func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {}
    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) { WCSession.default.activate() }
}
