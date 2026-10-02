import SwiftUI

struct SavedViewEditor: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    let initial: SavedThreadView?
    let changed: (SavedThreadView) -> Void
    @State private var name: String
    @State private var members: Set<SavedViewMember>
    @State private var bots: [Bot] = []
    @State private var threads: [ThreadEntry] = []
    @State private var saving = false
    @State private var error: String?
    @State private var requestId = UUID().uuidString.lowercased()

    init(initial: SavedThreadView? = nil, changed: @escaping (SavedThreadView) -> Void) {
        self.initial = initial; self.changed = changed
        _name = State(initialValue: initial?.name ?? "")
        _members = State(initialValue: Set(initial?.members ?? []))
    }

    var body: some View {
        NavigationStack {
            Form {
                TextField("View name", text: $name)
                if let error { Text(error).foregroundStyle(.red) }
                Section("Bots") { ForEach(bots) { bot in memberRow(SavedViewMember(kind: "bot", id: bot.id), label: bot.name) } }
                Section("Threads") { ForEach(threads) { thread in memberRow(SavedViewMember(kind: "thread", id: thread.id), label: thread.displayTitle) } }
                if let initial {
                    Section { Button(initial.archived ? "Restore view" : "Archive view") { Task { await archive(initial) } } }
                }
            }
            .disabled(saving)
            .navigationTitle(initial == nil ? "New View" : "Edit View")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { Task { await save() } }.disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || members.count > 32) }
            }
            .task {
                do { bots = try await app.client.profiles(); threads = try await app.client.threads(limit: 100) }
                catch { self.error = BBClient.describe(error, server: app.client.baseURL) }
            }
        }
    }
    private func memberRow(_ member: SavedViewMember, label: String) -> some View {
        Button { if members.contains(member) { members.remove(member) } else { members.insert(member) } } label: {
            HStack { Text(label).foregroundStyle(.primary); Spacer(); if members.contains(member) { Image(systemName: "checkmark") } }
        }.accessibilityAddTraits(members.contains(member) ? .isSelected : [])
    }
    private func save() async {
        saving = true
        defer { saving = false }
        do {
            let chosen = members.sorted { ($0.kind + $0.id) < ($1.kind + $1.id) }
            let view: SavedThreadView
            if let initial { view = try await app.client.updateSavedView(initial, name: name, members: chosen) }
            else { view = try await app.client.createSavedView(name: name, members: chosen, requestId: requestId) }
            changed(view); dismiss()
        } catch { self.error = BBClient.describe(error, server: app.client.baseURL) }
    }
    private func archive(_ view: SavedThreadView) async {
        do { changed(try await app.client.updateSavedView(view, archived: !view.archived)); dismiss() }
        catch { self.error = BBClient.describe(error, server: app.client.baseURL) }
    }
}
