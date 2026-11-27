import CoreGraphics
import Foundation

/// How the app lays itself out, from the device and how it is held (round 7).
///
/// Every posture has the same native chrome (round 8): the system's tab bar
/// and a navigation bar per stack, which the system places (on the folded
/// Duo, the tab bar and the bar's buttons go to the reserved right column).
///
/// - `phone`: an iPhone (or a narrow window): one column.
/// - `folded`: the Duo closed, its 466 × 678 outer screen: one column.
/// - `book`: the Duo half open, hinge vertical, and `flat`: opened flat
///   (or a wide iPad). Both lay out the same: panes by width and text size
///   (`ShellPanes`): the conversation, the Workbench when it has a tab the
///   phone can show, Home when it fits. Where two panes can't both
///   be readable they lay out as `vertical` (`laidOut`).
/// - `vertical`: the Duo open with the hinge across: a big iPhone, one
///   column over both screens, its type a step up.
enum ShellPosture: String, CaseIterable, Equatable {
    case phone, folded, book, flat, vertical

    /// What the hinge reports (`UIHinge.Status`), when the device has one.
    enum Hinge: Equatable { case closed, partiallyOpen, fullyOpen }

    /// The Duo's outer screen.
    static let foldedScreen = CGSize(width: 466, height: 678)

    /// The posture for a window. `screen` is the whole screen the window is
    /// on; `hinge` is nil where there is none (an iPhone, the simulator) and
    /// `forced` is a test's `-qaPosture`.
    static func resolve(window: CGSize, screen: CGSize, phone: Bool, hinge: Hinge?, forced: ShellPosture? = nil) -> ShellPosture {
        if let forced { return forced }
        guard phone else { return window.width >= 900 ? .flat : .phone }
        // The outer screen either way up: turned sideways it is still the folded Duo.
        if abs(min(screen.width, screen.height) - foldedScreen.width) < 1,
           abs(max(screen.width, screen.height) - foldedScreen.height) < 1 { return .folded }
        let wide = window.width >= 900 && window.height >= 600 && window.width > window.height
        if wide {
            // Half open is the Duo's resting posture in the hand. Book and
            // flat lay out alike (`ShellPanes`); the name is the hinge's.
            return hinge == .fullyOpen ? .flat : .book
        }
        let tall = window.height >= 900 && window.width >= 600 && window.height > window.width
        return tall ? .vertical : .phone
    }

    /// The conversation and its Workbench side by side.
    var splitsWorkbench: Bool { self == .book || self == .flat }

    /// The posture as laid out in `width` (the window's safe width) at a
    /// body text size: book and flat split only when the conversation and a
    /// side pane are both readable (`ShellPanes`); else they are one big
    /// column, as vertical is (9f), whose width never fits two.
    func laidOut(width: CGFloat, body: CGFloat) -> ShellPosture {
        guard splitsWorkbench, !ShellPanes.splits(width: width, body: body) else { return self }
        return .vertical
    }

    /// Body text a step up, on the big one-column screen (9f: 18 pt).
    var largeType: Bool { self == .vertical }

    /// The Duo open: its inner screen draws no home indicator, though iOS
    /// reports a 34 pt inset for one; the composer sits on the bottom edge.
    var innerScreen: Bool { self == .book || self == .flat || self == .vertical }
}
