import SwiftUI

struct RootView: View {
    @EnvironmentObject private var model: AppModel

    @State private var windowSize = CGSize.zero
    @State private var windowLeadingInset: CGFloat = 0

    var body: some View {
        let layout = DuoLayout(size: windowSize, leadingInset: windowLeadingInset)
        HStack(spacing: 0) {
            DuoTabRail(selection: $model.tab)
                .frame(width: layout.railWidth)
                .clipped()
                .accessibilityHidden(!layout.twoPages)
            tabs
                .padding(.leading, layout.twoPages && model.tab != .inbox ? layout.listWidth + DuoLayout.gutter : 0)
        }
        .environment(\.duoLayout, layout)
        .background(WindowGeometry { size, leading in
            windowSize = size
            windowLeadingInset = leading
        })
    }

    private var tabs: some View {
        TabView(selection: $model.tab) {
            BotsTab()
                .tabItem { Label("Bot", systemImage: "face.smiling") }
                .tag(Tab.bot)

            InboxTab()
                .tabItem { Label("Threads", systemImage: "bubble.left.and.bubble.right") }
            .tag(Tab.inbox)

            NavigationStack(path: $model.studioPath) {
                StudioView().navigationDestination(for: Route.self) { RouteDestination(route: $0) }
            }
            .tabItem { Label("Studio", systemImage: "square.stack") }
            .tag(Tab.studio)

            NavigationStack { SettingsView() }
                .tabItem { Label("Settings", systemImage: "gear") }
                .tag(Tab.settings)
        }
        .tabViewStyle(.sidebarAdaptable)
        // Use our rail on a two-page window. Portrait keeps the phone tabs.
        .environment(\.horizontalSizeClass, .compact)
        .toolbar(DuoLayout(size: windowSize).twoPages ? .hidden : .automatic, for: .tabBar)
        .overlay(alignment: .bottom) {
            if let notice = model.notice {
                Text(notice)
                    .font(.subheadline.weight(.medium))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(.regularMaterial, in: .capsule)
                    .padding(.horizontal)
                    .padding(.bottom, 64)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .allowsHitTesting(false)
            }
        }
        .animation(.snappy, value: model.notice)
        .alert("Notification unavailable", isPresented: Binding(
            get: { model.notificationError != nil },
            set: { if !$0 { model.notificationError = nil } }
        )) {
            Button("OK", role: .cancel) { model.notificationError = nil }
        } message: {
            Text(model.notificationError ?? "")
        }
        .sheet(item: $model.sheet) { sheet in
            switch sheet {
            case .capture:
                CaptureSheet()
            case .dictation(let threadId, let autoStart):
                DictationView(threadId: threadId, autoStart: autoStart)
            case .recording:
                DictationView(threadId: nil, autoStart: true, kind: "recording")
            case .write:
                QuickWriteView()
            }
        }
    }
}

/// The destination stack never moves to a different structural branch on resize.
/// ThreadView owns its live model, draft and ScrollPosition throughout the change.
struct InboxTab: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.duoLayout) private var layout

    var body: some View {
        HStack(spacing: 0) {
            ZStack {
                if layout.twoPages {
                    NavigationStack { InboxView(selectsDetail: true) }
                }
            }
            .frame(width: layout.listWidth)
            .clipped()
            .accessibilityHidden(!layout.twoPages)
            Rectangle()
                .fill(Color(uiColor: .systemGroupedBackground))
                .frame(width: layout.twoPages ? DuoLayout.gutter : 0)
                .overlay { if layout.twoPages { Color(uiColor: .separator).frame(width: 1) } }
                .accessibilityHidden(true)
            NavigationStack(path: $model.path) {
                InboxView()
                .opacity(layout.twoPages ? 0 : 1)
                .accessibilityHidden(layout.twoPages)
                .overlay {
                    if layout.twoPages {
                        ContentUnavailableView("No thread selected", systemImage: Symbols.thread)
                    }
                }
                .navigationDestination(for: Route.self) { RouteDestination(route: $0) }
            }
            .frame(maxWidth: .infinity)
        }
    }
}

/// The screen for a route, in whichever tab pushed it.
struct RouteDestination: View {
    let route: Route

    var body: some View {
        switch route {
        case .thread(let id): ThreadView(threadId: id).id(id)
        case .pages: PagesView()
        case .page(let id): PageView(pageId: id).id(id)
        case .automations: AutomationsView()
        case .automation(let automation): AutomationView(automation: automation).id(automation.id)
        case .usage: UsageView()
        case .archived: ArchivedView()
        case .drawings: DrawingsView()
        case .drawing(let id): DrawingView(id: id)
        case .recording(let id): RecordingDetailView(id: id)
        case .artifact(let id): ArtifactView(id: id)
        case .design(let id): DesignView(id: id).id(id)
        case .dashboard(let id): DashboardView(id: id).id(id)
        case .mini(let id): MiniAppView(id: id).id(id)
        case .terminals(let scope, let title): TerminalsView(scope: scope, title: title)
        }
    }
}

/// What the Bot tab shows for the selected server.
enum BotLead: Equatable {
    case loading
    case bot(BotInfo)
    case none
    case unavailable(String)

    init(_ bot: BotInfo?) { self = bot.map(BotLead.bot) ?? .none }
}
