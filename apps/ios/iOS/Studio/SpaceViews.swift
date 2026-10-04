import SwiftUI

// MARK: Opening a space

/// A space opens as its page, which Studio makes from the space template the first time.
struct SpaceRouteView: View {
    let id: String
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }
    @State private var pageId: String?
    @State private var error: String?
    @State private var noPage = false

    var body: some View {
        Group {
            if let pageId {
                PageView(pageId: pageId).id(pageId)
            } else if let error {
                ContentUnavailableView("Couldn't open the space", systemImage: "exclamationmark.triangle", description: Text(error))
            } else if noPage {
                ContentUnavailableView(
                    "No page for this space", systemImage: "doc.richtext",
                    description: Text("A space opens as a page. Turn on BB Pages to see it."))
            } else {
                ProgressView()
            }
        }
        .task {
            do {
                if case .page(let id)? = try await client.spacePage(id).flatMap(Route.init(href:)) {
                    pageId = id
                } else {
                    noPage = true
                }
            } catch {
                self.error = BBClient.describe(error, server: client.baseURL)
            }
        }
    }
}

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
                if let current, !isNew {
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
            operation.complete(on: app) { dismiss() }
            operation.complete(on: app) { done(nil) }
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
    }
}

// MARK: A thread's spaces

/// The spaces a thread or channel is in, for its menu.
@MainActor
final class ThreadSpacesModel: ObservableObject {
    @Published private(set) var held: ThreadSpaces?
    @Published private(set) var all: [StudioSpace] = []

    func load(_ threadId: String, client: BBClient) async {
        held = try? await client.spacesForThread(threadId)
        all = held == nil ? [] : (try? await client.studioSpaces()) ?? []
    }

    var others: [StudioSpace] { all.filter { space in held?.spaces.contains { $0.id == space.id } != true } }
    var removable: [StudioSpace] { (held?.spaces ?? []).filter { held?.inherited.contains($0.id) != true } }
    var available: Bool { held.map { !$0.spaces.isEmpty || !all.isEmpty } ?? false }

    func change(_ space: StudioSpace, add: Bool, threadId: String, client: BBClient) async throws {
        let ref = (pluginId: StudioSpace.threadRef, id: threadId)
        try await client.spaceMembers(space.id, add: add ? [ref] : [], remove: add ? [] : [ref])
        await load(threadId, client: client)
    }
}

/// A submenu that opens the thread's spaces, adds it to another, or takes it out of one.
struct ThreadSpacesMenu: View {
    @ObservedObject var model: ThreadSpacesModel
    let threadId: String
    var failed: (String) -> Void
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }

    var body: some View {
        if model.available, let held = model.held {
            Menu {
                if !held.spaces.isEmpty {
                    Section("In spaces") {
                        ForEach(held.spaces) { space in
                            Button { operation.complete(on: app) { app.push(.space(id: space.id)) } } label: {
                                Label(held.inherited.contains(space.id) ? "\(name(space)) · Project" : name(space), systemImage: "arrow.up.right")
                            }
                        }
                    }
                }
                if !model.others.isEmpty {
                    Section("Add to space") {
                        ForEach(model.others) { space in
                            Button { change(space, add: true) } label: { Label(name(space), systemImage: "plus") }
                        }
                    }
                }
                if !model.removable.isEmpty {
                    Section {
                        ForEach(model.removable) { space in
                            Button { change(space, add: false) } label: { Label("Remove from \(space.name)", systemImage: "xmark") }
                        }
                    }
                }
            } label: {
                Label(held.spaces.isEmpty ? "Add to Space" : "Spaces: \(held.spaces.map(\.name).joined(separator: ", "))",
                    systemImage: "square.stack.3d.up")
            }
        }
    }

    private func name(_ space: StudioSpace) -> String {
        space.emoji.map { "\($0) \(space.name)" } ?? space.name
    }

    private func change(_ space: StudioSpace, add: Bool) {
        Task {
            do {
                try await model.change(space, add: add, threadId: threadId, client: client)
            } catch {
                failed(BBClient.describe(error, server: client.baseURL))
            }
        }
    }
}
