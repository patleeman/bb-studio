import SwiftUI

enum MemoryLayer: String, CaseIterable, Identifiable {
    case core, skills, history
    var id: String { rawValue }
    var title: String { rawValue.capitalized }
}

/// Memory as a full page (designs 8d, 8g, 9g): Core | Skills | History.
///
/// - iPhone: one 44-point bar: back, the layer switch in the title's place, Search.
/// - Folded Duo: the switch is the title line; Home and Search sit at the
///   bottom of the right column, within reach.
/// - Unfolded Duo, in the room's two pages: Core on the left page, and
///   Skills | History on the right one.
struct MemoryPageView: View {
    let botId: String?
    var open: (BotShellItem) -> Void
    @EnvironmentObject private var app: AppModel
    @Environment(\.showDetail) private var showDetail
    @State private var store: MemoryStore?

    var body: some View {
        Group {
            if let store, store.botId == botId {
                if let showDetail {
                    MemorySpreadCore(store: store, open: open, showDetail: showDetail)
                } else {
                    MemoryLayeredPage(store: store, open: open)
                }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: "\(app.client.baseURL.absoluteString)|\(botId ?? "")") {
            // Kept across pushes and pops: only another Bot or server makes a new one.
            if store?.botId != botId || store?.client !== app.client { store = MemoryStore(botId: botId, client: app.client) }
        }
        .accessibilityIdentifier("memory-page")
    }
}

/// The page on one screen, with the layer switch.
private struct MemoryLayeredPage: View {
    let store: MemoryStore
    var open: (BotShellItem) -> Void
    @State private var layer: MemoryLayer = .core
    @State private var searching = false

    var body: some View {
        let content = MemoryPageContent(store: store, layer: $layer, searching: $searching, open: open)
            .sensoryFeedback(.selection, trigger: layer)
        if FoldedChrome.foldedDuo {
            FoldedMemoryChrome(layer: $layer, searching: $searching) { content }
        } else {
            content.modifier(PhoneMemoryChrome(layer: $layer, searching: $searching))
        }
    }
}

/// What the page shows under its bar: the layer, or the search across all three.
private struct MemoryPageContent: View {
    let store: MemoryStore
    @Binding var layer: MemoryLayer
    @Binding var searching: Bool
    var open: (BotShellItem) -> Void

    var body: some View {
        if searching {
            MemorySearchView(store: store, open: open) { next in
                layer = next
                searching = false
            }
        } else {
            switch layer {
            case .core: CoreLayerView(store: store)
            case .skills: SkillsLayerView(store: store)
            case .history: HistoryLayerView(store: store, open: open)
            }
        }
    }
}

struct MemoryLayerPicker: View {
    @Binding var layer: MemoryLayer
    var layers: [MemoryLayer] = MemoryLayer.allCases

    var body: some View {
        Picker("Memory layer", selection: $layer) {
            ForEach(layers) { Text($0.title).tag($0) }
        }
        .pickerStyle(.segmented)
        .accessibilityIdentifier("memoryLayer")
    }
}

/// iPhone: the switch stands in for the title ("Memory" is what you tapped to get here).
private struct PhoneMemoryChrome: ViewModifier {
    @Binding var layer: MemoryLayer
    @Binding var searching: Bool

    func body(content: Content) -> some View {
        content
            .navigationTitle("Memory")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) { MemoryLayerPicker(layer: $layer).frame(maxWidth: 260) }
                ToolbarItem(placement: .primaryAction) { MemorySearchButton(searching: $searching) }
            }
    }
}

private struct MemorySearchButton: View {
    @Binding var searching: Bool

    var body: some View {
        Button { withAnimation(.snappy) { searching.toggle() } } label: {
            Label(searching ? "Close search" : "Search memory", systemImage: searching ? "xmark" : "magnifyingglass")
        }
        .accessibilityIdentifier("memorySearch")
    }
}

