import SwiftUI

/// One action a screen offers: a Workbench tab's (Reload, Share…) or a pushed
/// screen's (New record, Sort…). Screens draw no bar of their own on the Duo
/// (and a Workbench tab nowhere): they hand these up with `.screenActions(_:)`
/// and the shell shows them in its More menu (the iPhone's ⋯ for a tab, the
/// Duo rail's More for every screen).
struct ScreenAction: Identifiable, Equatable {
    /// Stable within the screen ("reload", "add"…); also its accessibility identifier, `screenAction-<id>`.
    var id: String
    var title: String
    var systemImage: String
    var role: ButtonRole?
    var disabled = false
    /// Shown with a check: one choice of several (a sort order, a grouping).
    var checked = false
    /// A share sheet for this URL instead of `run`.
    var share: URL?
    /// A submenu (a sort's choices, New's kinds) instead of `run`.
    var children: [ScreenAction] = []
    var run: @MainActor () -> Void = {}

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.id == rhs.id && lhs.title == rhs.title && lhs.systemImage == rhs.systemImage && lhs.role == rhs.role
            && lhs.disabled == rhs.disabled && lhs.checked == rhs.checked && lhs.share == rhs.share && lhs.children == rhs.children
    }
}

/// The shown screen's actions. The innermost non-empty list wins over anything set further out.
struct ScreenActionsKey: PreferenceKey {
    static let defaultValue: [ScreenAction] = []
    static func reduce(value: inout [ScreenAction], nextValue: () -> [ScreenAction]) {
        let next = nextValue()
        if !next.isEmpty { value = next }
    }
}

/// The shown screen's title, for the Duo's title line (its bar is hidden there).
struct ScreenTitleKey: PreferenceKey {
    static let defaultValue: String? = nil
    static func reduce(value: inout String?, nextValue: () -> String?) {
        if let next = nextValue() { value = next }
    }
}

extension View {
    /// A screen's actions, for the shell's More menu. Empty: none.
    func screenActions(_ actions: [ScreenAction]) -> some View {
        preference(key: ScreenActionsKey.self, value: actions)
    }

    /// A screen's title, for the Duo's title line.
    func screenTitle(_ title: String) -> some View {
        preference(key: ScreenTitleKey.self, value: title)
    }
}

/// The actions as menu items, for any More menu.
struct ScreenActionItems: View {
    let actions: [ScreenAction]

    var body: some View {
        ForEach(actions) { action in
            if !action.children.isEmpty {
                Menu { ScreenActionItems(actions: action.children) } label: { Label(action.title, systemImage: action.systemImage) }
                    .disabled(action.disabled)
                    .accessibilityIdentifier("screenAction-\(action.id)")
            } else if let url = action.share {
                ShareLink(item: url) { Label(action.title, systemImage: action.systemImage) }
                    .accessibilityIdentifier("screenAction-\(action.id)")
            } else {
                Button(role: action.role) { action.run() } label: {
                    Label(action.title, systemImage: action.checked ? "checkmark" : action.systemImage)
                }
                .disabled(action.disabled)
                .accessibilityAddTraits(action.checked ? .isSelected : [])
                .accessibilityIdentifier("screenAction-\(action.id)")
            }
        }
    }
}
