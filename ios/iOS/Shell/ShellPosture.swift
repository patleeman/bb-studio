import CoreGraphics
import Foundation

/// How the app lays itself out, from the device and how it is held (round 7).
///
/// - `phone`: an iPhone (or a narrow window): one column, one 44 pt bar.
/// - `folded`: the Duo closed, its 466 × 678 outer screen: one column, a
///   title line on top and every control in the right rail (9c).
/// - `book`: the Duo half open, hinge vertical, and `flat`: opened flat
///   (or a wide iPad). Both lay out the same: panes by width and text size
///   (`ShellPanes`): the conversation, the Workbench when it has a tab the
///   phone can show, Home when it fits (9d, 9e). Where two panes can't both
///   be readable they lay out as `vertical` (`laidOut`).
/// - `vertical`: the Duo open with the hinge across: a big iPhone, one
///   column over both screens, the controls in the rail (9f).
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

    /// The controls live in the rail at the right edge (the Duo's reserved
    /// column) and the top keeps only a title line; else one bar on top.
    var usesRail: Bool { self != .phone }

    /// The conversation and its Workbench side by side.
    var splitsWorkbench: Bool { self == .book || self == .flat }

    /// The posture as laid out in `width` (the room left of the rail) at a
    /// body text size: book and flat split only when the conversation and a
    /// side pane are both readable (`ShellPanes`); else they are one big
    /// column, as vertical is (9f), whose width never fits two.
    func laidOut(width: CGFloat, body: CGFloat) -> ShellPosture {
        guard splitsWorkbench, !ShellPanes.splits(width: width, body: body) else { return self }
        return .vertical
    }

    /// Body text a step up, on the big one-column screen (9f: 18 pt).
    var largeType: Bool { self == .vertical }

    /// The title line's height on the Duo; the iPhone's bar is 44.
    var titleLine: CGFloat { self == .vertical ? 44 : 40 }

    /// The Duo open: its inner screen draws no home indicator, though iOS
    /// reports a 34 pt inset for one; the composer sits on the bottom edge.
    var innerScreen: Bool { self == .book || self == .flat || self == .vertical }

    /// The Duo's reserved status column, which the rail fills.
    static let railWidth: CGFloat = 84
}

/// What one rail button does. The rail lists them bottom-up: the first is
/// lowest, under the thumb.
enum RailSlot: Equatable, Identifiable {
    /// Flip to the Workbench, with its tab count.
    case workbench(tabs: Int)
    /// Flip back to the chat.
    case chat
    /// Back from a pushed screen.
    case back
    /// Home: pops to it in one column; shows or hides its pane beside the conversation (lit while shown).
    case home(lit: Bool)
    /// The Workbench's tab menu.
    case tabs
    /// The conversation's menu (with the shown tab's actions first).
    case more
    case new
    case search
    /// A pushed screen's own action (Search, + New skill…), as a button of its own.
    case action(ScreenAction)

    var id: String {
        switch self {
        case .workbench: "workbench"
        case .chat: "chat"
        case .back: "back"
        case .home: "home"
        case .tabs: "tabs"
        case .more: "more"
        case .new: "new"
        case .search: "search"
        case .action(let action): "action-\(action.id)"
        }
    }

    var title: String {
        switch self {
        case .workbench: "Workbench"
        case .chat: "Chat"
        case .back: "Back"
        case .home: "Home"
        case .tabs: "Tabs"
        case .more: "More"
        case .new: "New"
        case .search: "Search"
        case .action(let action): action.title
        }
    }

    var symbol: String {
        switch self {
        case .workbench: "rectangle.split.2x1"
        case .chat: "bubble.left"
        case .back: "chevron.backward"
        case .home: "house"
        case .tabs: "square.on.square"
        case .more: "ellipsis"
        case .new: "square.and.pencil"
        case .search: "magnifyingglass"
        case .action(let action): action.systemImage
        }
    }

    /// Lit: the mode or pane it stands for is the one showing.
    var lit: Bool {
        switch self {
        case .chat: true
        case .home(let lit): lit
        case .action(let action): action.checked
        default: false
        }
    }
}

/// What a column shows, for the rail's buttons.
enum ShellScreen: Equatable {
    /// Home at the root.
    case home
    /// A conversation (or a pushed thread), in Chat or in its Workbench.
    /// `over`: pushed over another conversation (a reply thread, a fork, a
    /// worker), so Back returns to it.
    case conversation(workbench: Bool, over: Bool = false)
    /// Anything else pushed (Memory, a page, Settings…): its bar hides on the Duo,
    /// so Back and its actions are here. `depth`: how far over Home it is.
    case pushed(actions: [ScreenAction], depth: Int)
}

/// The rail's buttons for a posture and what shows, bottom-up (9c–9f).
enum RailLayout {
    /// A pushed screen's rail, lowest first: Back, its first two actions as
    /// buttons, More for the rest, and Home when Back wouldn't already be Home.
    static func pushed(_ actions: [ScreenAction], depth: Int) -> [RailSlot] {
        let shown = actions.prefix(2).map(RailSlot.action)
        let more: [RailSlot] = actions.count > 2 ? [.more] : []
        let home: [RailSlot] = depth > 1 ? [.home(lit: false)] : []
        return [.back] + shown + more + home
    }

    /// Beside two pages, something pushed over the left page's conversation:
    /// its rail comes first (Back lowest), then Home alone when its companion
    /// has the right page, else the Workbench's own buttons (one More: the
    /// pushed screen's overflow when it has one).
    static func panePushed(_ actions: [ScreenAction], companion: Bool, homeShown: Bool, own: [RailSlot]) -> [RailSlot] {
        let screen = pushed(actions, depth: 1)
        if companion { return screen + [.home(lit: homeShown)] }
        return screen + own.filter { $0 != .more || !screen.contains(.more) }
    }

    /// The actions More holds once the first two are buttons of their own.
    static func overflow(_ actions: [ScreenAction]) -> [ScreenAction] {
        Array(actions.dropFirst(2))
    }

    static func slots(_ posture: ShellPosture, screen: ShellScreen, tabs: Int, homeShown: Bool) -> [RailSlot] {
        switch posture {
        case .phone:
            return []
        case .book, .flat:
            // Side by side: no Chat/Workbench switch; Tabs is lowest (9d, 9e).
            return [.tabs, .home(lit: homeShown), .new, .more]
        case .folded, .vertical:
            switch screen {
            case .home: return [.new, .search]
            case .conversation(let workbench, let over):
                let own: [RailSlot] = workbench ? [.chat, .home(lit: false), .tabs, .more] : [.workbench(tabs: tabs), .home(lit: false), .more]
                return over ? [.back] + own : own
            case .pushed(let actions, let depth): return pushed(actions, depth: depth)
            }
        }
    }
}