/// Folded Duo (9g): a 44-point title line holding the switch; the controls
/// in the right column, lowest first: Search, then Home.
private struct FoldedMemoryChrome<Content: View>: View {
    @Binding var layer: MemoryLayer
    @Binding var searching: Bool
    @ViewBuilder var content: Content
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        content
            .safeAreaInset(edge: .top, spacing: 0) {
                MemoryLayerPicker(layer: $layer)
                    .padding(.horizontal, 16)
                    .frame(height: 44)
            }
            .toolbar(.hidden, for: .navigationBar)
            .overlay { DuoRail(items: railItems) }
    }

    private var railItems: [DuoRail.Item] {
        [
            .init(id: "memoryHome", title: "Home", symbol: "house") { dismiss() },
            .init(id: "memorySearch", title: searching ? "Close" : "Search", symbol: searching ? "xmark" : "magnifyingglass") {
                withAnimation(.snappy) { searching.toggle() }
            },
        ]
    }
}

/// The folded Duo's controls at the bottom of the right column (the 84 points
/// iOS keeps for its status): line icons with a word under each, the first
/// item lowest, where the thumb rests.
struct DuoRail: View {
    struct Item: Identifiable {
        var id: String
        var title: String
        var symbol: String
        var action: () -> Void
    }

    let items: [Item]

    var body: some View {
        GeometryReader { proxy in
            VStack(spacing: 4) {
                ForEach(items.reversed()) { item in
                    Button(action: item.action) {
                        VStack(spacing: 2) {
                            Image(systemName: item.symbol).font(.system(size: 19, weight: .regular))
                            Text(item.title).font(.caption2)
                        }
                        .frame(width: 64, height: 56)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.primary)
                    .accessibilityLabel(item.title)
                    .accessibilityIdentifier(item.id)
                }
            }
            .padding(.bottom, 16)
            .frame(width: FoldedChrome.column, height: proxy.size.height + proxy.safeAreaInsets.bottom, alignment: .bottom)
            .position(x: proxy.size.width + proxy.safeAreaInsets.trailing - FoldedChrome.column / 2,
                      y: (proxy.size.height + proxy.safeAreaInsets.bottom) / 2)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("duoRail")
    }
}

/// The unfolded Duo (8g): Core on this page; Skills | History fill the other.
private struct MemorySpreadCore: View {
    let store: MemoryStore
    var open: (BotShellItem) -> Void
    let showDetail: (RoomDetail) -> Void

    var body: some View {
        CoreLayerView(store: store)
            .task {
                showDetail(RoomDetail(id: "memory-browse", view: AnyView(MemoryBrowsePane(store: store, open: open))))
            }
    }
}

/// Skills | History on the unfolded Duo's right page; + New skill in its bar while on Skills.
struct MemoryBrowsePane: View {
    let store: MemoryStore
    var open: (BotShellItem) -> Void
    @State private var layer: MemoryLayer = .skills

    var body: some View {
        Group {
            if layer == .skills { SkillsLayerView(store: store, newSkillRow: false) } else { HistoryLayerView(store: store, open: open) }
        }
        .safeAreaInset(edge: .top, spacing: 0) { MemoryBrowseBar(store: store, layer: $layer) }
        .toolbar(.hidden, for: .navigationBar)
        .sensoryFeedback(.selection, trigger: layer)
        .accessibilityIdentifier("memory-browse")
    }
}

private struct MemoryBrowseBar: View {
    let store: MemoryStore
    @Binding var layer: MemoryLayer

    var body: some View {
        ZStack {
            MemoryLayerPicker(layer: $layer, layers: [.skills, .history]).frame(maxWidth: 240)
            if layer == .skills {
                NavigationLink { NewSkillScreen(store: store) } label: {
                    Image(systemName: "plus").font(.body.weight(.medium)).frame(width: 44, height: 44).contentShape(.rect)
                }
                .accessibilityLabel("New skill")
                .accessibilityIdentifier("memorySkillNew")
                .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
        .padding(.horizontal, 12)
        .frame(height: 44)
    }
}
