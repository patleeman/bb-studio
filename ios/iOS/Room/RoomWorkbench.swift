import Observation
import SwiftUI

enum DuoPages: Equatable {
    case sideBySide, stacked

    static let hinge: CGFloat = 32

    init?(window size: CGSize, phone: Bool) {
        guard phone else { return nil }
        if size.width >= 900, size.height >= 600, size.width > size.height {
            self = .sideBySide
        } else if size.height >= 900, size.width >= 600 {
            self = .stacked
        } else {
            return nil
        }
    }
}

enum WorkbenchItem: Hashable {
    case place(RoomPlace)
    case thread(String)
    case route(Route)
    case settings

    var key: String? {
        switch self {
        case .place(let place): "place:" + place.rawValue
        case .thread(let id): "thread:" + id
        case .settings: "settings"
        case .route: nil
        }
    }

    init?(key: String) {
        if key == "settings" {
            self = .settings
        } else if key.hasPrefix("place:"), let place = RoomPlace(rawValue: String(key.dropFirst(6))) {
            self = .place(place)
        } else if key.hasPrefix("thread:"), key.count > 7 {
            self = .thread(String(key.dropFirst(7)))
        } else {
            return nil
        }
    }

    static func place(for page: BotPage) -> RoomPlace {
        switch page {
        case .memory: .memory
        case .library: .library
        case .todos: .todos
        case .automations: .schedules
        case .archive: .archive
        }
    }
}

struct WorkbenchTab: Identifiable, Equatable {
    let id: UUID
    var item: WorkbenchItem
    var path: [Route]
}

@MainActor @Observable
final class Workbench {
    private(set) var tabs: [WorkbenchTab] = []
    var selected: UUID? {
        didSet { save() }
    }
    private let defaults: UserDefaults
    static let key = "roomWorkbenchTabs"
    static let selectedKey = "roomWorkbenchSelected"

    init(defaults: UserDefaults = .standard, keys: [String]? = nil) {
        self.defaults = defaults
        let saved = keys ?? Self.initialKeys(defaults)
        tabs = saved.compactMap(WorkbenchItem.init(key:)).map { WorkbenchTab(id: UUID(), item: $0, path: []) }
        let index = keys == nil ? defaults.integer(forKey: Self.selectedKey) : 0
        selected = tabs.indices.contains(index) ? tabs[index].id : tabs.first?.id
    }

    private static func initialKeys(_ defaults: UserDefaults) -> [String] {
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        if let at = arguments.firstIndex(of: "-qaWorkbench") {
            return arguments.indices.contains(at + 1) ? arguments[at + 1].split(separator: ",").map(String.init) : []
        }
        if BotDemo.variant != nil { return [] }
        #endif
        return defaults.stringArray(forKey: key) ?? []
    }

    var current: WorkbenchTab? { tabs.first { $0.id == selected } }

    func open(_ item: WorkbenchItem, then path: [Route] = []) {
        if let index = tabs.firstIndex(where: { $0.item == item }) {
            if !path.isEmpty { tabs[index].path = path }
            selected = tabs[index].id
            return
        }
        let tab = WorkbenchTab(id: UUID(), item: item, path: path)
        tabs.append(tab)
        selected = tab.id
    }

    func open(routes: [Route]) {
        guard let first = routes.first else { return }
        let rest = Array(routes.dropFirst())
        if case .thread(let id) = first {
            open(.thread(id), then: rest)
        } else {
            open(.route(first), then: rest)
        }
    }

    func close(_ id: UUID) {
        guard let index = tabs.firstIndex(where: { $0.id == id }) else { return }
        tabs.remove(at: index)
        if selected == id || selected == nil {
            selected = tabs.isEmpty ? nil : tabs[min(index, tabs.count - 1)].id
        } else {
            save()
        }
    }

    func push(_ route: Route, in id: UUID) {
        guard let index = tabs.firstIndex(where: { $0.id == id }) else { return }
        tabs[index].path.append(route)
    }

    func path(_ id: UUID) -> Binding<[Route]> {
        Binding(get: { [weak self] in self?.tabs.first { $0.id == id }?.path ?? [] },
                set: { [weak self] value in
                    guard let self, let index = tabs.firstIndex(where: { $0.id == id }) else { return }
                    tabs[index].path = value
                })
    }

    private func save() {
        let kept = tabs.filter { $0.item.key != nil }
        defaults.set(kept.compactMap(\.item.key), forKey: Self.key)
        defaults.set(kept.firstIndex { $0.id == selected } ?? 0, forKey: Self.selectedKey)
    }
}

struct RoomPages<Room: View, Bench: View>: View {
    let pages: DuoPages?
    let layout: DuoLayout
    @ViewBuilder var room: Room
    @ViewBuilder var bench: Bench

