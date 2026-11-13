import Foundation
import Observation

@MainActor @Observable
final class PageLoad<Value> {
    enum Phase: Equatable { case idle, loading, loaded, failed(String) }

    private(set) var phase: Phase = .idle
    private(set) var value: Value?
    private(set) var key: String?
    private(set) var scope: String?
    @ObservationIgnored private(set) var fetches = 0
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var fetch: (() async throws -> Value)?
    @ObservationIgnored private var generation = 0
    @ObservationIgnored let retries: Int
    @ObservationIgnored var describe: (Error) -> String

    init(retries: Int = 2, describe: @escaping (Error) -> String = { BBClient.describe($0) }) {
        self.retries = retries
        self.describe = describe
    }

    var error: String? {
        if case .failed(let message) = phase { return message }
        return nil
    }

    var waiting: Bool { value == nil && error == nil }
    var running: Bool { task != nil }

    func run(key: String, scope: String? = nil, _ fetch: @escaping () async throws -> Value) {
        let scope = scope ?? key
        if key == self.key, scope == self.scope, task != nil { return }
        if scope != self.scope { value = nil }
        self.key = key
        self.scope = scope
        self.fetch = fetch
        start()
    }

    func retry() {
        guard fetch != nil else { return }
        start()
    }

    func reload() async {
        retry()
        await task?.value
    }

    func settle() async {
        while let task { await task.value }
    }

    func cancel() {
        generation += 1
        task?.cancel()
        task = nil
        if phase == .loading { phase = value == nil ? .idle : .loaded }
    }

    private func start() {
        guard let fetch else { return }
        task?.cancel()
        generation += 1
        let mine = generation
        phase = .loading
        task = Task { [weak self] in
            var attempt = 0
            while true {
                self?.fetches += 1
                do {
                    let value = try await fetch()
                    guard let self, self.generation == mine else { return }
                    self.value = value
                    self.phase = .loaded
                    self.task = nil
                    return
                } catch {
                    guard let self, self.generation == mine else { return }
                    if BBClient.isCancellation(error), attempt < self.retries {
                        attempt += 1
                        continue
                    }
                    self.phase = .failed(BBClient.isCancellation(error) ? "The request was cut off before it finished." : self.describe(error))
                    self.task = nil
                    return
                }
            }
        }
    }
}
