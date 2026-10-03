import SwiftUI

/// Everything addressed to you, from every Space: requests first, then
/// reports and comments. A notification for an Inbox event opens here.
struct OfficeInboxTab: View {
    @EnvironmentObject private var app: AppModel
    @Environment(OfficeContext.self) private var office
    @State private var filter: String?
    @State private var bots: [String: OfficeTeamBot] = [:]

    var body: some View {
        let store = office.inbox
        NavigationStack(path: $app.inboxPath) {
            List {
                if office.spaces.spaces.count > 1 {
                    Section {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                chip("All", selected: filter == nil) { filter = nil }
                                ForEach(office.spaces.spaces) { space in
                                    let waiting = store.counts.bySpace[space.id]?.requests ?? 0
                                    chip(waiting > 0 ? "\(space.name) \(waiting)" : space.name, selected: filter == space.id) { filter = space.id }
                                }
                            }
                        }
                    }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
                }
                if let error = store.error, store.events.isEmpty {
                    Section { ConnectionBanner(message: error) { await store.refresh() } }
                }
                let shown = store.events.filter { $0.doneAt == nil && (filter == nil || $0.spaceId == filter) }
                let requests = shown.filter { $0.type == .request }
                let rest = shown.filter { $0.type != .request }
                Section {
                    if requests.isEmpty, !store.isLoading, store.error == nil {
                        Text("Nothing is waiting on you.").foregroundStyle(.secondary)
                    }
                    ForEach(requests) { event in row(event, store) }
                } header: { Text("Needs You").foregroundStyle(Color(.label)) }
                Section {
                    if rest.isEmpty, !store.isLoading, store.error == nil {
                        Text("You're caught up.").foregroundStyle(.secondary)
                    }
                    ForEach(rest) { event in row(event, store) }
                    if store.nextCursor != nil {
                        Button("Load More") { Task { await store.loadMore() } }
                    }
                } header: { Text("Reports and Comments").foregroundStyle(Color(.label)) }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Inbox")
            .refreshable { await store.refresh() }
            .navigationDestination(for: Route.self) { RouteDestination(route: $0) }
        }
        .task(id: app.serverURL) { await loadBots() }
        .onChange(of: app.tab) { _, tab in if tab == .inbox { Task { await store.refresh() } } }
    }

    private func row(_ event: OfficeInboxEvent, _ store: InboxStore) -> some View {
        OfficeEventRow(
            event: event,
            bot: event.botId.flatMap { bots[$0] } ?? office.bot(event.botId),
            space: filter == nil && office.spaces.spaces.count > 1 ? office.spaces.spaces.first { $0.id == event.spaceId } : nil,
            inbox: store
        ) {}
    }

    private func chip(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(.subheadline)
                .padding(.horizontal, 12).padding(.vertical, 6)
                .background(selected ? Color.accentColor.opacity(0.18) : Color(.secondarySystemFill), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    /// Faces for every Space's bots, since the Inbox spans them all.
    private func loadBots() async {
        guard let team = try? await app.client.officeTeam("all") else { return }
        bots = Dictionary(team.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    }
}
