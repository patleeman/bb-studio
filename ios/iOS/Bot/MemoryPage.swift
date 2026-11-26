import SwiftUI

enum MemoryLayer: String, CaseIterable, Identifiable {
    case core, skills, history
    var id: String { rawValue }
    var title: String { rawValue.capitalized }
}

/// Memory as a full page (designs 8d, 8g, 9g): Core | Skills | History.
///
/// - iPhone: one 44-point bar: back, the layer switch in the title's place, Search.
/// - Duo in one column (folded, vertical): the switch is the title line; Back
///   and Search are in the shell's rail (`.screenActions`).
/// - Duo beside two pages (book, flat): Core on the left page, and
///   Skills | History on the right one (`.screenCompanion`).
struct MemoryPageView: View {
    let botId: String?
    var open: (BotShellItem) -> Void
    @EnvironmentObject private var app: AppModel
    @Environment(\.shellPosture) private var posture
    @State private var store: MemoryStore?

    var body: some View {
        Group {
            if let store, store.botId == botId {
                if posture.splitsWorkbench {
                    CoreLayerView(store: store)
                        .screenCompanion(id: "memory-browse-\(botId ?? "")") { MemoryBrowsePane(store: store, open: open) }
                } else {
                    MemoryLayeredPage(store: store, open: open)
                }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: "\(app.client.baseURL.absoluteString)|\(botId ?? "")") {
            // Kept across pushes and pops: only another Bot or server makes a new one.
            if store?.botId != botId || store?.client !== app.client { store = MemoryStore.shared(botId: botId, client: app.client) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("memory-page")
    }
}

/// The page on one screen, with the layer switch.
private struct MemoryLayeredPage: View {
    let store: MemoryStore
    var open: (BotShellItem) -> Void
    @State private var layer: MemoryLayer = .core
    @State private var searching = false

    @Environment(\.shellPosture) private var posture

    var body: some View {
        let content = MemoryPageContent(store: store, layer: $layer, searching: $searching, open: open)
            .sensoryFeedback(.selection, trigger: layer)
        if posture.usesRail {
            content.modifier(DuoMemoryChrome(layer: $layer, searching: $searching))
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

/// The Duo in one column (9g): the switch is the title line; Search is in
/// the shell's rail, beside Back.
private struct DuoMemoryChrome: ViewModifier {
    @Binding var layer: MemoryLayer
    @Binding var searching: Bool

    func body(content: Content) -> some View {
        content
            .safeAreaInset(edge: .top, spacing: 0) {
                MemoryLayerPicker(layer: $layer)
                    .padding(.horizontal, 16)
                    .frame(height: 44)
            }
            .screenDrawsTitleLine()
            .screenActions([ScreenAction(id: "memorySearch", title: searching ? "Close" : "Search",
                                         systemImage: searching ? "xmark" : "magnifyingglass") {
                withAnimation(.snappy) { searching.toggle() }
            }])
    }
}

/// Skills | History on the open Duo's right page; + New skill in its bar while on Skills.
/// Its own stack: a skill and New skill open on that page.
struct MemoryBrowsePane: View {
    let store: MemoryStore
    var open: (BotShellItem) -> Void

    var body: some View {
        NavigationStack { MemoryBrowseLayers(store: store, open: open) }
    }
}

private struct MemoryBrowseLayers: View {
    let store: MemoryStore
    var open: (BotShellItem) -> Void
    @State private var layer: MemoryLayer = .skills

    var body: some View {
        Group {
            if layer == .skills { SkillsLayerView(store: store, newSkillRow: false) } else { HistoryLayerView(store: store, open: open) }
        }
        .scrollContentBackground(.hidden)
        .safeAreaInset(edge: .top, spacing: 0) { MemoryBrowseBar(store: store, layer: $layer) }
        .toolbar(.hidden, for: .navigationBar)
        .sensoryFeedback(.selection, trigger: layer)
        .accessibilityElement(children: .contain)
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
                Button { Router.shared.push(.memoryNewSkill(botId: store.botId)) } label: {
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
