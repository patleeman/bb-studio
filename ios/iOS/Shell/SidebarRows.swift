import SwiftUI

/// Studio's sidebar lists: their content margins, a row's selection and its
/// trailing inset. (What was left in use of the old Duo layout.)
@MainActor
enum SidebarContentInsets {
    static let leading: CGFloat = 16
    static let trailing = leading
}

/// List row backgrounds are hosted apart from their cells: a whole rounded
/// highlight, like the desktop sidebar's, rather than a cell fill the section
/// clips to rounded top corners only.
struct SidebarSelectionBackground: View {
    let selected: Bool
    var body: some View {
        RoundedRectangle(cornerRadius: 12, style: .continuous)
            .fill(selected ? Color.accentColor.opacity(0.15) : .clear)
            .padding(.vertical, 2)
            .ignoresSafeArea(.container, edges: .trailing)
    }
}

/// Rows keep the same 20-point interior padding on both sides of their card.
/// A phone list's trailing row inset doesn't include the sidebar's content
/// margin, so add it; the iPad's automatic inset is 16 points, so set it too.
struct SidebarRowContent: ViewModifier {
    static let padding: CGFloat = 20
    let enabled: Bool
    @ViewBuilder func body(content: Content) -> some View {
        if enabled {
            content.listRowInsets(.trailing, Self.padding + (UIDevice.current.userInterfaceIdiom == .phone ? SidebarContentInsets.trailing : 0))
        } else { content }
    }
}
