import SwiftUI

/// What the rail's buttons do on one screen. Tabs and More are menus; the
/// rest are buttons.
struct RailActions {
    var tap: (RailSlot) -> Void = { _ in }
    /// The Workbench's tab menu, for Tabs.
    var tabs: AnyView?
    /// The conversation's menu, for More.
    var more: AnyView?
}

/// The Duo's controls (9c–9f): in the 84 pt column the system already
/// reserves at the right edge, small line icons with a word under each,
/// packed at the bottom (the first slot lowest, under the thumb). The
/// system's time and battery keep the column's top. Above the keyboard
/// when it is up.
struct ShellRail: View {
    let slots: [RailSlot]
    let actions: RailActions
    var large = false

    var body: some View {
        VStack(spacing: 4) {
            Spacer(minLength: 0)
            ForEach(slots.reversed()) { slot in
                button(slot)
            }
        }
        .padding(.bottom, 16)
        .frame(width: ShellPosture.railWidth)
        .frame(maxHeight: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("shellRail")
    }

    @ViewBuilder private func button(_ slot: RailSlot) -> some View {
        switch slot {
        case .tabs where actions.tabs != nil:
            Menu { actions.tabs } label: { RailLabel(slot: slot, large: large) }
                .menuOrder(.fixed)
                .tint(.primary)
                .accessibilityIdentifier("rail-\(slot.id)")
        case .more where actions.more != nil:
            Menu { actions.more } label: { RailLabel(slot: slot, large: large) }
                .menuOrder(.fixed)
                .tint(.primary)
                .accessibilityIdentifier("rail-\(slot.id)")
        case .action(let action) where !action.children.isEmpty:
            Menu { ScreenActionItems(actions: action.children) } label: { RailLabel(slot: slot, large: large) }
                .menuOrder(.fixed)
                .tint(.primary)
                .disabled(action.disabled)
                .accessibilityIdentifier("rail-\(slot.id)")
        case .action(let action):
            Button { action.run() } label: { RailLabel(slot: slot, large: large) }
                .buttonStyle(.plain)
                .disabled(action.disabled)
                .accessibilityIdentifier("rail-\(slot.id)")
        default:
            Button { actions.tap(slot) } label: { RailLabel(slot: slot, large: large) }
                .buttonStyle(.plain)
                .accessibilityIdentifier("rail-\(slot.id)")
        }
    }
}

private struct RailLabel: View {
    let slot: RailSlot
    let large: Bool

    var body: some View {
        VStack(spacing: 2) {
            Image(systemName: slot.symbol)
                .font(.system(size: large ? 22 : 20, weight: .regular))
                .frame(height: 26)
                .overlay(alignment: .topTrailing) {
                    if case .workbench(let tabs) = slot, tabs > 0 { RailCount(count: tabs) }
                }
            Text(slot.title)
                .font(.system(size: large ? 12 : 11))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .foregroundStyle(.primary)
        .frame(width: large ? 66 : 64, height: large ? 58 : 56)
        .background(slot.lit ? AnyShapeStyle(.fill.secondary) : AnyShapeStyle(.clear), in: .rect(cornerRadius: 12))
        .contentShape(.rect(cornerRadius: 12))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityAddTraits(slot.lit ? .isSelected : [])
    }

    private var label: String {
        if case .workbench(let tabs) = slot { return tabs == 1 ? "Workbench, 1 tab" : "Workbench, \(tabs) tabs" }
        if case .home(true) = slot { return "Home, shown" }
        return slot.title
    }
}

/// The Workbench's tab count, on its button (the rail's and the iPhone bar's).
struct RailCount: View {
    let count: Int
    @Environment(\.look) private var look

    var body: some View {
        Text(count > 99 ? "99+" : "\(count)")
            .font(.system(size: 10, weight: .bold)).monospacedDigit()
            .foregroundStyle(look.canvas)
            .padding(.horizontal, 3)
            .frame(minWidth: 15, minHeight: 15)
            .background(look.accent, in: .capsule)
            .fixedSize()
            .offset(x: 9, y: -5)
            .accessibilityHidden(true)
    }
}

/// The Duo's top (9c–9f): one title line, no buttons. A Workbench's title
/// is its tab, which opens the tab menu.
struct ShellTitleLine<Menu: View>: View {
    let title: String
    var subtitle: String?
    var posture: ShellPosture
    @ViewBuilder var menu: Menu
    @Environment(\.look) private var look

    var body: some View {
        Group {
            if Menu.self == EmptyView.self {
                label
            } else {
                SwiftUI.Menu { menu } label: { label }
                    .menuOrder(.fixed)
                    .tint(.primary)
                    .accessibilityHint("Shows the tabs")
            }
        }
        .padding(.horizontal, posture.largeType ? 32 : 18)
        .frame(height: posture.titleLine)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(look.showsScene ? AnyShapeStyle(look.canvas) : AnyShapeStyle(.background))
        .overlay(alignment: .bottom) { Divider().opacity(0.6) }
        .zIndex(1)
        .accessibilityIdentifier("shellTitle")
    }

    private var label: some View {
        HStack(spacing: 5) {
            Text(title).font(posture.largeType ? .title3.weight(.semibold) : .headline).lineLimit(1)
            if Menu.self != EmptyView.self {
                Image(systemName: "chevron.down").font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
            }
            if let subtitle {
                Text("· " + subtitle).font(posture.largeType ? .body : .subheadline).foregroundStyle(.secondary).lineLimit(1)
                    .layoutPriority(-1)
            }
            Spacer(minLength: 0)
        }
        .foregroundStyle(.primary)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

extension ShellTitleLine where Menu == EmptyView {
    init(title: String, subtitle: String? = nil, posture: ShellPosture) {
        self.init(title: title, subtitle: subtitle, posture: posture) { EmptyView() }
    }
}

/// A screen with the rail at its right edge. Where the system reserves a
/// column there (the Duo's status column), the rail fills that column and
/// the content keeps its width; elsewhere the content gives up 84 pt.
struct RailFrame: ViewModifier {
    let slots: [RailSlot]
    let actions: RailActions
    var large = false
    /// From the window (UIKit), not measured here: the rail's own padding would change a measured inset.
    @Environment(\.shellReservedColumn) private var reserved

    func body(content: Content) -> some View {
        content
            .safeAreaPadding(.trailing, max(0, ShellPosture.railWidth - reserved))
            .overlay(alignment: .trailing) {
                ShellRail(slots: slots, actions: actions, large: large)
                    .frame(width: max(ShellPosture.railWidth, reserved))
                    .frame(maxHeight: .infinity)
                    .overlay(alignment: .leading) { Rectangle().fill(.separator).frame(width: 0.5) }
                    // Into the reserved column, past the content's safe edge.
                    .offset(x: reserved)
                    .ignoresSafeArea(.container, edges: [.top, .bottom])
            }
    }
}

extension View {
    func rail(_ slots: [RailSlot], actions: RailActions, large: Bool = false) -> some View {
        modifier(RailFrame(slots: slots, actions: actions, large: large))
    }
}
