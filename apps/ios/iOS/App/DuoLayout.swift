import SwiftUI
import UIKit

/// How much of a two-page window the list takes: about 300 points, half the
/// window (its edge on the crease), or none, so the detail fills the window
/// beside the rail.
enum DuoPane: String, CaseIterable {
    case hidden, narrow, even
}

/// The list pane's width, remembered on this device. A drag sets `dragWidth`
/// for its preview until it ends and snaps to a `DuoPane`.
///
/// The width changes once, on release, without animating: a transcript
/// relaid out at every frame of a drag or animation lost its place, as it
/// would through many folds in a row. One change is one fold's worth, which
/// its resize anchor keeps.
@MainActor @Observable
final class DuoPaneState {
    static let shared = DuoPaneState()
    static let key = "duoListPane"
    static let lastKey = "duoListPaneShown"

    var pane: DuoPane {
        didSet {
            UserDefaults.standard.set(pane.rawValue, forKey: Self.key)
            if pane != .hidden {
                lastShown = pane
                UserDefaults.standard.set(pane.rawValue, forKey: Self.lastKey)
            }
        }
    }
    /// The list width under the finger, while the divider or edge is dragged.
    var dragWidth: CGFloat?
    private var lastShown: DuoPane

    private init() {
        let defaults = UserDefaults.standard
        pane = defaults.string(forKey: Self.key).flatMap(DuoPane.init) ?? .even
        lastShown = defaults.string(forKey: Self.lastKey).flatMap(DuoPane.init).flatMap { $0 == .hidden ? nil : $0 } ?? .even
    }

    /// The header button: hide the list, or bring back the width it had.
    func toggle() {
        pane = pane == .hidden ? lastShown : .hidden
    }

    func set(_ next: DuoPane) {
        dragWidth = nil
        pane = next
    }

    /// Ends a drag at the snap point nearest where it was flung.
    func settle(at width: CGFloat, layout: DuoLayout) {
        set(layout.snap(width))
    }
}

/// Window geometry, independent of device model, size class and keyboard height.
struct DuoLayout: Equatable {
    static let gutter: CGFloat = 32
    static let narrowList: CGFloat = 300
    let windowSize: CGSize
    let leadingInset: CGFloat
    let twoPages: Bool
    let railWidth: CGFloat
    /// The list's width at each snap point; `listWidth` is the current one.
    let evenWidth: CGFloat
    let narrowWidth: CGFloat
    let listWidth: CGFloat
    let pane: DuoPane
    /// Where a drag of the divider or the detail's edge would put the
    /// list's edge, for its preview; the list itself keeps `listWidth`.
    let dragTarget: CGFloat?
    let sidebarWindowInset: CGFloat
    /// The Duo's status bar: a column on the trailing edge, with no leading
    /// inset to match (a landscape iPhone's insets are on both sides).
    let statusColumn: CGFloat

    init(size: CGSize, leadingInset: CGFloat = 0, trailingInset: CGFloat = 0, pane: DuoPane = .even, dragWidth: CGFloat? = nil) {
        windowSize = size
        self.leadingInset = leadingInset
        twoPages = size.width >= 900 && size.width > size.height
        railWidth = twoPages ? 64 : 0
        sidebarWindowInset = twoPages ? trailingInset : 0
        statusColumn = twoPages && leadingInset == 0 ? trailingInset : 0
        // Half the gutter on either side of the window midpoint, even with
        // asymmetric safe areas, so the divider sits on the crease.
        evenWidth = twoPages ? max(0, size.width / 2 - leadingInset - 64 - Self.gutter / 2) : 0
        narrowWidth = min(Self.narrowList, evenWidth)
        self.pane = pane
        let width: CGFloat = switch pane {
        case .hidden: 0
        case .narrow: narrowWidth
        case .even: evenWidth
        }
        // A little give past the even width, so the drag doesn't stop dead.
        let limit = evenWidth + 24
        dragTarget = twoPages ? dragWidth.map { min(max(0, $0), limit) } : nil
        listWidth = twoPages ? width : 0
    }

