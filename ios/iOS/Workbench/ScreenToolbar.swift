import SwiftUI

/// A pushed screen's native bar from its one action list: the title, the
/// first two actions as toolbar buttons, the rest under ⋯. The system places
/// them (on the folded Duo, in the reserved right column).
struct ScreenToolbar: ViewModifier {
    let title: String
    let actions: [ScreenAction]
    var displayMode: NavigationBarItem.TitleDisplayMode = .inline

    func body(content: Content) -> some View {
        content
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(displayMode)
            .toolbar { ToolbarItemGroup(placement: .topBarTrailing) { ScreenToolbarButtons(actions: actions) } }
    }
}

extension View {
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
            Menu { ScreenActionItems(actions: Array(actions.dropFirst(2))) } label: { Image(systemName: "ellipsis") }
                .accessibilityLabel("More")
                .accessibilityIdentifier("screenMore")
        }
    }
}

/// One action as a bar button: a submenu, a share, or a tap.
private struct ScreenToolbarButton: View {
    let action: ScreenAction

    var body: some View {
        Group {
            if !action.children.isEmpty {
                Menu { ScreenActionItems(actions: action.children) } label: { Image(systemName: action.systemImage) }
            } else if let url = action.share {
                ShareLink(item: url) { Image(systemName: action.systemImage) }
            } else {
                Button(role: action.role) { action.run() } label: { Image(systemName: action.systemImage) }
            }
        }
        .disabled(action.disabled)
        .accessibilityLabel(action.title)
        .accessibilityIdentifier("screenAction-\(action.id)")
    }
}
