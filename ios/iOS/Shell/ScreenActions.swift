import SwiftUI

/// One action a screen offers: a Workbench tab's (Reload, Share…) or a pushed
/// screen's (Edit, Sort…). A pushed screen shows its list as native toolbar
/// items (`.screenToolbar`); a Workbench tab has no bar of its own, so it
/// hands its list up with `.screenActions(_:)` and the conversation's ⋯ shows it.
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

extension View {
    /// A Workbench tab's actions, for the conversation's ⋯. Empty: none.
    func screenActions(_ actions: [ScreenAction]) -> some View {
        // The innermost non-empty list wins: set only where the content set none
        // (a plain preference here would override an editor's own actions).
        transformPreference(ScreenActionsKey.self) { if $0.isEmpty { $0 = actions } }
    }
}

/// The actions as menu items, for any ⋯ menu.
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
