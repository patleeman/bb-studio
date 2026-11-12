import SwiftUI

extension View {
    /// A star in the navigation bar of a Studio item's screen, filled while
    /// the item is starred. Shown when Studio has stars and lists the item.
    func studioStar(_ route: Route) -> some View {
        modifier(StudioStar(route: route))
    }
}

private struct StudioStar: ViewModifier {
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }
    @ObservedObject private var store = StudioStore.shared
    let route: Route
    @State private var failed = false

    func body(content: Content) -> some View {
        content
            .toolbar {
                if store.supportsStars, let item = store.item(for: route) {
                    ToolbarItem(placement: .topBarTrailing) { button(item) }
                }
            }
            .task(id: app.serverURL) {
                // Opened from a link or a thread, before the Studio tab.
                store.restore()
                store.attach(app)
                if store.items.isEmpty { await store.load(client) }
            }
            .alert("Couldn't change the star", isPresented: $failed) {
                Button("OK", role: .cancel) {}
            }
    }

    private func button(_ item: StudioItem) -> some View {
        let starred = store.isStarred(item)
        return Button {
            Task {
                do { try await store.setStarred(item, !starred, client: client) } catch { failed = true }
            }
        } label: {
            Image(systemName: starred ? "star.fill" : "star")
        }
        .tint(starred ? .yellow : nil)
        .accessibilityLabel(starred ? "Unstar" : "Star")
        .accessibilityIdentifier("studioStar")
        .sensoryFeedback(.selection, trigger: starred)
    }
}
