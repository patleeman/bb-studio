import SwiftUI

// MARK: Settings

/// Which space the settings sheet edits; nil makes a new one.
struct SpaceSheet: Identifiable {
    var space: StudioSpace?
    var id: String { space?.id ?? "new" }
}

/// Makes a space, or renames, describes and deletes one.
struct SpaceSettingsSheet: View {
    let space: StudioSpace?
    /// Called with the saved space, or nil when it was deleted.
    var done: (StudioSpace?) -> Void = { _ in }
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var studio = StudioStore.shared
    @State private var name = ""
    @State private var icon = ""
    @State private var description = ""
    @State private var defaultProjectId = ""
    @State private var busy = false
    @State private var error: String?
    @State private var confirmingDelete = false

    private var current: StudioSpace? { space }
    private var isNew: Bool { space == nil }

    /// The same choices as Studio's picker on the web.
    static let icons = [
        "🚀", "🎯", "📣", "💡", "🧪", "🛠️", "📚", "🗓️", "📊", "📈", "🧭", "🗺️", "🏗️", "🔥", "⭐", "🧠",
        "🤖", "💼", "💰", "📦", "🎨", "🎬", "🎵", "📷", "✈️", "🏠", "🌱", "🌍", "❤️", "🏆", "🧩", "🔒",
    ]

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name).accessibilityIdentifier("spaceName")
                    TextField("Description", text: $description, axis: .vertical).lineLimit(2...5)
                }
                Section("Icon") {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 8), spacing: 4) {
                        ForEach(Self.icons, id: \.self) { each in
                            Button { icon = each } label: {
                                Text(each).font(.title3).frame(maxWidth: .infinity, minHeight: 36)
                                    .background(icon == each ? Color.accentColor.opacity(0.2) : .clear, in: .rect(cornerRadius: 8))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(each)
                            .accessibilityAddTraits(icon == each ? .isSelected : [])
                        }
                    }
                    if !icon.isEmpty { Button("No Icon") { icon = "" } }
                }
                Section {
                    Picker("Default project", selection: $defaultProjectId) {
                        Text("None").tag("")
                        ForEach(projects, id: \.id) { Text($0.name).tag($0.id) }
                    }
                } footer: {
                    Text("New items and threads made in the space go to this project.")
                }
                if let current, !isNew, !current.isDefault {
                    Section {
                        Button("Delete Space", role: .destructive) { confirmingDelete = true }.disabled(busy)
                    } footer: {
                        Text("Its items, threads and projects stay where they are.")
                    }
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
            }
            .navigationTitle(isNew ? "New Space" : "Space Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { operation.complete(on: app) { dismiss() } } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isNew ? "Create" : "Save") { Task { await save() } }
                        .disabled(busy || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || (!isNew && current == nil))
                }
            }
            .confirmationDialog("Delete \u{201C}\(current?.name ?? "")\u{201D}?", isPresented: $confirmingDelete, titleVisibility: .visible) {
                Button("Delete Space", role: .destructive) { Task { await delete() } }
            } message: {
                Text("Its items, threads and projects stay where they are.")
            }
        }
        .task {
            if studio.projectNames.isEmpty { studio.restore() }
            if let current = current {
                name = current.name
                icon = current.icon ?? ""
                description = current.description
                defaultProjectId = current.defaultProjectId ?? ""
            }
        }
    }

    private var projects: [(id: String, name: String)] {
        var names = studio.projectNames
        if !defaultProjectId.isEmpty, names[defaultProjectId] == nil { names[defaultProjectId] = "Project" }
        return names.map { ($0.key, $0.value) }.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    private func save() async {
        busy = true
        defer { busy = false }
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let icon = icon.trimmingCharacters(in: .whitespaces)
        let description = description.trimmingCharacters(in: .whitespacesAndNewlines)
        let project = defaultProjectId.isEmpty ? nil : defaultProjectId
        do {
            let saved: StudioSpace
            if let current, !isNew {
                saved = try await client.updateSpace(
                    current.id, name: name, icon: icon.isEmpty ? nil : icon, description: description, defaultProjectId: project)
            } else {
                saved = try await client.createSpace(
                    name: name, icon: icon.isEmpty ? nil : icon, description: description, defaultProjectId: project)
            }
            studio.saved(saved)
            await studio.load(client)
            operation.complete(on: app) { dismiss() }
            operation.complete(on: app) { done(saved) }
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
    }

    private func delete() async {
        guard let current else { return }
        busy = true
        defer { busy = false }
        do {
            try await studio.deleteSpace(current, client: client)
            guard client.baseURL == app.serverURL else { return }
            if app.studioSpace == current.id { app.studioSpace = nil }
            if app.homeSpace == current.id { app.homeSpace = nil }
            operation.complete(on: app) { dismiss() }
            operation.complete(on: app) { done(nil) }
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
    }
}

// MARK: A thread's Space

/// The one Space a thread is in, and the Spaces it could move to, for its menu.
@MainActor
final class ThreadSpacesModel: ObservableObject {
    @Published private(set) var spaces: [StudioSpace] = []
    @Published private(set) var spaceOf: [String: String] = [:]
    @Published private(set) var leadOfSpace: [String: String] = [:]

    /// Without both the Spaces and where each thread is, the menu stays hidden: a
    /// Studio without `space_of_threads` would show every thread in the default Space.
    /// Other failures keep what was loaded.
    func load(_ threadId: String, client: BBClient) async {
        do {
            async let listed = client.studioSpaces()
            async let of = client.spaceOfThreads()
            let (spaces, spaceOf) = try await (listed, of)
            self.spaces = spaces
            self.spaceOf = spaceOf
        } catch {
            if BBClient.isMissingRPC(error) {
                spaces = []
                spaceOf = [:]
                leadOfSpace = [:]
            }
            return
        }
        if let id = space(of: threadId, projectId: nil)?.id, let lead = try? await client.spaceLead(id) {
            leadOfSpace[id] = lead.threadId
        }
    }

    /// As the web sidebar decides: where Studio lists it, else its project's Space, else the default.
    func space(of threadId: String, projectId: String?) -> StudioSpace? {
        let assignment = SpaceAssignment(spaces: spaces, spaceOf: spaceOf)
        let id = spaceOf[threadId].flatMap { id in spaces.contains { $0.id == id } ? id : nil }
            ?? projectId.flatMap { project in spaces.first { $0.projectIds.contains(project) }?.id }
            ?? assignment.defaultSpaceId
        return spaces.first { $0.id == id }
    }

    func move(_ threadId: String, to space: StudioSpace, client: BBClient) async throws {
        spaceOf[threadId] = space.id
        try await client.moveThreads([threadId], toSpace: space.id)
        await load(threadId, client: client)
    }

    func setLead(_ threadId: String?, of space: StudioSpace, reload threadIdToReload: String, client: BBClient) async throws {
        leadOfSpace[space.id] = threadId
        try await client.setSpaceLead(space.id, threadId: threadId)
        await load(threadIdToReload, client: client)
    }
}

/// A submenu that opens the thread's Space, moves it to another, or makes it the Space's lead.
struct ThreadSpacesMenu: View {
    @ObservedObject var model: ThreadSpacesModel
    let threadId: String
    var projectId: String?
    /// Child threads stay with their root's Space.
    var isChild = false
    var failed: (String) -> Void
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }

    var body: some View {
        if let current = model.space(of: threadId, projectId: projectId) {
            Menu {
                Button { operation.complete(on: app) { app.openSpace(current.id) } } label: {
                    Label("Open \(current.name)", systemImage: "arrow.up.right")
                }
                if !isChild {
                    let isLead = model.leadOfSpace[current.id] == threadId
                    Button { setLead(isLead ? nil : threadId, of: current) } label: {
                        Label(isLead ? "Remove as Space Lead" : "Make Space Lead", systemImage: isLead ? "star.slash" : "star")
                    }
                    if model.spaces.count > 1 {
                        Section("Move to Space") {
                            ForEach(model.spaces) { space in
                                Button { move(to: space) } label: {
                                    if space.id == current.id { Label(space.label, systemImage: "checkmark") } else { Text(space.label) }
                                }
                                .disabled(space.id == current.id)
                            }
                        }
                    }
                }
            } label: {
                Label("Space: \(current.label)", systemImage: "square.stack.3d.up")
            }
        }
    }

    private func move(to space: StudioSpace) {
        Task {
            do {
                try await model.move(threadId, to: space, client: client)
            } catch {
                failed(BBClient.describe(error, server: client.baseURL))
            }
        }
    }

    private func setLead(_ lead: String?, of space: StudioSpace) {
        Task {
            do {
                try await model.setLead(lead, of: space, reload: threadId, client: client)
            } catch {
                failed(BBClient.describe(error, server: client.baseURL))
            }
        }
    }
}
