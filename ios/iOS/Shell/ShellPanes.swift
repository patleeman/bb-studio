import CoreGraphics
import SwiftUI
import UIKit

/// The open Duo's panes, from the width and the text size (round 7 fix:
/// "the layout is super cramped"). Each pane has a minimum readable width
/// that scales with Dynamic Type:
///
/// - the conversation: about 60 characters a line;
/// - Home: a conversation's name and its time on one line;
/// - the side pane (the Workbench of the thread on top of the column).
///
/// The conversation always shows. The side pane shows only when the thread
/// has a tab the phone can show and its Workbench isn't hidden by hand
/// (`WorkbenchPaneChoice`), and gets the smaller share (the conversation
/// keeps about 58%). Home shows beside them only when all of them meet their
/// minimums; else Home's button brings it over the conversation. Where the
/// conversation and a side pane can't both be readable, the posture lays out
/// as one column (`ShellPosture.laidOut`).
///
/// The conversation and the side pane are one stack (`stack`), right of
/// Home to the window's trailing edge in every state: the system puts the
/// bar buttons of the stack that reaches that edge in the Duo's control
/// strip, and those of any other stack inline in its bar.
struct ShellPanes: Equatable {
    var home: CGFloat = 0
    var conversation: CGFloat
    var side: CGFloat = 0
    /// Home fits beside the others (shown unless hidden by hand).
    var homeFits: Bool

    /// The stack's width: the conversation and its side pane, from Home's edge to the window's.
    var stack: CGFloat { conversation + side }

    /// The conversation's share of the room it splits with the side pane.
    static let conversationShare: CGFloat = 0.58
    /// SF Pro's average character width in running English text, in ems (measured).
    static let characterWidth: CGFloat = 0.44

    /// About 60 characters of body text, and the transcript's margins.
    static func conversationMinimum(body: CGFloat) -> CGFloat { (body * characterWidth * 60 + 32).rounded() }
    /// A row's name (about 18 characters, semibold) and its glyph and time, and the list's insets.
    static func homeMinimum(body: CGFloat) -> CGFloat { (body * 13 + 48).rounded() }
    /// A page, a design or a file at a readable size: an iPhone's width at body 17.
    static func sideMinimum(body: CGFloat) -> CGFloat { (body * 16 + 32).rounded() }

    /// The conversation and a side pane both fit, readable: two pages.
    static func splits(width: CGFloat, body: CGFloat) -> Bool {
        conversationMinimum(body: body) + sideMinimum(body: body) <= width
    }

    /// The panes for `width` (the room between the safe areas). `side`: the side
    /// pane has something to show. `home`: Home is wanted beside them (not hidden by hand).
    static func make(width: CGFloat, body: CGFloat, side: Bool, home: Bool) -> ShellPanes {
        let showsSide = side && splits(width: width, body: body)
        let homeMin = homeMinimum(body: body)
        let homeFits = conversationMinimum(body: body) + homeMin + (showsSide ? sideMinimum(body: body) : 0) <= width
        let homeWidth: CGFloat
        if home, homeFits {
            // With a side pane Home keeps its minimum; alone beside the conversation, up to a third.
            homeWidth = showsSide ? homeMin : min(max((width * 0.3).rounded(), homeMin), width - conversationMinimum(body: body))
        } else {
            homeWidth = 0
        }
        let split = split(stack: width - homeWidth, body: body, side: showsSide)
        return ShellPanes(home: homeWidth, conversation: split.conversation, side: split.side, homeFits: homeFits)
    }

    /// The stack's room split between a screen and its side pane: each screen
    /// on the stack splits it for its own thread (a worker pushed over the
    /// conversation has its own Workbench). No side pane where both can't be readable.
    static func split(stack: CGFloat, body: CGFloat, side: Bool) -> (conversation: CGFloat, side: CGFloat) {
        let conversationMin = conversationMinimum(body: body)
        let sideMin = sideMinimum(body: body)
        guard side, conversationMin + sideMin <= stack else { return (stack, 0) }
        let conversation = min(max((stack * conversationShare).rounded(), conversationMin), stack - sideMin)
        return (conversation, stack - conversation)
    }

    /// Home brought over the conversation (when it doesn't fit beside it): a
    /// little wider than its minimum, never the whole width.
    static func overlayWidth(width: CGFloat, body: CGFloat) -> CGFloat {
        min(max((width * 0.4).rounded(), homeMinimum(body: body)), width)
    }

    /// Body text's size at a Dynamic Type size.
    static func body(_ size: DynamicTypeSize) -> CGFloat {
        UIFont.preferredFont(forTextStyle: .body, compatibleWith: UITraitCollection(preferredContentSizeCategory: UIContentSizeCategory(size)))
            .pointSize
    }
}

/// Home beside the conversation, or over it, by hand (Home's button in the
/// control strip and the edge swipe). Where Home fits it shows unless you hid it; where it
/// doesn't, Home comes over the conversation until something is picked.
struct ShellHomePane: Equatable {
    /// Hidden by hand where it fits: stays hidden.
    var hidden = false
    /// Brought over the conversation by hand where it doesn't fit.
    var overlaid = false

    func shown(fits: Bool) -> Bool { fits ? !hidden : overlaid }

    /// Home's button: shows or hides it.
    mutating func toggle(fits: Bool) {
        if fits { hidden.toggle() } else { overlaid.toggle() }
    }

    /// Anything pushed (a conversation, Memory, a worker, a page…) closes
    /// Home over the conversation. `Router.path` calls this on every push.
    mutating func pushed() {
        overlaid = false
    }

    /// The panes laid out anew (side by side again, or Home now fits beside
    /// the others, or no longer does): Home isn't over the conversation, so
    /// it never comes back over it unasked. Opening the hinge from book to
    /// flat is no new layout.
    mutating func layoutChanged() {
        overlaid = false
    }
}

/// The Workbench pane shown or hidden by hand beside a conversation (its
/// button in the control strip), remembered per conversation. Shown unless
/// hidden: a tab the agent opens shows where you never hid it.
@MainActor @Observable
final class WorkbenchPaneChoice {
    static let shared = WorkbenchPaneChoice(defaults: AppGroup.defaults)

    /// The conversations whose Workbench is hidden, the latest last.
    private(set) var hidden: [String]
    private let defaults: UserDefaults
    private static let key = "shellWorkbenchHidden"
    /// Enough for every conversation in use; the oldest choices go first.
    static let kept = 200

    init(defaults: UserDefaults) {
        self.defaults = defaults
        #if DEBUG
        // `-qaForgetWorkbenchPanes`: a UI test starts with every Workbench shown.
        if ProcessInfo.processInfo.arguments.contains("-qaForgetWorkbenchPanes") { defaults.removeObject(forKey: Self.key) }
        #endif
        hidden = defaults.stringArray(forKey: Self.key) ?? []
    }

    func shown(_ threadId: String) -> Bool { !hidden.contains(threadId) }

    /// Shown again: a tab you opened yourself.
    func show(_ threadId: String) {
        guard !shown(threadId) else { return }
        toggle(threadId)
    }

    /// The Workbench button: hides the pane, or brings it back.
    func toggle(_ threadId: String) {
        if let at = hidden.firstIndex(of: threadId) {
            hidden.remove(at: at)
        } else {
            hidden.append(threadId)
            if hidden.count > Self.kept { hidden.removeFirst(hidden.count - Self.kept) }
        }
        defaults.set(hidden, forKey: Self.key)
    }
}
