import SwiftUI
import UIKit

/// Beside two pages the Duo's headers run to the window's top edge, under
/// the system's status-bar tap strip. iOS takes a touch in that strip before
/// the app sees it, and scrolls the scroll view under the touch's x to its
/// top instead. The strip isn't reported: the top safe-area inset is 0 and,
/// in the simulator, the status bar frame is 2 points tall while taps above
/// about 20 points are taken. So a header button got a tap only on its lower
/// part; higher up, the tap scrolled the chat to its top.
///
/// While beside two pages, the strip belongs to the headers. No scroll view
/// but the strip's own scrolls to top. The strip is a row of narrow scroll
/// views across the window's top (`StatusBarStripView`), so iOS picks the
/// one under the tap, and it runs the header control at that x: a SwiftUI
/// button or menu (marked by `StatusBarTapMarker`), or a UIKit bar button.
/// A strip tap between controls does nothing. Elsewhere (one page, an
/// iPhone) the status bar sits above the navigation bar, and every scroll
/// view keeps scrolling to top.
@MainActor
enum StatusBarStrip {
    /// Set from the window's geometry: two pages, so headers own the strip.
    static var headersOwnStrip = false {
        didSet { if headersOwnStrip != oldValue { schedule() } }
    }
    /// Header controls sit in the window's top this far.
    static let depth: CGFloat = 64
    private static let disabled = NSHashTable<UIScrollView>.weakObjects()
    private static var scheduled = false

    /// Applies once, after the views being added now are in the window.
    static func schedule() {
        guard !scheduled else { return }
        scheduled = true
        DispatchQueue.main.async {
            scheduled = false
            apply()
        }
    }

    private static func apply() {
        guard headersOwnStrip else {
            for scroll in disabled.allObjects { scroll.scrollsToTop = true }
            disabled.removeAllObjects()
            return
        }
        func walk(_ view: UIView) {
            if let scroll = view as? UIScrollView, !(scroll is StatusBarStripView.Cell), scroll.scrollsToTop {
                scroll.scrollsToTop = false
                disabled.add(scroll)
            }
            view.subviews.forEach(walk)
        }
        UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).forEach(walk)
    }

    /// A strip tap at `x`: the header control there acts as if tapped.
    static func tap(atX x: CGFloat, in window: UIWindow) {
        // A SwiftUI button or menu marks its frame; the narrowest one wins.
        var marker: (view: StatusBarTapMarker.Marker, width: CGFloat)?
        func find(_ view: UIView) {
            if let view = view as? StatusBarTapMarker.Marker, !view.isHidden {
                let frame = view.convert(view.bounds, to: window)
                if frame.minX <= x, x <= frame.maxX, frame.minY < depth, frame.maxY > 0,
                   frame.width < (marker?.width ?? .infinity) { marker = (view, frame.width) }
            }
            view.subviews.forEach(find)
        }
        find(window)
        if let marker { return marker.view.fire() }
        // A UIKit bar button under the strip at the same x.
        for y in stride(from: CGFloat(8), to: depth, by: 8) {
            var view = window.hitTest(CGPoint(x: x, y: y), with: nil)
            while let current = view, current !== window {
                if let control = current as? UIControl, control.isEnabled { return activate(control) }
                view = current.superview
            }
        }
    }

    static func activate(_ control: UIControl) {
        if let button = control as? UIButton, button.menu != nil, button.showsMenuAsPrimaryAction {
            button.performPrimaryAction()
        } else {
            control.sendActions(for: .touchUpInside)
        }
    }
}

/// Across the window's top beside two pages: a narrow scroll view every few
/// points, so iOS hands a status-bar tap to the cell under it.
struct StatusBarStripView: UIViewRepresentable {
    func makeUIView(context: Context) -> Strip { Strip() }
    func updateUIView(_ strip: Strip, context: Context) {}

    final class Strip: UIView {
        private static let cellWidth: CGFloat = 8

