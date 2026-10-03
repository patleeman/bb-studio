// Compile into the private Watch review target; invoke from a probe-only root.
import Foundation

private final class FinishCounter: @unchecked Sendable {
    let lock = NSLock()
    private var count = 0
    func add() { lock.lock(); count += 1; lock.unlock() }
    var value: Int { lock.lock(); defer { lock.unlock() }; return count }
}

@MainActor
enum WatchTransportProbe {
    static func run() async {
        var checks: [String: Bool] = [:]
        let reply = WatchTransportWait<Int>()
        let value = try? await reply.value(timeout: .milliseconds(20), message: "deadline") { $0.finish(.success(7)) }
        try? await Task.sleep(for: .milliseconds(40))
        checks["reply-wins-and-cancels-deadline"] = value == 7 && !reply.finish(.success(8))
        let error = WatchTransportWait<Int>()
        do {
            _ = try await error.value(timeout: .seconds(1), message: "deadline") { $0.finish(.failure(BBError(status: 503, message: "expected error"))) }
            checks["error-completes-once"] = false
        } catch { checks["error-completes-once"] = true }
        let counter = FinishCounter()
        let deadline = WatchTransportWait<Int>(onFinish: { counter.add() })
        do {
            _ = try await deadline.value(timeout: .milliseconds(20), message: "deadline") { _ in }
            checks["deadline-completes"] = false
        } catch { checks["deadline-completes"] = error.localizedDescription.contains("deadline") }
        var lateSideEffect = false
        if deadline.finish(.success(99)) { lateSideEffect = true }
        checks["late-reply-side-effects-ignored"] = !lateSideEffect && counter.value == 1
        let cancelled = WatchTransportWait<Int>()
        let task = Task { try await cancelled.value(timeout: .seconds(1), message: "deadline") { _ in } }
        await Task.yield()
        task.cancel()
        do { _ = try await task.value; checks["cancellation-completes"] = false }
        catch { checks["cancellation-completes"] = error is CancellationError }
        checks["late-reply-after-cancel-ignored"] = !cancelled.finish(.success(1))
        let beforeStart = WatchTransportWait<Int>()
        beforeStart.finish(.failure(CancellationError()))
        var started = false
        _ = try? await beforeStart.value(timeout: .seconds(1), message: "deadline") { _ in started = true }
        checks["cancelled-before-start-does-not-send"] = !started
        let model = WatchModel.shared
        let a = URL(string: "http://127.0.0.1:49486")!
        let b = URL(string: "http://127.0.0.1:49486/")!
        model.selectServer(a)
        let oldSelection = model.serverSelection
        model.selectServer(b); model.selectServer(a)
        PhoneTransport.reconcileServer(b, requestedFrom: a, selection: oldSelection)
        checks["ABA-old-origin-correction-ignored"] = model.client.baseURL == a
        PhoneTransport.reconcileServer(b, requestedFrom: a, selection: model.serverSelection)
        checks["current-origin-correction-applied"] = model.client.baseURL == b
        model.selectServer(a)
        let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("watch-transport-probe.json")
        try? JSONEncoder().encode(checks).write(to: url, options: .atomic)
    }
}
