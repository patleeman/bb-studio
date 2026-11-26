import SwiftUI

/// The unfolded Duo on its side: two pages, the hinge between them. Upright
/// (the hinge across, one screen above the other) it is one tall phone: the
/// phone's single column, never a page split by the hinge.
enum DuoPages: Equatable {
    case sideBySide

    static let hinge: CGFloat = 32

    init?(window size: CGSize, phone: Bool) {
        guard phone, size.width >= 900, size.height >= 600, size.width > size.height else { return nil }
        self = .sideBySide
    }
}

struct RoomCanvas<First: View, Second: View>: View {
    let pages: DuoPages
    let layout: DuoLayout
    @ViewBuilder var first: First
    @ViewBuilder var second: Second

    var body: some View {
        GeometryReader { proxy in
            let size = firstPage(proxy)
            HStack(spacing: 0) {
                first
                    .frame(width: size)
                    .environment(\.duoLayout, DuoLayout(size: pageSize(size), innerScreen: layout.innerScreen))
                    .environment(\.horizontalSizeClass, .compact)
                    .environment(\.duoPage, true)
                Color.clear
                    .frame(width: DuoPages.hinge)
                    .accessibilityHidden(true)
                second
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .environment(\.duoLayout, DuoLayout(size: .zero, innerScreen: layout.innerScreen))
                    .environment(\.horizontalSizeClass, .compact)
            }
        }
    }

    private func firstPage(_ proxy: GeometryProxy) -> CGFloat {
        max(0, layout.windowSize.width / 2 - DuoPages.hinge / 2 - proxy.safeAreaInsets.leading)
    }

    private func pageSize(_ first: CGFloat) -> CGSize {
        CGSize(width: first, height: layout.windowSize.height)
    }
}

struct RoomDetail {
    var id: String
    var view: AnyView
}

extension EnvironmentValues {
    @Entry var showDetail: ((RoomDetail) -> Void)?
    @Entry var shownDetail: String?
}

struct RoomSpread: View {
    enum Content: Equatable {
        case place(RoomPlace)
        case settings
    }

    let content: Content
    let pages: DuoPages
    let layout: DuoLayout
    let bot: BotSpace
    @ObservedObject var store: BotSpacesStore
    let mainThreadId: String
    var open: (BotShellItem) -> Void
    var close: () -> Void
    var chooseTheme: (String) -> Void
    @State private var detail: [Route] = []
    @State private var item: RoomDetail?
    @Environment(\.look) private var look

    var body: some View {
        if content == .settings {
            settings
        } else {
            spread
        }
    }

    private var settings: some View {
        SettingsTab()
            .safeAreaInset(edge: .top, spacing: 0) {
                HStack {
                    Button(action: close) {
                        Label("Back to the room", systemImage: "chevron.backward").font(.body.weight(.medium))
                            .frame(minHeight: 44).contentShape(.rect)
                    }
                    .accessibilityIdentifier("roomSpreadBack")
                    Spacer()
                }
                .padding(.horizontal, 16)
                .background(look.canvas.ignoresSafeArea())
            }
            .background(look.canvas.ignoresSafeArea())
            .tint(look.accent)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("RoomSpread")
    }

    private var spread: some View {
        RoomCanvas(pages: pages, layout: layout) {
            list
        } second: {
            detailPage
        }
        .background {
            Color.black.opacity(0.52)
                .ignoresSafeArea()
        }
        .tint(look.accent)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("RoomSpread")
    }

    @ViewBuilder private var list: some View {
        switch content {
        case .place(let place):
            RoomPlaceSheet(place: place, bot: bot, store: store, mainThreadId: mainThreadId, open: open,
                           startedConversation: { open(.conversation($0)) }, closeToRoom: close,
                           theme: look.theme.id, chooseTheme: chooseTheme,
                           path: Binding(get: { [] }, set: { routes in if !routes.isEmpty { item = nil; detail = routes } }),
                           back: close)
                .environment(\.workbenchPane, true)
                .environment(\.showDetail, { next in detail = []; item = next })
                .environment(\.shownDetail, item?.id)
                .scrollContentBackground(.hidden)
        case .settings:
            EmptyView()
        }
    }

