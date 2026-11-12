import UIKit

/// Holds keyboard-touching work until the window has stopped changing size.
///
/// Crash 3 (TestFlight 1421, the Duo): the keyboard crashed attaching to the
/// window, in the split transition it runs around the fold, removing a
/// constraint Auto Layout had already broken. It got there from a reload of
/// the input views, which UIKit schedules when the first responder changes
/// or when its traits do. We did both while the window was resizing: a size
/// class override set from inside the resize's layout pass, and the
/// composer taking or giving up focus on the next run loop. Both now wait
/// until the window has been still for `quiet`, so the keyboard reloads
/// once, for the system's own reason.
@MainActor
final class ResizeSettling {
    static let shared = ResizeSettling()

    /// How long the window must keep its size before keyboard work goes ahead.
    var quiet: TimeInterval = 0.4
    var now: () -> Date = Date.init
    /// Runs `work` later; the default is the main queue.
    var schedule: (TimeInterval, @escaping @MainActor () -> Void) -> Void = { delay, work in
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { MainActor.assumeIsolated(work) }
    }
    private(set) var changedAt = Date.distantPast
    /// The keyboard is on screen, or on its way.
    private(set) var keyboardUp = false
    private var observing = false

    /// The window changed size (or its safe area did).
    func changed() {
        changedAt = now()
        #if DEBUG
        RenderCount.bump("resize.changed")
        #endif
    }

    #if DEBUG
    /// Something that reloads the keyboard is about to run: counted if the
    /// keyboard is up and the window still resizing, which is what crashed.
    func reloadingKeyboard() {
        if keyboardUp, remaining > 0 { RenderCount.bump("keyboard.reloadDuringResize") }
    }
    #endif

    /// How long until the window counts as settled; 0 once it is.
    var remaining: TimeInterval {
        let left = quiet - now().timeIntervalSince(changedAt)
        // A millisecond's rounding is settled.
        return left > 0.001 ? left : 0
    }

    /// Runs `work` on a later pass of the run loop, once the window has kept
    /// its size for `quiet`. Another change in the meantime pushes it back.
    func afterSettling(_ work: @escaping @MainActor () -> Void) {
        let wait = remaining
        schedule(wait) { [self] in
            if remaining > 0 { return afterSettling(work) }
            work()
        }
    }

    /// Starts following whether the keyboard is up.
    func observeKeyboard() {
        guard !observing else { return }
        observing = true
        let center = NotificationCenter.default
        center.addObserver(forName: UIResponder.keyboardWillShowNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { ResizeSettling.shared.keyboardUp = true }
        }
        center.addObserver(forName: UIResponder.keyboardDidHideNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { ResizeSettling.shared.keyboardUp = false }
        }
    }
}
