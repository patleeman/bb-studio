import SwiftUI

enum MemoryLayer: String, CaseIterable, Identifiable {
    case core, skills, history
    var id: String { rawValue }
    var title: String { rawValue.capitalized }
}

/// Memory, the Memory tab's root (designs 8d, 8g, 9g): Core | Skills | History.
/// Its large title, the layer switch under the bar, and Search in the bar.
/// Beside two pages (the open Duo) this is Core alone; Skills | History are
/// page two (`MemoryBrowsePane`).
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
                        .navigationTitle("Memory")
                        .navigationBarTitleDisplayMode(.large)
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

/// The page on one screen: the layer switch under the bar, Search in it.
private struct MemoryLayeredPage: View {
    let store: MemoryStore
    var open: (BotShellItem) -> Void
    @State private var layer: MemoryLayer = .core
    @State private var searching = false

    var body: some View {
        MemoryPageContent(store: store, layer: $layer, searching: $searching, open: open)
            .sensoryFeedback(.selection, trigger: layer)
            .safeAreaInset(edge: .top, spacing: 0) {
                MemoryLayerPicker(layer: $layer)
                    .padding(.horizontal, 16)
                    .frame(height: 44)
            }
            .navigationTitle("Memory")
            .navigationBarTitleDisplayMode(.large)
            .toolbar { ToolbarItem(placement: .primaryAction) { MemorySearchButton(searching: $searching) } }
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

private struct MemorySearchButton: View {
    @Binding var searching: Bool

    var body: some View {
        Button { withAnimation(.snappy) { searching.toggle() } } label: {
            Label(searching ? "Close search" : "Search memory", systemImage: searching ? "xmark" : "magnifyingglass")
        }
        .accessibilityIdentifier("memorySearch")
    }
}

/// Skills | History, page two beside Core on the open Duo, with + New skill
/// in its bar while on Skills. What they open pushes on this page (`Router.detail`).
struct MemoryBrowsePane: View {
    let store: MemoryStore
    var open: (BotShellItem) -> Void
    @State private var layer: MemoryLayer = .skills

    var body: some View {
        Group {
            if layer == .skills { SkillsLayerView(store: store, newSkillRow: false) } else { HistoryLayerView(store: store, open: open) }
        }
        .scrollContentBackground(.hidden)
        .navigationTitle(layer.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                MemoryLayerPicker(layer: $layer, layers: [.skills, .history]).frame(maxWidth: 240)
            }
            if layer == .skills {
                ToolbarItem(placement: .primaryAction) {
                    Button { Router.shared.push(.memoryNewSkill(botId: store.botId)) } label: { Label("New skill", systemImage: "plus") }
                        .accessibilityIdentifier("memorySkillNew")
                }
            }
        }
        .sensoryFeedback(.selection, trigger: layer)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("memory-browse")
    }
}