    @ViewBuilder private var detailPage: some View {
        if let item {
            NavigationStack {
                item.view
                    .containerBackground(.clear, for: .navigation)
                    .navigationDestination(for: Route.self) { RouteDestination(route: $0) }
            }
            .id(item.id)
            .accessibilityIdentifier("roomSpreadDetail")
        } else if let first = detail.first {
            NavigationStack(path: Binding(get: { Array(detail.dropFirst()) }, set: { detail = [first] + $0 })) {
                RouteDestination(route: first)
                    .containerBackground(.clear, for: .navigation)
                    .navigationDestination(for: Route.self) { RouteDestination(route: $0) }
            }
            .id(first)
            .accessibilityIdentifier("roomSpreadDetail")
        } else {
            Text(placeholder)
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.45))
                .multilineTextAlignment(.center)
                .padding(32)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityIdentifier("roomSpreadEmpty")
        }
    }

    private var placeholder: String {
        switch content {
        case .settings: return ""
        case .place(let place):
            switch place {
            case .strands: return "Pick a strand to open its conversation"
            case .memory: return ""
            case .library: return "Pick something to open it here"
            case .conversations: return "Pick a conversation to open it"
            case .schedules: return "Pick a schedule to see it here"
            case .archive: return "Pick something from the archive"
            case .theme: return ""
            }
        }
    }
}

extension EnvironmentValues {
    @Entry var spreadInline = false
}

struct RoomSpreadHeader: View {
    let title: String
    var back: () -> Void

    var body: some View {
        HStack(spacing: 4) {
            Button(action: back) {
                Image(systemName: "chevron.backward").font(.title3.weight(.medium))
                    .frame(width: 44, height: 44)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .accessibilityLabel("Back to the room")
            .accessibilityIdentifier("roomSpreadBack")
            Text(title).font(.title2.bold()).lineLimit(1)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 0)
        }
        .padding(.leading, 8)
        .padding(.trailing, 16)
        .padding(.top, 10)
        .padding(.bottom, 6)
    }
}

struct RoomSearchField: View {
    @Binding var text: String
    let prompt: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
            TextField(prompt, text: $text)
                .submitLabel(.search)
                .autocorrectionDisabled()
            if !text.isEmpty {
                Button { text = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 40)
        .background(.white.opacity(0.07), in: .rect(cornerRadius: 12))
        .accessibilityIdentifier("roomSpreadSearch")
    }
}

struct PageChrome<Actions: View>: ViewModifier {
    let title: String
    var query: Binding<String>?
    var prompt = "Search"
    @ViewBuilder var actions: () -> Actions
    @Environment(\.spreadInline) private var inline

    private var inlineActions: some View {
        actions()
            .labelStyle(.iconOnly)
            .font(.body.weight(.medium))
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(.rect)
    }

    func body(content: Content) -> some View {
        if inline {
            content.safeAreaInset(edge: .top, spacing: 0) {
                if let query {
                    HStack(spacing: 6) {
                        RoomSearchField(text: query, prompt: prompt)
                        inlineActions
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 6)
                } else {
                    HStack(spacing: 6) {
                        Spacer(minLength: 0)
                        inlineActions
                    }
                    .padding(.horizontal, 16)
                    .frame(height: 0)
                    .offset(y: -28)
                }
            }
        } else if let query {
            content
                .searchable(text: query, prompt: prompt)
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.large)
                .toolbar { ToolbarItemGroup(placement: .primaryAction) { actions() } }
        } else {
            content
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.large)
                .toolbar { ToolbarItemGroup(placement: .primaryAction) { actions() } }
        }
    }
}
