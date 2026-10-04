import SwiftUI

/// The office the app shows: the Spaces, the one you're in, and its stores.
/// Space-specific stores are rebuilt when you switch Spaces, so a screen never
/// mixes two offices.
@Observable @MainActor
final class OfficeContext {
    let spaces: SpacesStore
    /// Every Space's Inbox; the tab badge counts its requests.
    let inbox: InboxStore
    private(set) var home: HomeStore?
    private(set) var team: TeamStore?
    private(set) var work: WorkStore?
    /// Requests waiting on you in every Space; the Inbox tab's badge.
    var inboxBadge: Int { inbox.counts.bySpace.values.reduce(0) { $0 + $1.requests } }
    @ObservationIgnored private let client: BBClient

    init(client: BBClient) {
        self.client = client
        spaces = SpacesStore(client: client)
        inbox = InboxStore(client: client)
    }

    func observe(_ realtime: BBRealtime) { inbox.startObserving(realtime) }
    func stopObserving() { inbox.stopObserving() }

    var currentSpace: OfficeSpace? { spaces.currentSpace }

    func load() async {
        await spaces.load()
        rebuild()
        async let current: Void = refreshCurrent()
        async let inbox: Void = self.inbox.load()
        _ = await (current, inbox)
    }

    func select(_ spaceId: String) async {
        spaces.select(spaceId)
        rebuild()
        await refreshCurrent()
    }

    func refreshCurrent() async {
        async let home: Void = self.home?.refresh() ?? ()
        async let team: Void = self.team?.refresh() ?? ()
        async let work: Void = self.work?.refresh() ?? ()
        _ = await (home, team, work)
    }

    private func rebuild() {
        guard let id = spaces.currentSpaceId ?? spaces.currentSpace?.id else { return }
        if home?.spaceId == id { return }
        home = HomeStore(spaceId: id, client: client)
        team = TeamStore(spaceId: id, client: client)
        work = WorkStore(spaceId: id, client: client)
    }

    func bot(_ id: String?) -> OfficeTeamBot? {
        guard let id else { return nil }
        return team?.bots.first { $0.id == id }
    }
}

/// A bot is a face: a round avatar. A green ring while it works, an orange dot
/// when it needs you. A face is someone; a row is something.
struct Face: View {
    var name: String
    var avatar: String?
    var state: OfficeBotState = .idle
    var size: CGFloat = 36

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Circle()
                .fill(Color(.secondarySystemFill))
                .frame(width: size, height: size)
                .overlay {
                    Text(avatar?.isEmpty == false ? avatar! : String(name.prefix(1)).uppercased())
                        .font(.system(size: size * 0.5))
                }
                .overlay {
                    if state == .working {
                        Circle()
                            .strokeBorder(Color.green, style: StrokeStyle(lineWidth: 2, dash: [3, 3]))
                            .padding(-3)
                    }
                }
            if state == .needsYou, size >= 28 {
                Circle()
                    .fill(Color.orange)
                    .frame(width: size * 0.28, height: size * 0.28)
                    .overlay(Circle().stroke(Color(.systemBackground), lineWidth: 2))
                    .offset(x: 1, y: -1)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(state == .needsYou ? "\(name), needs you" : state == .working ? "\(name), working" : name)
    }
}

extension Face {
    init(_ bot: OfficeTeamBot, size: CGFloat = 36) {
        self.init(name: bot.name, avatar: bot.avatar, state: bot.state, size: size)
    }
}

/// The Space's mark: its emoji, or its initial on a rounded tile.
struct SpaceMark: View {
    var space: OfficeSpace
    var size: CGFloat = 22

    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.25)
            .fill(Color(.secondarySystemFill))
            .frame(width: size, height: size)
            .overlay {
                Text(space.icon?.isEmpty == false ? space.icon! : String(space.name.prefix(1)).uppercased())
                    .font(.system(size: size * 0.6, weight: .semibold))
            }
            .accessibilityHidden(true)
    }
}

/// The nav-bar control that shows and switches the Space.
struct SpaceSwitcher: View {
    @Environment(OfficeContext.self) private var office
    @EnvironmentObject private var app: AppModel
    @State private var creating = false

    var body: some View {
        Menu {
            Section {
                ForEach(office.spaces.spaces) { space in
                    Button {
                        Task { await office.select(space.id) }
                    } label: {
                        if space.id == office.currentSpace?.id {
                            Label(space.name, systemImage: "checkmark")
                        } else {
                            Text(space.name)
                        }
                    }
                }
            }
            Button { creating = true } label: { Label("New Space", systemImage: "plus") }
            Button { app.tab = .settings } label: { Label("Space Settings", systemImage: "gearshape") }
        } label: {
            HStack(spacing: 6) {
                if let space = office.currentSpace { SpaceMark(space: space, size: 20) }
                Text(office.currentSpace?.name ?? "Spaces").font(.headline).lineLimit(1)
                Image(systemName: "chevron.down").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
            }
            .foregroundStyle(.primary)
        }
        .accessibilityLabel("Space: \(office.currentSpace?.name ?? "none"). Switch space")
        .sheet(isPresented: $creating) { NewSpaceSheet() }
    }
}

struct NewSpaceSheet: View {
    @Environment(OfficeContext.self) private var office
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var icon = ""
    @State private var error: String?
    @State private var saving = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name)
                    TextField("Icon (emoji)", text: $icon)
                } footer: {
                    Text("A space is its own office: its own folders, team, conversations and inbox.")
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
            }
            .navigationTitle("New Space")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        saving = true
                        Task {
                            defer { saving = false }
                            do {
                                let trimmedIcon = icon.trimmingCharacters(in: .whitespaces)
                                let space = try await app.client.officeCreateSpace(
                                    name: name.trimmingCharacters(in: .whitespaces),
                                    icon: trimmedIcon.isEmpty ? nil : trimmedIcon)
                                await office.spaces.refresh()
                                await office.select(space.id)
                                dismiss()
                            } catch {
                                self.error = BBClient.describe(error)
                            }
                        }
                    }
                    .disabled(saving || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }
}

extension OfficeItem {
    /// The native screen for this item, by its kind.
    var route: Route? {
        switch kind {
        case "page": .page(id: itemId)
        case "drawing": .drawing(id: itemId)
        case "artifact": .artifact(id: itemId)
        case "task": .task(id: itemId)
        case "board": .tasks
        case "table": .table(id: itemId)
        case "recording", "dictation": .recording(id: itemId)
        default: nil
        }
    }

    var symbol: String {
        switch kind {
        case "page": "doc.text"
        case "drawing": "scribble"
        case "artifact": "shippingbox"
        case "task": "checkmark.circle"
        case "board": "square.grid.2x2"
        case "table": "tablecells"
        case "recording", "dictation": "mic"
        default: "doc"
        }
    }
}
