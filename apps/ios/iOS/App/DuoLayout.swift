import SwiftUI
import UIKit

/// Window geometry, independent of device model, size class and keyboard height.
struct DuoLayout: Equatable {
    static let gutter: CGFloat = 32
    let twoPages: Bool
    let railWidth: CGFloat
    let listWidth: CGFloat
    let sidebarWindowInset: CGFloat

    init(size: CGSize, leadingInset: CGFloat = 0, trailingInset: CGFloat = 0) {
        twoPages = size.width >= 900 && size.width > size.height
        railWidth = twoPages ? 64 : 0
        sidebarWindowInset = twoPages ? trailingInset : 0
        // Half the gutter on either side of the window midpoint, even with
        // asymmetric safe areas. No control occupies the crease.
        listWidth = twoPages ? max(0, size.width / 2 - leadingInset - 64 - Self.gutter / 2) : 0
    }
}

private struct DuoLayoutKey: EnvironmentKey {
    static let defaultValue = DuoLayout(size: .zero)
}

extension EnvironmentValues {
    var duoLayout: DuoLayout {
        get { self[DuoLayoutKey.self] }
        set { self[DuoLayoutKey.self] = newValue }
    }
}

struct DuoTabRail: View {
    @Binding var selection: Tab

    var body: some View {
        VStack(spacing: 12) {
            tab(.bot, "Bot", "face.smiling")
            tab(.inbox, "Threads", "bubble.left.and.bubble.right")
            tab(.studio, "Studio", "square.stack")
            Spacer()
            tab(.settings, "Settings", "gear")
        }
        .padding(.vertical, 12)
        .frame(width: 64)
        .background(.bar)
    }

    private func tab(_ value: Tab, _ title: String, _ icon: String) -> some View {
        Button { selection = value } label: {
            VStack(spacing: 4) {
                Image(systemName: icon).font(.title3)
                Text(title).font(.caption2)
            }
            .frame(width: 60, height: 52)
            .background(selection == value ? Color.accentColor.opacity(0.15) : .clear, in: .rect(cornerRadius: 8))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityAddTraits(selection == value ? .isSelected : [])
    }
}

/// Observes the window rather than the keyboard-reduced SwiftUI proposal. It
/// does not alter safe areas, keyboard avoidance or the transcript hierarchy.
struct WindowGeometry: UIViewRepresentable {
    var changed: (CGSize, CGFloat, CGFloat) -> Void

    func makeUIView(context: Context) -> Probe { Probe(changed: changed) }
    func updateUIView(_ view: Probe, context: Context) { view.changed = changed }

    final class Probe: UIView {
        var changed: (CGSize, CGFloat, CGFloat) -> Void
        private var lastSize = CGSize.zero
        private var lastLeading: CGFloat = -1
        private var lastTrailing: CGFloat = -1

        init(changed: @escaping (CGSize, CGFloat, CGFloat) -> Void) {
            self.changed = changed
            super.init(frame: .zero)
            isUserInteractionEnabled = false
        }
        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

        override func layoutSubviews() {
            super.layoutSubviews()
            report()
        }
        override func didMoveToWindow() {
            super.didMoveToWindow()
            #if DEBUG
            if let window { DuoDemo.configure(window) }
            #endif
            report()
        }
        private func report() {
            guard let window else { return }
            let size = window.bounds.size
            let leading = window.safeAreaInsets.left
            let trailing = window.safeAreaInsets.right
            guard size != lastSize || leading != lastLeading || trailing != lastTrailing else { return }
            lastSize = size
            lastLeading = leading
            lastTrailing = trailing
            // SwiftUI's environment alone does not change UIKit navigation
            // chrome on a phone. Give its hosting hierarchy the same regular
            // trait used by the shared iPad layout, without changing idiom.
            window.rootViewController?.traitOverrides.horizontalSizeClass =
                DuoLayout(size: size).twoPages ? .regular : .unspecified
            DispatchQueue.main.async { [weak self] in self?.changed(size, leading, trailing) }
        }
    }
}

/// Expanded phone windows use an in-page header, rather than iOS's compact
/// floating navigation controls. Narrow windows keep their native bars.
struct DuoHeader<Title: View, Actions: View>: View {
    @ViewBuilder var title: Title
    @ViewBuilder var actions: Actions

    var body: some View {
        HStack(spacing: 12) {
            title.fixedSize(horizontal: true, vertical: false)
            Spacer(minLength: 8)
            HStack(spacing: 12) { actions }.fixedSize(horizontal: true, vertical: false)
        }
        .buttonStyle(.borderless)
        .padding(.horizontal, 16)
        .frame(minHeight: 58)
        .background(.bar)
    }
}

private struct DuoBotActionsKey: EnvironmentKey {
    static let defaultValue: AnyView? = nil
}

extension EnvironmentValues {
    var duoBotActions: AnyView? {
        get { self[DuoBotActionsKey.self] }
        set { self[DuoBotActionsKey.self] = newValue }
    }
}

struct DuoSearch: ViewModifier {
    @Binding var query: String
    let unfolded: Bool
    let prompt: String

    @ViewBuilder func body(content: Content) -> some View {
        if unfolded { content }
        else { content.searchable(text: $query, prompt: Text(prompt)) }
    }
}

/// Shared by the regular sidebar's list and search header. The phone uses the
/// entire left page up to the crease gutter; iPad keeps its normal end inset.
@MainActor
enum SidebarContentInsets {
    static let leading: CGFloat = 16
    static var trailing: CGFloat { UIDevice.current.userInterfaceIdiom == .phone ? 0 : 16 }
}

struct SidebarListMargins: ViewModifier {
    let enabled: Bool
    @ViewBuilder func body(content: Content) -> some View {
        if enabled {
            content
                .contentMargins(.leading, SidebarContentInsets.leading, for: .scrollContent)
                .contentMargins(.trailing, SidebarContentInsets.trailing, for: .scrollContent)
        } else { content }
    }
}

struct SidebarSearchField: View {
    let prompt: String
    @Binding var text: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                .accessibilityHidden(true)
            TextField(prompt, text: $text)
                .textFieldStyle(.plain)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityIdentifier("sidebarSearchInput")
            if !text.isEmpty {
                Button { text = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.leading, 12)
        .padding(.trailing, text.isEmpty ? 12 : 0)
        .frame(minHeight: 44)
        .background(Color(uiColor: .tertiarySystemFill), in: .rect(cornerRadius: 10))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("sidebarSearchField")
        .padding(.leading, SidebarContentInsets.leading)
        .padding(.trailing, SidebarContentInsets.trailing)
        .padding(.bottom, 12)
    }
}

/// List row backgrounds are hosted separately from their cells. They need
/// the same trailing safe-area treatment as the regular sidebar itself.
struct SidebarSelectionBackground: View {
    let selected: Bool
    var body: some View {
        (selected ? Color.accentColor.opacity(0.15) : .clear)
            .ignoresSafeArea(.container, edges: .trailing)
    }
}

/// A phone list's automatic row inset includes the window's trailing safe
/// area even inside the left page. Subtract that measured window inset to
/// retain the normal 20pt interior padding inside the expanded card.
/// iPad retains its existing automatic row insets.
struct SidebarRowContent: ViewModifier {
    @Environment(\.duoLayout) private var layout
    let enabled: Bool
    @ViewBuilder func body(content: Content) -> some View {
        if enabled && UIDevice.current.userInterfaceIdiom == .phone {
            content.listRowInsets(.trailing, 20 - layout.sidebarWindowInset)
        } else { content }
    }
}
