import SwiftUI
import UIKit

/// Placed in a paged list (Studio's kinds): a swipe that starts on a row opens that
/// row's actions, and one anywhere else (a header, the gaps, past the last
/// row) turns the page.
struct YieldsRowSwipesToPager: UIViewRepresentable {
    func makeUIView(context: Context) -> UIView { Probe() }
    func updateUIView(_ view: UIView, context: Context) {}

    private final class Probe: UIView {
        override func didMoveToWindow() {
            super.didMoveToWindow()
            // The pager finishes building after this view joins it.
            DispatchQueue.main.async { [weak self] in self?.attach() }
        }

        private func attach() {
            var ancestor = superview
            while let view = ancestor, !((view as? UIScrollView)?.isPagingEnabled ?? false) { ancestor = view.superview }
            guard let pager = ancestor as? UIScrollView,
                  !(pager.gestureRecognizers ?? []).contains(where: { $0 is RowTouch }) else { return }
            pager.addGestureRecognizer(RowTouch(pager: pager))
        }
    }

    /// Watches each touch begin without taking it: the pager's pan is off
    /// while the touch started on a row cell of a page's list.
    private final class RowTouch: UIGestureRecognizer {
        weak var pager: UIScrollView?

        init(pager: UIScrollView) {
            self.pager = pager
            super.init(target: nil, action: nil)
            cancelsTouchesInView = false
            delaysTouchesBegan = false
            delaysTouchesEnded = false
        }

        override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
            if let pager, let touch = touches.first, event.allTouches?.count == 1 {
                pager.panGestureRecognizer.isEnabled = !onRow(pager.hitTest(touch.location(in: pager), with: event), pager: pager)
            }
            state = .failed
        }

        private func onRow(_ hit: UIView?, pager: UIScrollView) -> Bool {
            var view = hit
            while let current = view, current !== pager {
                // Headers are cells too, but only rows have an index path.
                if let cell = current as? UICollectionViewCell, let list = cell.superview as? UICollectionView, list !== pager {
                    return list.indexPath(for: cell) != nil
                }
                view = current.superview
            }
            return false
        }
    }
}
