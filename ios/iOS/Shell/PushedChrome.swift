import SwiftUI

/// A pushed screen that isn't a conversation (Memory, Library, a page, a
/// design, Settings…). The iPhone keeps its bar. On the Duo there is one rail
/// for every screen: the bar hides, the title is the title line (or the
/// screen's own, `.screenDrawsTitleLine`), and Back and the screen's actions
/// (`.screenActions`) are in the rail. Beside two pages, the right page's
/// rail holds them (`ShellPages`), and a `.screenCompanion` takes that page.
struct PushedChrome: ViewModifier {
    /// The title until the screen names itself (`.screenTitle`).
    let title: String
    /// Beside two pages, in the left page's stack.
    var pane = false
    @State private var named: String?
    @State private var ownsTitleLine = false
    @State private var actions: [ScreenAction] = []
    @ObservedObject private var router = Router.shared
    @Environment(\.shellPosture) private var posture

    func body(content: Content) -> some View {
        if posture.usesRail {
            VStack(spacing: 0) {
                if !ownsTitleLine { ShellTitleLine(title: named ?? title, posture: posture) }
                content
            }
            .toolbar(.hidden, for: .navigationBar)
            .onPreferenceChange(ScreenTitleKey.self) { value in MainActor.assumeIsolated { if named != value { named = value } } }
            .onPreferenceChange(ScreenDrawsTitleLineKey.self) { value in
                MainActor.assumeIsolated { if ownsTitleLine != value { ownsTitleLine = value } }
            }
            .onPreferenceChange(ScreenActionsKey.self) { value in MainActor.assumeIsolated { if actions != value { actions = value } } }
            .modifier(PushedRail(enabled: !pane, actions: actions, depth: router.path.count))
        } else {
            content
        }
    }
}

/// One column: the screen's own rail, Back lowest, then its actions.
private struct PushedRail: ViewModifier {
    let enabled: Bool
    let actions: [ScreenAction]
    let depth: Int
    @ObservedObject private var router = Router.shared
    @Environment(\.shellPosture) private var posture
    /// Back pops this screen however it was pushed (a route, or a link inside a page).
    @Environment(\.dismiss) private var dismiss

    func body(content: Content) -> some View {
        if enabled {
            content.rail(RailLayout.slots(posture, screen: .pushed(actions: actions, depth: depth), tabs: 0, homeShown: false),
                         actions: RailActions(tap: { slot in
                             switch slot {
                             case .back: dismiss()
                             case .home: router.path = []
                             default: break
                             }
                         }, more: AnyView(ScreenActionItems(actions: RailLayout.overflow(actions)))),
                         large: posture.largeType)
        } else {
            content
        }
    }
}

extension Route {
    /// A pushed screen's title on the Duo's title line, until it names itself.
    var shellTitle: String {
        switch self {
        case .place(let page): page.title
        case .memorySkill(_, let name): name
        case .memoryNewSkill: "New skill"
        case .studio: "Studio"
        case .settings: "Settings"
        case .theme: "Theme"
        case .page, .pages: "Page"
        case .design: "Design"
        case .drawing: "Drawing"
        case .artifact, .mini: "App"
        case .recording: "Recording"
        case .automations, .automation: "Automations"
        case .botAutomation(_, let automation, _): automation.name
        case .usage: "Usage"
        case .archived: "Archived threads"
        case .terminals(_, let title): title
        case .visualChats, .visualChat: "Visual Chat"
        case .thread, .conversation: "Conversation"
        }
    }
}