        override init(frame: CGRect) {
            super.init(frame: frame)
            backgroundColor = .clear
            accessibilityElementsHidden = true
        }
        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

        /// Never takes a touch: the header under it does.
        override func point(inside point: CGPoint, with event: UIEvent?) -> Bool { false }

        override func layoutSubviews() {
            super.layoutSubviews()
            let count = Int((bounds.width / Self.cellWidth).rounded(.up))
            while subviews.count < count { addSubview(Cell()) }
            while subviews.count > count { subviews.last?.removeFromSuperview() }
            for (index, cell) in subviews.enumerated() {
                cell.frame = CGRect(x: CGFloat(index) * Self.cellWidth, y: 0, width: Self.cellWidth, height: bounds.height)
            }
        }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            if window != nil { StatusBarStrip.schedule() }
        }
    }

    final class Cell: UIScrollView, UIScrollViewDelegate {
        override init(frame: CGRect) {
            super.init(frame: frame)
            delegate = self
            scrollsToTop = true
            showsVerticalScrollIndicator = false
            backgroundColor = .clear
        }
        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

        override func point(inside point: CGPoint, with event: UIEvent?) -> Bool { false }

        override func layoutSubviews() {
            super.layoutSubviews()
            // iOS only picks a scroll view that isn't already at its top.
            let size = CGSize(width: bounds.width, height: bounds.height + 2)
            if contentSize != size { contentSize = size }
            if contentOffset.y != 1 { contentOffset.y = 1 }
        }

        func scrollViewShouldScrollToTop(_ scrollView: UIScrollView) -> Bool {
            if let window { StatusBarStrip.tap(atX: convert(bounds, to: window).midX, in: window) }
            return false
        }
    }
}

/// Behind a SwiftUI header button: a strip tap over it runs `action`, or,
/// with none, opens the menu it's part of.
struct StatusBarTapMarker: UIViewRepresentable {
    var action: (() -> Void)?

    func makeUIView(context: Context) -> Marker { Marker() }
    func updateUIView(_ marker: Marker, context: Context) { marker.action = action }

    final class Marker: UIView {
        var action: (() -> Void)?

        override func point(inside point: CGPoint, with event: UIEvent?) -> Bool { false }

        func fire() {
            if let action { return action() }
            // SwiftUI hosts a `Menu` in a `UIButton` that shows it as its primary action.
            guard let window else { return }
            let frame = convert(bounds, to: window)
            func find(_ view: UIView) -> UIButton? {
                guard !view.isHidden, view.alpha > 0 else { return nil }
                if let button = view as? UIButton, button.menu != nil, button.showsMenuAsPrimaryAction,
                   button.convert(button.bounds, to: window).intersects(frame) { return button }
                for subview in view.subviews { if let found = find(subview) { return found } }
                return nil
            }
            // Its own: the window can hold another copy of a header.
            let ancestors = sequence(first: superview, next: { $0?.superview }).prefix(8).compactMap { $0 }
            if let button = ancestors.lazy.compactMap(find).first { StatusBarStrip.activate(button) }
        }
    }
}

/// Header buttons: a 44-point hit area, marked for the status-bar strip.
struct DuoHeaderButtonStyle: PrimitiveButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button(role: configuration.role, action: configuration.trigger) {
            configuration.label
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(.rect)
        }
        .buttonStyle(.borderless)
        .background { StatusBarTapMarker(action: configuration.trigger) }
    }
}

/// A header menu's label beside two pages: SwiftUI hosts the menu in a
/// `UIButton` as big as its label, so the label takes the 44 points, and
/// marks the menu for the status-bar strip. Navigation bars size their own
/// items.
struct DuoHeaderMenuLabel: ViewModifier {
    @Environment(\.duoLayout) private var layout
    @ViewBuilder func body(content: Content) -> some View {
        if layout.twoPages {
            content.frame(minWidth: 44, minHeight: 44).contentShape(.rect)
                .background { StatusBarTapMarker(action: nil) }
        } else {
            content
        }
    }
}