    var body: some View {
        GeometryReader { proxy in
            let stack = pages == .stacked ? AnyLayout(VStackLayout(spacing: 0)) : AnyLayout(HStackLayout(spacing: 0))
            let first = firstPage(proxy)
            stack {
                room
                    .frame(width: pages == .sideBySide ? first : nil, height: pages == .stacked ? first : nil)
                    .environment(\.duoLayout, DuoLayout(size: pageSize(proxy, first), innerScreen: layout.innerScreen))
                    .environment(\.horizontalSizeClass, .compact)
                    .environment(\.duoPage, pages != nil)
                if let pages {
                    Color.black
                        .frame(width: pages == .sideBySide ? DuoPages.hinge : nil, height: pages == .stacked ? DuoPages.hinge : nil)
                        .ignoresSafeArea()
                        .accessibilityHidden(true)
                    bench
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .environment(\.duoLayout, DuoLayout(size: .zero, innerScreen: layout.innerScreen))
                        .environment(\.horizontalSizeClass, .compact)
                }
            }
        }
    }

    private func firstPage(_ proxy: GeometryProxy) -> CGFloat {
        switch pages {
        case .sideBySide: max(0, layout.windowSize.width / 2 - DuoPages.hinge / 2 - proxy.safeAreaInsets.leading)
        case .stacked: max(0, layout.windowSize.height / 2 - DuoPages.hinge / 2 - proxy.safeAreaInsets.top)
        case nil: 0
        }
    }

    private func pageSize(_ proxy: GeometryProxy, _ first: CGFloat) -> CGSize {
        switch pages {
        case .sideBySide: CGSize(width: first, height: layout.windowSize.height)
        case .stacked: CGSize(width: layout.windowSize.width, height: first)
        case nil: layout.windowSize
        }
    }
}

struct RoomWorkbench: View {
    @Bindable var workbench: Workbench
    let bot: BotSpace
    @ObservedObject var store: BotSpacesStore
    let mainThreadId: String
    var openMain: () -> Void
    var chooseTheme: (String) -> Void
    @Environment(\.look) private var look

    private var view: BotThreadsView? { store.view(for: bot.id) }

