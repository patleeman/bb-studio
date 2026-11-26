import SwiftUI

/// One action a Workbench tab offers (Reload, Share, Edit…). A tab draws no
/// bar of its own: it hands these up with `.workbenchTabActions(_:)`, and the
/// shell shows them at the top of its More menu (the iPhone's ⋯, the Duo
/// rail's More), above the conversation's own items.
struct WorkbenchTabAction: Identifiable, Equatable {
    /// Stable within the tab ("reload", "share"…); also its accessibility identifier, `workbenchAction-<id>`.
    var id: String
    var title: String
    var systemImage: String
    var role: ButtonRole?
    var disabled = false
    /// A share sheet for this URL instead of `run`.
    var share: URL?
    var run: @MainActor () -> Void = {}

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.id == rhs.id && lhs.title == rhs.title && lhs.systemImage == rhs.systemImage && lhs.role == rhs.role
            && lhs.disabled == rhs.disabled && lhs.share == rhs.share
    }
}

/// The shown tab's actions, read by the Workbench container. The innermost
/// (the tab's own view) wins over anything set further out.
struct WorkbenchTabActionsKey: PreferenceKey {
    static let defaultValue: [WorkbenchTabAction] = []
    static func reduce(value: inout [WorkbenchTabAction], nextValue: () -> [WorkbenchTabAction]) {
        let next = nextValue()
        if !next.isEmpty { value = next }
    }
}

extension View {
    /// A Workbench tab's actions, for the shell's More menu. Empty: none.
    func workbenchTabActions(_ actions: [WorkbenchTabAction]) -> some View {
        preference(key: WorkbenchTabActionsKey.self, value: actions)
    }
}

/// The actions as menu items, for any More menu.
struct WorkbenchTabActionItems: View {
    let actions: [WorkbenchTabAction]

    var body: some View {
        ForEach(actions) { action in
            if let url = action.share {
                ShareLink(item: url) { Label(action.title, systemImage: action.systemImage) }
                    .accessibilityIdentifier("workbenchAction-\(action.id)")
            } else {
                Button(role: action.role) { action.run() } label: { Label(action.title, systemImage: action.systemImage) }
                    .disabled(action.disabled)
                    .accessibilityIdentifier("workbenchAction-\(action.id)")
            }
        }
    }
}
