import SwiftUI
import UIKit

/// A tap on the transcript puts the keyboard away: on a row, its text or
/// the space around it. Placed in the transcript's content, it adds a tap
/// recognizer to the `UIScrollView` that holds it. The recognizer never takes
/// the touch (it doesn't cancel or delay it, and recognizes alongside every
/// other recognizer), so links, buttons, cards, quick replies and text
/// selection get their taps as before, and a scroll or a long press is no
/// tap at all. The composer, header and keyboard sit outside the scroll view
/// and never reach it. It listens only while `active`.
///
/// The bottom inset that shrinks as the keyboard goes is answered by
/// `keepAtEnd`, as for a swipe down: nothing here scrolls.
struct TranscriptTapDismissesKeyboard: UIViewRepresentable {
    /// The composer has the keyboard.
    var active: Bool

    func makeUIView(context: Context) -> Probe {
        let probe = Probe()
        probe.isUserInteractionEnabled = false
        probe.accessibilityElementsHidden = true
        return probe
    }

    func updateUIView(_ probe: Probe, context: Context) {
        probe.recognizer.active = active
    }

    static func dismantleUIView(_ probe: Probe, coordinator: ()) {
        probe.detach()
    }

    /// Finds its scroll view once it's in a window.
    final class Probe: UIView {
        let recognizer = Recognizer()

        override func didMoveToWindow() {
            super.didMoveToWindow()
            guard window != nil else { return detach() }
            let scroll = sequence(first: superview, next: { $0?.superview }).lazy.compactMap { $0 as? UIScrollView }.first
            guard let scroll, recognizer.view !== scroll else { return }
            detach()
            scroll.addGestureRecognizer(recognizer)
        }

        func detach() {
            recognizer.view?.removeGestureRecognizer(recognizer)
        }
    }

    final class Recognizer: UITapGestureRecognizer, UIGestureRecognizerDelegate {
        var active = false

        init() {
            super.init(target: nil, action: nil)
            addTarget(self, action: #selector(tapped))
            cancelsTouchesInView = false
            delaysTouchesBegan = false
            delaysTouchesEnded = false
            delegate = self
        }

        @objc private func tapped() {
            guard active, state == .ended else { return }
            // After the tap's own handlers: a text link acts once the touch
            // ends, and resigning first in the same pass dropped it.
            // And not while the window is resizing, which reloads the keyboard
            // in the middle of its own transition (crash 3).
            ResizeSettling.shared.afterSettling { [weak self] in
                Breadcrumbs.shared.focus("transcript-tap", "end-editing")
                self?.view?.window?.endEditing(true)
            }
        }

        func gestureRecognizer(_ recognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool { active }

        func gestureRecognizer(_ recognizer: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
    }
}