    var body: some View {
        VStack(spacing: 0) {
            tabBar
            Group {
                if let tab = workbench.current {
                    page(tab).id(tab.id)
                } else {
                    launcher
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(look.canvas.ignoresSafeArea())
        .tint(look.accent)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("RoomWorkbench")
    }

    private var tabBar: some View {
        HStack(spacing: 0) {
            ScrollViewReader { reader in
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 2) {
                        ForEach(workbench.tabs) { tab in
                            tabButton(tab).id(tab.id)
                        }
                    }
                    .padding(.horizontal, 8)
                }
                .onChange(of: workbench.selected) { _, id in
                    guard let id else { return }
                    withAnimation(.snappy) { reader.scrollTo(id) }
                }
            }
            addMenu
        }
        .frame(height: 50, alignment: .bottom)
        .padding(.top, 6)
        .background(look.sidebar.ignoresSafeArea(edges: [.top, .trailing]))
        .overlay(alignment: .bottom) { Rectangle().fill(.separator).frame(height: 0.5) }
    }

    private func tabButton(_ tab: WorkbenchTab) -> some View {
        let selected = tab.id == workbench.selected
        let title = title(tab.item)
        return HStack(spacing: 0) {
            Button {
                workbench.selected = tab.id
            } label: {
                HStack(spacing: 7) {
                    if running(tab.item) { Circle().fill(.green).frame(width: 7, height: 7) }
                    Text(title).lineLimit(1)
                }
                .font(.subheadline.weight(selected ? .semibold : .regular))
                .foregroundStyle(selected ? AnyShapeStyle(.primary) : AnyShapeStyle(.secondary))
                .padding(.leading, 12)
                .padding(.trailing, selected ? 2 : 12)
                .frame(minHeight: 44)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(selected ? .isSelected : [])
            .accessibilityIdentifier("workbenchTab-" + (tab.item.key ?? title))
            .accessibilityAction(named: "Close") { workbench.close(tab.id) }
            if selected {
                Button { workbench.close(tab.id) } label: {
                    Image(systemName: "xmark")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.secondary)
                        .frame(width: 32, height: 44)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close \(title)")
                .accessibilityIdentifier("workbenchClose")
            }
        }
        .frame(maxWidth: 200)
        .background(selected ? look.canvas : .clear, in: UnevenRoundedRectangle(topLeadingRadius: 10, topTrailingRadius: 10, style: .continuous))
        .contextMenu {
            Button(role: .destructive) { workbench.close(tab.id) } label: { Label("Close Tab", systemImage: "xmark") }
        }
    }

    private var addMenu: some View {
        Menu {
            ForEach(RoomPlace.menu + [.archive]) { place in
                Button(place.title) { workbench.open(.place(place)) }
            }
            Divider()
            Button("Theme") { workbench.open(.place(.theme)) }
            Button("Settings") { workbench.open(.settings) }
        } label: {
            Image(systemName: "plus")
                .font(.body.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 44, height: 44)
                .contentShape(.rect)
        }
        .accessibilityLabel("Open something")
        .accessibilityIdentifier("workbenchAdd")
        .padding(.trailing, 6)
    }

    private var launcher: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 2) {
                Text("Open something here").font(.subheadline).foregroundStyle(.secondary).padding(.bottom, 8)
                ForEach(RoomPlace.menu) { place in
                    Button { workbench.open(.place(place)) } label: {
                        Text(place.title).font(.title2.weight(.semibold))
                            .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("workbenchOpen-" + place.rawValue)
                }
                let working = view?.workers.filter { $0.status == .running } ?? []
                if !working.isEmpty {
                    Text("Working now").font(.subheadline).foregroundStyle(.secondary).padding(.top, 18).padding(.bottom, 4)
                    ForEach(working) { worker in
                        Button { workbench.open(.thread(worker.threadId)) } label: {
                            HStack(spacing: 10) {
                                Circle().fill(.green).frame(width: 7, height: 7)
                                Text(worker.title).lineLimit(1)
                                Spacer(minLength: 0)
                            }
                            .frame(minHeight: 44)
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 20)
        }
        .accessibilityIdentifier("workbenchLauncher")
    }

    @ViewBuilder private func page(_ tab: WorkbenchTab) -> some View {
        switch tab.item {
        case .place(let place):
            RoomPlaceSheet(place: place, bot: bot, store: store, mainThreadId: mainThreadId, todayCount: nil, open: open,
                           startedConversation: { workbench.open(.thread($0)) }, closeToRoom: { workbench.close(tab.id) },
                           theme: look.theme.id, chooseTheme: chooseTheme)
        case .thread(let id):
            NavigationStack(path: workbench.path(tab.id)) {
                ThreadView(threadId: id).id(id)
                    .navigationDestination(for: Route.self) { RouteDestination(route: $0) }
            }
            .environment(\.botConversation, context(id, tab: tab.id))
        case .route(let route):
            NavigationStack(path: workbench.path(tab.id)) {
                RouteDestination(route: route)
                    .navigationDestination(for: Route.self) { RouteDestination(route: $0) }
            }
            .environment(\.botConversation, context(mainThreadId, tab: tab.id))
        case .settings:
            SettingsTab()
        }
    }

    private func open(_ item: BotShellItem) {
        switch item {
        case .conversation(let id) where id == mainThreadId: openMain()
        case .conversation(let id), .worker(let id): workbench.open(.thread(id))
        case .page(let page): workbench.open(.place(WorkbenchItem.place(for: page)))
        }
    }

    private func context(_ threadId: String, tab: UUID) -> BotConversationContext {
        let worker = view?.workers.contains { $0.threadId == threadId } == true
        return BotShell.context(threadId: threadId, kind: worker ? .worker : .conversation, bot: bot, view: view, splitsThreads: true,
                                push: { [workbench] route in workbench.push(route, in: tab) },
                                openConversation: { [workbench, mainThreadId, openMain] id in
                                    if id == mainThreadId { openMain() } else { workbench.open(.thread(id)) }
                                },
                                showList: { [workbench] in workbench.close(tab) },
                                refresh: { [store] in Task { await store.refresh() } })
    }

    private func title(_ item: WorkbenchItem) -> String {
        switch item {
        case .place(let place): return place.title
        case .settings: return "Settings"
        case .thread(let id):
            if id == mainThreadId { return "Main" }
            if let conversation = view?.conversations.first(where: { $0.threadId == id }) {
                return conversation.title.isEmpty ? "Untitled" : conversation.title
            }
            if let worker = view?.workers.first(where: { $0.threadId == id }) { return worker.title }
            return "Conversation"
        case .route(let route): return Self.title(route)
        }
    }

    private func running(_ item: WorkbenchItem) -> Bool {
        guard case .thread(let id) = item else { return false }
        return view?.workers.contains { $0.threadId == id && $0.status == .running } == true
    }

    static func title(_ route: Route) -> String {
        switch route {
        case .thread: "Conversation"
        case .pages, .page: "Page"
        case .automations, .automation: "Schedules"
        case .usage: "Usage"
        case .archived: "Archived"
        case .drawing: "Drawing"
        case .recording: "Recording"
        case .artifact: "Artifact"
        case .design: "Design"
        case .dashboard: "Dashboard"
        case .mini: "App"
        case .terminals(_, let title): title
        case .visualChats, .visualChat: "Visual Chat"
        case .memoryRecord: "Memory"
        }
    }
}
