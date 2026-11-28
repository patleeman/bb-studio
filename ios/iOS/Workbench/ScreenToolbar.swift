import SwiftUI

/// A pushed screen's native bar from its one action list: the title, the
/// first two actions as toolbar buttons, the rest under ⋯. The system places
/// them (on the folded Duo, in the reserved right column). In a Workbench tab
/// the bar is the conversation's: the list goes up to its ⋯ instead, and the
/// screen sets no title or buttons of its own there.
struct ScreenToolbar: ViewModifier {
    let title: String
    let actions: [ScreenAction]
    var displayMode: NavigationBarItem.TitleDisplayMode = .inline
    @Environment(\.inWorkbench) private var inWorkbench

    func body(content: Content) -> some View {
        if inWorkbench {
            content.screenActions(actions)
        } else {
            content
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(displayMode)
                .toolbar { ToolbarItemGroup(placement: .topBarTrailing) { ScreenToolbarButtons(actions: actions) } }
        }
    }
}

/// A pushed screen's title; none in a Workbench tab, under the conversation's bar.
private struct ScreenTitle: ViewModifier {
    let title: String
    @Environment(\.inWorkbench) private var inWorkbench

    func body(content: Content) -> some View {
        if inWorkbench { content } else { content.navigationTitle(title) }
    }
}

extension View {
    func screenTitle(_ title: String) -> some View {
        modifier(ScreenTitle(title: title))
    }

    func screenToolbar(_ title: String, actions: [ScreenAction], displayMode: NavigationBarItem.TitleDisplayMode = .inline) -> some View {
        modifier(ScreenToolbar(title: title, actions: actions, displayMode: displayMode))
    }
}

private struct ScreenToolbarButtons: View {
    let actions: [ScreenAction]

    var body: some View {
        ForEach(actions.prefix(2)) { action in
            ScreenToolbarButton(action: action)
        }
        if actions.count > 2 {
            Menu { ScreenActionItems(actions: Array(actions.dropFirst(2))) } label: { Label("More", systemImage: "ellipsis") }
                .accessibilityIdentifier("screenMore")
        }
    }
}

/// One action as a bar button: a submenu, a share, or a tap. A Label, not
/// an icon alone: the bar draws the icon, and where the system folds bar
/// buttons into its overflow (the open Duo's control strip) the title names
/// it there; an untitled item is left out of the overflow altogether.
private struct ScreenToolbarButton: View {
    let action: ScreenAction

    var body: some View {
        Group {
            if !action.children.isEmpty {
                Menu { ScreenActionItems(actions: action.children) } label: { label }
            } else if let url = action.share {
                ShareLink(item: url) { label }
            } else {
                Button(role: action.role) { action.run() } label: { label }
            }
        }
        .disabled(action.disabled)
        .accessibilityIdentifier("screenAction-\(action.id)")
    }

    private var label: some View { Label(action.title, systemImage: action.systemImage) }
}
