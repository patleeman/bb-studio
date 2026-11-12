import Foundation

/// Keeps failed capture files available for an explicit retry. A recording may
/// finish only after every callback has arrived and every enqueue has succeeded.
@MainActor
final class TalkHandoff {
    private let enqueue: (CapturedSegment) throws -> Void
    private var saved: Set<Int> = []
    private var failed: [Int: CapturedSegment] = [:]
    private(set) var lastError: Error?

    init(enqueue: @escaping (CapturedSegment) throws -> Void) { self.enqueue = enqueue }

    var failedCount: Int { failed.count }
    var savedCount: Int { saved.count }

    func receive(_ segment: CapturedSegment) {
        guard !saved.contains(segment.index) else { return }
        do {
            try enqueue(segment)
            saved.insert(segment.index)
            failed[segment.index] = nil
            if failed.isEmpty { lastError = nil }
        } catch {
            failed[segment.index] = segment
            lastError = error
        }
    }

    func retry() {
        for segment in failed.values.sorted(by: { $0.index < $1.index }) { receive(segment) }
    }

    func waitUntilDurable(_ expected: Int, timeout: Duration = .seconds(5)) async throws {
        let deadline = ContinuousClock.now + timeout
        while saved.count < expected {
            try Task.checkCancellation()
            if let lastError {
                throw BBError(status: 0, message: "Couldn't save all the audio on this phone: \(lastError.localizedDescription) Keep this screen open and retry saving.")
            }
            guard ContinuousClock.now < deadline else {
                throw BBError(status: 0, message: "Still waiting for the last audio segment. The recording has not been finalized. Keep this screen open and retry saving.")
            }
            try await Task.sleep(for: .milliseconds(20))
        }
        guard failed.isEmpty else {
            throw BBError(status: 0, message: "Some audio is still waiting to be saved. Retry saving before closing.")
        }
    }
}
