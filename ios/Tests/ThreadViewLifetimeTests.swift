import XCTest
@testable import BBStudio

/// A thread view holds its session and notes for its life (`ThreadViewLifetime`)
/// and lets go when it is released, on whichever thread that happens: never a trap.
@MainActor
final class ThreadViewLifetimeTests: XCTestCase {
    /// Holds the lifetime so the last reference can go on another thread.
    private final class Holder: @unchecked Sendable {
        var lifetime: ThreadViewLifetime?
        init(_ lifetime: ThreadViewLifetime) { self.lifetime = lifetime }
    }

    private func held(_ threadId: String) -> Holder {
        let lifetime = ThreadViewLifetime()
        lifetime.hold(ConversationSession(threadId: threadId), notes: ThreadNotes(threadId: threadId), app: AppModel.shared)
        return Holder(lifetime)
    }

    private func detaches() async throws -> Int {
        for _ in 0..<100 where RenderCount.counts["session.detach"] == nil { try await Task.sleep(for: .milliseconds(20)) }
        return RenderCount.counts["session.detach"] ?? 0
    }

    func testReleasedOffTheMainThreadLetsGoOnTheMainActor() async throws {
        RenderCount.reset()
        let holder = held("thr_lifetime_background")
        await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
            DispatchQueue.global(qos: .utility).async {
                holder.lifetime = nil
                done.resume()
            }
        }
        let detached = try await detaches()
        XCTAssertEqual(detached, 1, "the session detached, on the main actor")
    }

    func testReleasedOnTheMainThreadLetsGoThere() async throws {
        RenderCount.reset()
        let holder = held("thr_lifetime_main")
        holder.lifetime = nil
        let detached = try await detaches()
        XCTAssertEqual(detached, 1)
    }
}
