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
    private(set) var tabs: TabsStore?
    /// Requests waiting on you in every Space; the Inbox tab's badge.
    var inboxBadge: Int { inbox.counts.bySpace.values.reduce(0) { $0 + $1.requests } }
    @ObservationIgnored private let client: BBClient
    @ObservationIgnored private var realtime: BBRealtime?

    init(client: BBClient) {
        self.client = client
        spaces = SpacesStore(client: client)
        inbox = InboxStore(client: client)
    }

    func observe(_ realtime: BBRealtime) {
        self.realtime = realtime
        inbox.startObserving(realtime)
        tabs?.startObserving(realtime)
    }
    func stopObserving() {
        inbox.stopObserving()
        tabs?.stopObserving()
        realtime = nil
    }

    var currentSpace: OfficeSpace? { spaces.currentSpace }

    func load() async {
        // Capability discovery belongs to the root office, not a screen the
        // user may never open. Settings and cold deep links read this cache.
        if let running = try? await client.runningPlugins() {
            UserDefaults.standard.set(running.sorted().joined(separator: ","),
                forKey: ServerScope.key("runningPlugins", serverURL: client.baseURL))
        }
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
        async let tabs: Void = self.tabs?.refresh() ?? ()
        _ = await (home, team, work, tabs)
    }

    private func rebuild() {
        guard let id = spaces.currentSpaceId ?? spaces.currentSpace?.id else { return }
        if home?.spaceId == id { return }
        home = HomeStore(spaceId: id, client: client)
        team = TeamStore(spaceId: id, client: client)
        work = WorkStore(spaceId: id, client: client)
        tabs?.stopObserving()
        tabs = TabsStore(spaceId: id, client: client)
        if let realtime { tabs?.startObserving(realtime) }
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
    /// Runs on an outside agent (Hermes, OpenClaw): a small globe at the corner.
    var external: String? = nil

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Circle()
                .fill(Color(.secondarySystemFill))
                .frame(width: size, height: size)
                .overlay {
                    Text(avatar?.isEmpty == false ? avatar! : String(name.prefix(1)).uppercased())
                        .font(.system(size: size * 0.5))
                        .accessibilityHidden(true)
                }
                .overlay {
                    if state == .working {
                        Circle()
                            .strokeBorder(Color.green, style: StrokeStyle(lineWidth: 2, dash: [3, 3]))
                            .padding(-3)
                    }
                }
            if let external, size >= 28 {
                Image(systemName: "globe")
                    .font(.system(size: size * 0.22, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: size * 0.36, height: size * 0.36)
                    .background(Circle().fill(Color(.secondarySystemBackground)))
                    .overlay(Circle().stroke(Color(.systemBackground), lineWidth: 1.5))
                    .offset(x: 2, y: size - size * 0.36 + 2)
                    .accessibilityHidden(true)
                    .help("\(external) agent")
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
        .accessibilityAddTraits(.isImage)
        .accessibilityIdentifier("officeFace")
        .accessibilityLabel([name, external.map { "\($0) agent" }, state == .needsYou ? "needs you" : state == .working ? "working" : nil]
            .compactMap { $0 }.joined(separator: ", "))
    }
}

extension Face {
    init(_ bot: OfficeTeamBot, size: CGFloat = 36) {
        self.init(name: bot.name, avatar: bot.avatar, state: bot.state, size: size, external: bot.externalAgent)
    }
}

/// The Space's mark, like an Arc Space's: its emoji on a soft circle of its
/// color, or a dot of that color when it has no emoji.
struct SpaceMark: View {
    var space: OfficeSpace
    var size: CGFloat = 22

    var body: some View {
        let color = space.tint
        Group {
            if let icon = space.icon, !icon.isEmpty {
                Circle()
                    .fill(color.opacity(0.3))
                    .overlay { Text(icon).font(.system(size: size * 0.6)) }
            } else {
                Circle()
                    .fill(color.opacity(0.3))
                    .overlay { Circle().fill(color).padding(size * 0.3) }
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

extension OfficeSpace {
    /// The Space's color, from its "#rrggbb"; the stock blue for older servers.
    var tint: Color {
        let hex = (color ?? "#3b82f6").dropFirst()
        guard hex.count == 6, let value = UInt32(hex, radix: 16) else { return .blue }
        return Color(red: Double((value >> 16) & 0xff) / 255, green: Double((value >> 8) & 0xff) / 255, blue: Double(value & 0xff) / 255)
    }
}

/// The nav-bar control that shows and switches the Space.
struct SpaceSwitcher: View {
    @Environment(OfficeContext.self) private var office
    @EnvironmentObject private var app: AppModel
    @State private var creating = false
    @State private var renaming = false
    @State private var deleting = false
    @State private var draftName = ""
    @State private var draftIcon = ""
    @AppStorage(OfficeRouting.key) private var routing = OfficeRouting.current.rawValue

    /// Arc's Space colors, by name, for the color menu.
    private static let colors: [(name: String, hex: String)] = [
        ("Blue", "#3b82f6"), ("Violet", "#8b5cf6"), ("Pink", "#ec4899"), ("Orange", "#f97316"), ("Green", "#22c55e"),
        ("Teal", "#14b8a6"), ("Yellow", "#eab308"), ("Red", "#ef4444"), ("Slate", "#64748b"),
    ]

    private func update(_ input: [String: JSONValue]) {
        guard let space = office.currentSpace else { return }
        Task {
            var body = input
            body["spaceId"] = .string(space.id)
            let _: JSONValue? = try? await app.client.rpc("studio", Studio.Method.space_update, .object(body))
            await office.spaces.refresh()
        }
    }

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
            if let space = office.currentSpace {
                Section(space.name) {
                    Button {
                        draftName = space.name
                        draftIcon = space.icon ?? ""
                        renaming = true
                    } label: { Label("Change Name and Icon…", systemImage: "pencil") }
                    Menu {
                        ForEach(Self.colors, id: \.hex) { color in
                            Button {
                                update(["color": .string(color.hex)])
                            } label: {
                                if space.color == color.hex { Label(color.name, systemImage: "checkmark") } else { Text(color.name) }
                            }
                        }
                    } label: { Label("Color", systemImage: "paintpalette") }
                    if !space.isDefault {
                        Button(role: .destructive) { deleting = true } label: { Label("Delete Space…", systemImage: "trash") }
                    }
                }
            }
            Button { creating = true } label: { Label("New Space", systemImage: "plus") }
            Button { app.tab = .settings } label: { Label("Space Settings", systemImage: "gearshape") }
            // Space routing, as in Arc: something new opens in the Space it belongs to.
            Toggle(isOn: Binding(get: { routing == OfficeRouting.own.rawValue }, set: { routing = ($0 ? OfficeRouting.own : .current).rawValue })) {
                Label("Open Things in Their Own Space", systemImage: "arrow.triangle.branch")
            }
        } label: {
            HStack(spacing: 6) {
                if let space = office.currentSpace { SpaceMark(space: space, size: 20) }
                Text(office.currentSpace?.name ?? "Spaces").font(.headline).lineLimit(1)
                Image(systemName: "chevron.down").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
            }
            .foregroundStyle(.primary)
        }
        .accessibilityLabel("Space: \(office.currentSpace?.name ?? "none"). Switch space")
        .accessibilityIdentifier("officeSpaceSwitcher")
        .accessibilityShowsLargeContentViewer {
            Text(office.currentSpace?.name ?? "Spaces")
        }
        .sheet(isPresented: $creating) { NewSpaceSheet() }
        .alert("Change Space", isPresented: $renaming) {
            TextField("Name", text: $draftName)
            TextField("Icon (emoji)", text: $draftIcon)
            Button("Cancel", role: .cancel) {}
            Button("Save") {
                let name = draftName.trimmingCharacters(in: .whitespaces)
                let icon = draftIcon.trimmingCharacters(in: .whitespaces)
                var input: [String: JSONValue] = ["icon": icon.isEmpty ? .null : .string(icon)]
                if !name.isEmpty { input["name"] = .string(name) }
                update(input)
            }
        }
        .confirmationDialog("Delete \(office.currentSpace?.name ?? "this Space")?", isPresented: $deleting, titleVisibility: .visible) {
            Button("Delete Space", role: .destructive) {
                guard let space = office.currentSpace else { return }
                Task {
                    try? await app.client.officeDeleteSpace(space.id)
                    await office.spaces.refresh()
                    if let fallback = office.spaces.spaces.first(where: \.isDefault) { await office.select(fallback.id) }
                }
            }
        } message: { Text("Its folders move to your default Space.") }
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