    /// The list is on screen, at some width.
    var showsList: Bool { listWidth > 0 }
    /// The detail page, from the divider (or the rail) to the window's edge.
    /// The status column is part of it; only a leading inset is not.
    var detailWidth: CGFloat { twoPages ? max(0, windowSize.width - leadingInset - railWidth - listWidth - gutterWidth) : windowSize.width }

    /// The divider between the list and the detail; none with the list hidden.
    var gutterWidth: CGFloat { twoPages && showsList ? Self.gutter : 0 }

    func width(of pane: DuoPane) -> CGFloat {
        switch pane {
        case .hidden: 0
        case .narrow: narrowWidth
        case .even: evenWidth
        }
    }

    /// The snap point nearest a list width.
    func snap(_ width: CGFloat) -> DuoPane {
        DuoPane.allCases.min { abs(self.width(of: $0) - width) < abs(self.width(of: $1) - width) } ?? .even
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
            // The detail's header hides and shows the list beside it.
            if !sidebar { DuoPaneToggle() }
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

/// Hides the list so the detail fills the window beside the rail, and brings
/// it back at the width it had.
struct DuoPaneToggle: View {
    @Environment(\.duoLayout) private var layout
    @Environment(DuoPaneState.self) private var pane: DuoPaneState?

    var body: some View {
        if layout.twoPages, let pane {
            Button { pane.toggle() } label: {
                Image(systemName: "sidebar.left").frame(minWidth: 44, minHeight: 44)
            }
            .accessibilityLabel(layout.showsList ? "Hide list" : "Show list")
            .accessibilityIdentifier("duoPaneToggle")
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

/// Scroll views draw under the system status column, but keep their content
/// clear of it: the Duo's clock, battery and Now Playing float there, over
/// whatever scrolls under them. Their surrounding safe-area insets still
/// position fixed chrome and preserve the native bottom content inset for the
/// home indicator and composer.
///
/// Content held to `readableWidth` and centred only moves as far as it must:
/// on a wide page, the room beside it already clears part of the column.
struct RegularScrollingSurface: ViewModifier {
    var readableWidth: CGFloat? = nil
    @Environment(\.duoLayout) private var layout

    func body(content: Content) -> some View {
        // The page's width comes from the layout, not a measurement: a
        // measured width fed back into the inset never settled.
        content
            .safeAreaPadding(.trailing, Self.inset(column: layout.statusColumn, width: layout.detailWidth, readableWidth: readableWidth))
            .ignoresSafeArea(.container, edges: layout.twoPages ? .trailing : [])
    }

    /// Centred content `readableWidth` wide leaves (width - readableWidth) / 2
    /// on each side; it needs only the rest of the column as an inset.
    static func inset(column: CGFloat, width: CGFloat, readableWidth: CGFloat?) -> CGFloat {
        guard column > 0 else { return 0 }
        guard let readableWidth, width > readableWidth else { return column }
        return max(0, column - (width - readableWidth) / 2)
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
            // The detail page runs to the window's edge at any list width.
            let extendsRight = fullWidth || rightPage
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
///
/// Narrower than its narrow snap point, while dragged shut, the list keeps
/// that width and slides out under the rail rather than squeezing its rows.
struct SidebarColumn: ViewModifier {
    @Environment(\.duoLayout) private var layout
    func body(content: Content) -> some View {
        content
            .ignoresSafeArea(.container, edges: .trailing)
            .frame(width: max(layout.listWidth, layout.narrowWidth))
            .frame(width: layout.listWidth, alignment: .trailing)
            .clipShape(HorizontalClip())
            .allowsHitTesting(layout.showsList)
    }
}

private struct HorizontalClip: Shape {
    func path(in rect: CGRect) -> Path {
        Path(rect.insetBy(dx: 0, dy: -10_000))
    }
}

/// The divider between the list and the detail: sidebar-coloured, with a
/// hairline that runs the full window height rather than stopping at the home
/// indicator. At the even width it sits on the crease. Its grab handle drags
/// the list between its snap points (narrow, even and hidden) through a
/// 44-point hit area.
struct CreaseGutter: View {
    @Environment(\.duoLayout) private var layout
    @Environment(DuoPaneState.self) private var pane: DuoPaneState?
    @State private var start: CGFloat?

    var body: some View {
        Color.clear
            .frame(width: layout.gutterWidth)
            .background {
                if layout.gutterWidth > 0 {
                    RegularSurfaceBackground(name: "crease", style: AnyShapeStyle(Color(uiColor: .systemGroupedBackground)))
                }
            }
            .overlay {
                if layout.gutterWidth > 0 {
                    RegularSurfaceBackground(name: "creaseLine", style: AnyShapeStyle(Color(uiColor: .separator))).frame(width: 1)
                }
            }
            .overlay {
                if layout.gutterWidth > 0, let pane {
                    handle(pane)
                }
            }
            .overlay {
                // Where the divider will land, under the finger.
                if layout.gutterWidth > 0, let target = layout.dragTarget {
                    DuoPanePreview().offset(x: target - layout.listWidth)
                }
            }
            // Its hit area reaches past the gutter, over the detail's edge.
            .zIndex(1)
    }

    private func handle(_ pane: DuoPaneState) -> some View {
        Capsule()
            .fill(Color(uiColor: .tertiaryLabel))
            .frame(width: 5, height: 44)
            .frame(width: 44)
            .frame(maxHeight: .infinity)
            .contentShape(.rect)
            .gesture(DragGesture(minimumDistance: 2, coordinateSpace: .global)
                .onChanged { drag in
                    let origin = start ?? layout.listWidth
                    start = origin
                    pane.dragWidth = origin + drag.translation.width
                }
                .onEnded { drag in
                    let origin = start ?? layout.listWidth
                    start = nil
                    pane.settle(at: origin + drag.predictedEndTranslation.width, layout: layout)
                })
            .accessibilityElement()
            .accessibilityLabel("List width")
            .accessibilityValue(layout.pane == .narrow ? "Narrow" : "Half")
            .accessibilityHint("Drag to resize the list")
            .accessibilityIdentifier("duoPaneDivider")
            .accessibilityAdjustableAction { direction in
                switch direction {
                case .increment: pane.set(.even)
                case .decrement: pane.set(layout.pane == .even ? .narrow : .hidden)
                @unknown default: break
                }
            }
    }
}

/// With the list hidden, a swipe in from the detail's leading edge pulls it
/// back, following the finger and snapping where it's let go.
struct DuoPaneEdge: View {
    @Environment(\.duoLayout) private var layout
    @Environment(DuoPaneState.self) private var pane: DuoPaneState?

    var body: some View {
        if layout.twoPages, !layout.showsList, let pane {
            Color.clear
                .frame(width: 20)
                .frame(maxHeight: .infinity)
                .contentShape(.rect)
                .gesture(DragGesture(minimumDistance: 8, coordinateSpace: .global)
                    .onChanged { pane.dragWidth = $0.translation.width }
                    .onEnded { drag in
                        // A swipe shows the list; a short drag, let go, doesn't.
                        let width = drag.translation.width
                        pane.settle(at: width > layout.narrowWidth / 2 ? max(width, layout.narrowWidth) : 0, layout: layout)
                    })
                .overlay(alignment: .leading) {
                    // The divider's centre, where the list's edge would be.
                    if let target = layout.dragTarget {
                        DuoPanePreview().frame(width: 0).offset(x: target + Self.halfGutter)
                    }
                }
                .accessibilityHidden(true)
        }
    }

    private static let halfGutter = DuoLayout.gutter / 2
}

/// A drag's preview: an accent line, the height of the window, with the grab
/// handle on it.
private struct DuoPanePreview: View {
    var body: some View {
        ZStack {
            Rectangle().fill(Color.accentColor.opacity(0.6)).frame(width: 2)
            Capsule().fill(Color.accentColor).frame(width: 5, height: 44)
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }
}
