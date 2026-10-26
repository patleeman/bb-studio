import SwiftUI
import UIKit

/// Window geometry, independent of device model, size class and keyboard height.
struct DuoLayout: Equatable {
    static let gutter: CGFloat = 32
    let windowSize: CGSize
    let twoPages: Bool
    let railWidth: CGFloat
    let listWidth: CGFloat
    let sidebarWindowInset: CGFloat
    /// The Duo's status bar: a column on the trailing edge, with no leading
    /// inset to match (a landscape iPhone's insets are on both sides).
    let statusColumn: CGFloat
    /// How far down the window the status column's clock and icons reach,
    /// from the inner screen: the system reports the column's width only.
    static let statusClusterHeight: CGFloat = 104

    init(size: CGSize, leadingInset: CGFloat = 0, trailingInset: CGFloat = 0) {
        windowSize = size
        twoPages = size.width >= 900 && size.width > size.height
        railWidth = twoPages ? 64 : 0
        sidebarWindowInset = twoPages ? trailingInset : 0
        statusColumn = twoPages && leadingInset == 0 ? trailingInset : 0
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
    /// Sidebar headers share the sidebar's surface, as on desktop and iPad,
    /// instead of a separate bar band above the list.
    var sidebar = false
    @ViewBuilder var title: Title
    @ViewBuilder var actions: Actions

    var body: some View {
        HStack(spacing: 12) {
            // The title takes the room the actions leave and truncates there.
            // Never fixedSize: an inset this wide widens the whole page under it.
            title.lineLimit(1).layoutPriority(1)
            Spacer(minLength: 8)
            HStack(spacing: 12) { actions }.fixedSize(horizontal: true, vertical: false)
        }
        .buttonStyle(.borderless)
        .padding(.horizontal, 16)
        .frame(minHeight: 58)
        .background {
            if sidebar {
                RegularSurfaceBackground(name: "sidebarHeader", style: AnyShapeStyle(Color(uiColor: .systemGroupedBackground)), bottom: false)
            } else {
                RegularSurfaceBackground(name: "header", style: AnyShapeStyle(.bar), bottom: false, rightPage: true)
            }
        }
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
/// entire left page, with matching margins inside the crease gutter.
@MainActor
enum SidebarContentInsets {
    static let leading: CGFloat = 16
    static let trailing = leading
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
        // A whole rounded highlight, like the desktop sidebar's, rather than a
        // cell fill that the section clips to rounded top corners only.
        RoundedRectangle(cornerRadius: 12, style: .continuous)
            .fill(selected ? Color.accentColor.opacity(0.15) : .clear)
            .padding(.vertical, 2)
            .ignoresSafeArea(.container, edges: .trailing)
    }
}

/// Rows keep the same 20-point interior padding on both sides of their card,
/// as on the leading edge. A phone list's row inset includes the window's
/// trailing safe area even inside the left page, less the sidebar's trailing
/// content margin. The iPad's automatic inset is 16 points, so set it too.
struct SidebarRowContent: ViewModifier {
    static let padding: CGFloat = 20
    @Environment(\.duoLayout) private var layout
    let enabled: Bool
    @ViewBuilder func body(content: Content) -> some View {
        if enabled && UIDevice.current.userInterfaceIdiom == .phone {
            content.listRowInsets(.trailing, Self.padding - layout.sidebarWindowInset + SidebarContentInsets.trailing)
        } else if enabled {
            content.listRowInsets(.trailing, Self.padding)
        } else { content }
    }
}

/// Scroll views may draw and lay out content under the system status column.
/// Their surrounding safe-area insets still position fixed chrome and preserve
/// the native bottom content inset for the home indicator and composer.
struct RegularScrollingSurface: ViewModifier {
    @Environment(\.duoLayout) private var layout
    func body(content: Content) -> some View {
        content.ignoresSafeArea(.container, edges: layout.twoPages ? .trailing : [])
    }
}

/// Content runs under the status column (`RegularScrollingSurface`), but not
/// under its clock and icons: the page's own surface covers that corner,
/// fading out below it, as the header bar covers the rows above.
struct StatusCorner: View {
    @Environment(\.duoLayout) private var layout
    static let fade: CGFloat = 16

    var body: some View {
        if layout.statusColumn > 0 {
            let surface = Color(uiColor: .systemBackground)
            VStack(spacing: 0) {
                surface.frame(height: DuoLayout.statusClusterHeight)
                LinearGradient(colors: [surface, surface.opacity(0)], startPoint: .top, endPoint: .bottom)
                    .frame(height: Self.fade)
            }
            .frame(width: layout.statusColumn)
            .modifier(RegularSurfaceProbe(name: "statusCorner"))
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
            .ignoresSafeArea(.container, edges: [.top, .trailing])
        }
    }
}

/// Paint the complete page independently of the safe bounds used by controls.
struct RegularSurfaceBackground: View {
    @Environment(\.duoLayout) private var layout
    let name: String
    var style = AnyShapeStyle(Color(uiColor: .systemBackground))
    var bottom = true
    var rightPage = false
    var fullWidth = false

    var body: some View {
        GeometryReader { geometry in
            let origin = geometry.frame(in: .global).origin
            let extendsRight = fullWidth || (rightPage && origin.x >= layout.windowSize.width / 2)
            Rectangle().fill(style)
                .frame(width: extendsRight ? max(0, layout.windowSize.width - origin.x) : geometry.size.width,
                       height: bottom ? max(0, layout.windowSize.height - origin.y) : geometry.size.height,
                       alignment: .topLeading)
                .allowsHitTesting(false)
                .modifier(RegularSurfaceProbe(name: name))
        }
        // Surfaces at the top of the window also fill an iPad's status bar.
        .ignoresSafeArea(.container, edges: bottom ? [.top, .bottom] : .top)
    }
}

private struct RegularSurfaceProbe: ViewModifier {
    let name: String
    func body(content: Content) -> some View {
        #if DEBUG
        content.onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { rect in
            DuoDemo.surfaces[name + "-" + String(Int(rect.minX.rounded()))] = rect
        }
        #else
        content
        #endif
    }
}

/// A sidebar column on the left page. UIKit already extends its list through
/// the home-indicator area and insets the last row; only the horizontal edges
/// are clipped, so rows keep drawing to the window's bottom edge.
struct SidebarColumn: ViewModifier {
    @Environment(\.duoLayout) private var layout
    func body(content: Content) -> some View {
        content
            .ignoresSafeArea(.container, edges: .trailing)
            .frame(width: layout.listWidth)
            .clipShape(HorizontalClip())
    }
}

private struct HorizontalClip: Shape {
    func path(in rect: CGRect) -> Path {
        Path(rect.insetBy(dx: 0, dy: -10_000))
    }
}

/// The crease between the pages: sidebar-coloured, with a hairline that runs
/// the full window height rather than stopping at the home indicator.
struct CreaseGutter: View {
    @Environment(\.duoLayout) private var layout
    var body: some View {
        Color.clear
            .frame(width: layout.twoPages ? DuoLayout.gutter : 0)
            .background {
                if layout.twoPages {
                    RegularSurfaceBackground(name: "crease", style: AnyShapeStyle(Color(uiColor: .systemGroupedBackground)))
                }
            }
            .overlay {
                if layout.twoPages {
                    RegularSurfaceBackground(name: "creaseLine", style: AnyShapeStyle(Color(uiColor: .separator))).frame(width: 1)
                }
            }
            .accessibilityHidden(true)
    }
}
