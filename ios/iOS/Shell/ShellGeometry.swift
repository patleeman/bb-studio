import SwiftUI
import UIKit

/// The window, the screen it is on and the hinge: everything `ShellPosture`
/// reads, from UIKit rather than SwiftUI's keyboard-reduced proposal.
struct ShellGeometry: Equatable {
    var window: CGSize = .zero
    var screen: CGSize = .zero
    var phone = UIDevice.current.userInterfaceIdiom == .phone
    var hinge: ShellPosture.Hinge?
    /// The window's trailing safe area: the column the Duo's system keeps for its status.
    var trailingInset: CGFloat = 0

    @MainActor var posture: ShellPosture {
        ShellPosture.resolve(window: window, screen: screen, phone: phone, hinge: hinge, forced: ShellQA.posture)
    }

    /// On the Duo's inner screen, whatever the window: it draws no home
    /// indicator, though iOS reports one (also beside another app).
    var innerScreen: Bool { DuoLayout.isInnerScreen(screen, phone: phone) }
}

extension EnvironmentValues {
    @Entry var shellPosture: ShellPosture = .phone
    /// The column the system reserves at the window's trailing edge, which the rail fills.
    @Entry var shellReservedColumn: CGFloat = 0
    /// The window is on the Duo's inner screen (see `ShellGeometry.innerScreen`).
    @Entry var shellInnerScreen = false
}

enum ShellQA {
    /// `-qaPosture folded|book|flat|vertical|phone`: a posture the simulator
    /// can't make (it has no hinge). The window's size still comes from
    /// `bbstudio://qa-duo/…`; `qa-duo/posture?<name>` changes it while running.
    @MainActor static var override: ShellPosture?

    @MainActor static var posture: ShellPosture? {
        #if DEBUG
        if let override { return override }
        let arguments = ProcessInfo.processInfo.arguments
        guard let at = arguments.firstIndex(of: "-qaPosture"), arguments.indices.contains(at + 1) else { return nil }
        return ShellPosture(rawValue: arguments[at + 1])
        #else
        nil
        #endif
    }
}

/// Reports the window's geometry and the hinge's status. The hinge comes
/// from `UIHingeInteraction` (iOS 27.1): nil where there is no hinge.
struct ShellGeometryReader: UIViewRepresentable {
    var changed: (ShellGeometry) -> Void

    func makeUIView(context: Context) -> Probe { Probe(changed: changed) }
    func updateUIView(_ view: Probe, context: Context) { view.changed = changed }

    final class Probe: UIView {
        var changed: (ShellGeometry) -> Void
        private var last: ShellGeometry?
        private var hinge: ShellPosture.Hinge?

        init(changed: @escaping (ShellGeometry) -> Void) {
            self.changed = changed
            super.init(frame: .zero)
            isUserInteractionEnabled = false
            if #available(iOS 27.1, *) {
                addInteraction(UIHingeInteraction { [weak self] _, update in
                    self?.hinge = update.hinge.flatMap { Self.hinge($0.status) }
                    self?.report()
                })
            }
        }
        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

        @available(iOS 27.1, *)
        private static func hinge(_ status: UIHinge.Status) -> ShellPosture.Hinge? {
            switch status {
            case .closed: .closed
            case .partiallyOpen: .partiallyOpen
            case .fullyOpen: .fullyOpen
            default: nil
            }
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            report()
        }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            #if DEBUG
            // The Duo fixture's window hooks (keyboard frames, -qaDark, a cold wide window).
            if let window { DuoDemo.configure(window) }
            #endif
            report()
        }

        func report() {
            guard let window else { return }
            var screen = window.windowScene?.screen.bounds.size ?? .zero
            #if DEBUG
            // The simulator's screen is the outer one; a resized window stands for the inner one.
            if let size = DuoDemo.screenSize { screen = size }
            #endif
            let next = ShellGeometry(window: window.bounds.size, screen: screen,
                                     phone: traitCollection.userInterfaceIdiom == .phone, hinge: hinge,
                                     trailingInset: window.safeAreaInsets.right)
            guard next != last else { return }
            last = next
            Breadcrumbs.shared.record("posture \(next.posture.rawValue) \(Int(next.window.width))x\(Int(next.window.height))")
            DispatchQueue.main.async { [weak self] in self?.changed(next) }
        }
    }
}
