import CoreGraphics
import SwiftUI
import UIKit

/// The open Duo's panes, from the width and the text size (round 7 fix:
/// "the layout is super cramped"). Each pane has a minimum readable width
/// that scales with Dynamic Type:
///
/// - the conversation: about 60 characters a line;
/// - Home: a conversation's name and its time on one line;
/// - the side pane (the Workbench, or what a pushed screen puts there).
///
/// The conversation always shows. The side pane shows only when there is
/// something for it (a tab the phone can show, a companion) and gets the
/// smaller share (the conversation keeps about 58%). Home shows beside them
/// only when all of them meet their minimums; else the rail's Home brings it
/// over the conversation. Where the conversation and a side pane can't both
/// be readable, the posture lays out as one column (`ShellPosture.laidOut`).
struct ShellPanes: Equatable {
    var home: CGFloat = 0
    var conversation: CGFloat
    var side: CGFloat = 0
    /// Home fits beside the others (shown unless hidden by hand).
    var homeFits: Bool

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

    /// The panes for `width` (the room left of the rail). `side`: the side
    /// pane has something to show. `home`: Home is wanted beside them (not hidden by hand).
    static func make(width: CGFloat, body: CGFloat, side: Bool, home: Bool) -> ShellPanes {
        let conversationMin = conversationMinimum(body: body)
        let homeMin = homeMinimum(body: body)
        let sideMin = sideMinimum(body: body)
        let showsSide = side && conversationMin + sideMin <= width
        let homeFits = conversationMin + homeMin + (showsSide ? sideMin : 0) <= width
        let homeWidth: CGFloat
        if home, homeFits {
            // With a side pane Home keeps its minimum; alone beside the conversation, up to a third.
            homeWidth = showsSide ? homeMin : min(max((width * 0.3).rounded(), homeMin), width - conversationMin)
        } else {
            homeWidth = 0
        }
        let rest = width - homeWidth
        guard showsSide else { return ShellPanes(home: homeWidth, conversation: rest, homeFits: homeFits) }
        let conversation = min(max((rest * conversationShare).rounded(), conversationMin), rest - sideMin)
        return ShellPanes(home: homeWidth, conversation: conversation, side: rest - conversation, homeFits: homeFits)
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

/// Home beside the conversation, or over it, by hand (the rail's Home and
/// the edge swipe). Where Home fits it shows unless you hid it; where it
/// doesn't, Home comes over the conversation until something is picked.
struct ShellHomePane: Equatable {
    /// Hidden by hand where it fits: stays hidden.
    var hidden = false
    /// Brought over the conversation by hand where it doesn't fit.
    var overlaid = false

    func shown(fits: Bool) -> Bool { fits ? !hidden : overlaid }

    /// The rail's Home: shows or hides it.
    mutating func toggle(fits: Bool) {
        if fits { hidden.toggle() } else { overlaid.toggle() }
    }

    /// Anything pushed (a conversation, Memory, a worker, a page…) closes
    /// Home over the conversation. `Router.path` calls this on every push.
    mutating func pushed() {
        overlaid = false
    }

    /// A new layout (posture, text size) starts without Home over the conversation.
    mutating func layoutChanged() {
        overlaid = false
    }
}
