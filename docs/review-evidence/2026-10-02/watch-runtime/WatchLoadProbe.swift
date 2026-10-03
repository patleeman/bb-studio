// Private Watch review target only. Disable WC activation in the copied model
// and invoke run() instead of the normal inbox when -watchLoadProbe YES is set.
import Foundation

private actor ReplyGate {
    var started = false
    private var continuation: CheckedContinuation<Void, Never>?
    func wait() async {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            started = true
        }
    }
    func open() { continuation?.resume(); continuation = nil }
}

@MainActor
enum WatchLoadProbe {
    static func run() async {
        let model = WatchModel.shared
        var results: [String: Bool] = [:]
        let staged = URL(string: "http://127.0.0.1:49486")!
        guard model.client.baseURL == staged else { return }
        for switchOrigin in [false, true] {
            let firstGate = ReplyGate()
            model.client.transport = { _, path, _ in
                guard path.contains("/threads?") else { return (503, Data()) }
                await firstGate.wait()
                throw BBError(status: 503, message: "Late previous request")
            }
            let first = Task { await model.load() }
            while !(await firstGate.started) { await Task.yield() }
            if switchOrigin { model.selectServer(URL(string: "http://localhost:49486")!) }
            let secondGate = ReplyGate()
            model.client.transport = { _, path, _ in
                guard path.contains("/threads?") else { return (503, Data()) }
                await secondGate.wait()
                return (200, Data("[]".utf8))
            }
            let second = Task { await model.load() }
            while !(await secondGate.started) { await Task.yield() }
            await firstGate.open()
            await first.value
            let label = switchOrigin ? "server-switch" : "newer-request"
            results["\(label)-ignores-old-error"] = model.error == nil
            results["\(label)-keeps-current-loading"] = model.loading
            await secondGate.open()
            await second.value
            results["\(label)-finishes-current-load"] = model.error == nil && !model.loading && model.threads.isEmpty
        }
        let current = URL(string: "http://localhost:49486")!
        model.selectServer(current)
        PhoneTransport.reconcileServer(staged, requestedFrom: staged)
        results["old-origin-correction-ignored"] = model.client.baseURL == current
        PhoneTransport.reconcileServer(staged, requestedFrom: current)
        results["current-origin-correction-applied"] = model.client.baseURL == staged
        let output = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("watch-load-probe.json")
        try? JSONEncoder().encode(results).write(to: output, options: .atomic)
    }
}
