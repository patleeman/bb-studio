import CoreGraphics
import Foundation

/// How the app lays itself out, from the device and how it is held (round 7).
///
/// - `phone`: an iPhone (or a narrow window): one column, one 44 pt bar.
/// - `folded`: the Duo closed, its 466 × 678 outer screen: one column, a
///   title line on top and every control in the right rail (9c).
/// - `book`: the Duo half open, hinge vertical: conversation | Workbench,
///   Home hidden until asked for (9d).
/// - `flat`: the Duo opened flat (or a wide iPad): Home | conversation |
///   Workbench (9e).
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
        if abs(screen.width - foldedScreen.width) < 1 && abs(screen.height - foldedScreen.height) < 1 { return .folded }
        let wide = window.width >= 900 && window.height >= 600 && window.width > window.height
        if wide {
            // Half open is the Duo's resting posture in the hand; only a
            // hinge that says it lies flat brings the third pane.
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

    /// One column with pushed screens (the iPhone's flow).
    var singleColumn: Bool { !splitsWorkbench }

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
        }
    }

    /// Lit: the mode or pane it stands for is the one showing.
    var lit: Bool {
        switch self {
        case .chat: true
        case .home(let lit): lit
        default: false
        }
    }
}

/// What a column shows, for the rail's buttons.
enum ShellScreen: Equatable {
    /// Home at the root.
    case home
    /// A conversation (or a pushed thread), in Chat or in its Workbench.
    case conversation(workbench: Bool)
    /// Anything else pushed (Memory, a page, Settings…): its bar hides on the Duo, so Back and its actions are here.
    case pushed(actions: Bool)
}

/// The rail's buttons for a posture and what shows, bottom-up (9c–9f).
enum RailLayout {
    /// `paneBack`: beside two pages, something is pushed over the left page's
    /// conversation; its Back comes lowest, and More holds its actions.
    static func slots(_ posture: ShellPosture, screen: ShellScreen, tabs: Int, homeShown: Bool, paneBack: Bool = false) -> [RailSlot] {
        let back: [RailSlot] = paneBack ? [.back] : []
        switch posture {
        case .phone:
            return []
        case .book:
            // Both panes show: no Chat/Workbench switch; Tabs is lowest (9d).
            return back + (homeShown ? [.tabs, .home(lit: true), .new] : [.tabs, .home(lit: false), .more])
        case .flat:
            return back + [.tabs, .home(lit: homeShown), .new, .more]
        case .folded, .vertical:
            switch screen {
            case .home: return [.new, .search]
            case .conversation(workbench: false): return [.workbench(tabs: tabs), .home(lit: false), .more]
            case .conversation(workbench: true): return [.chat, .home(lit: false), .tabs, .more]
            case .pushed(let actions): return actions ? [.back, .home(lit: false), .more] : [.back, .home(lit: false)]
            }
        }
    }
}

/// Whether Home shows beside the conversation. Flat shows it unless you hid
/// it; book hides it unless you brought it back (9d, 9e). A flip between
/// the two forgets a book's request but keeps a hide in flat.
struct ShellHomePane: Equatable {
    /// Home hidden by hand in flat: stays hidden there.
    var hiddenInFlat = false
    /// Home brought back by hand in book, until a conversation is picked.
    var shownInBook = false

    func shown(_ posture: ShellPosture) -> Bool {
        switch posture {
        case .flat: !hiddenInFlat
        case .book: shownInBook
        default: false
        }
    }

    /// The rail's Home: shows or hides the pane.
    mutating func toggle(_ posture: ShellPosture) {
        switch posture {
        case .flat: hiddenInFlat.toggle()
        case .book: shownInBook.toggle()
        default: break
        }
    }

    /// A conversation picked anywhere: book gives the left page back to it.
    mutating func pickedConversation() {
        shownInBook = false
    }

    mutating func postureChanged(from old: ShellPosture, to new: ShellPosture) {
        if old != new, new == .book || old == .book { shownInBook = false }
    }
}
