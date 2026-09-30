import SwiftUI

/// A channel's members, how it picks who answers, and the permissions its bots run with.
/// Archive and delete are here too.
struct ChannelDetailsSheet: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var room: Room
    let bots: [Bot]
    /// The channel after a change, or nil once it's deleted.
    let changed: (Room?) -> Void
    @State private var error: String?
    @State private var saving = false
    @State private var confirmingDelete = false

    init(room: Room, bots: [Bot], changed: @escaping (Room?) -> Void) {
        _room = State(initialValue: room)
        self.bots = bots
        self.changed = changed
    }

    /// Current bots, plus any retired one still in the channel so it can be taken out.
    private var choices: [Bot] {
        bots.filter { $0.retired != true || room.memberIds.contains($0.id) }
    }

    private var mode: String { room.responseBehavior ?? "everyone" }

    var body: some View {
        NavigationStack {
            Form {
                if let error { Text(error).font(.footnote).foregroundStyle(.red) }
                Section {
                    ChoiceRow(title: "Mode", options: Room.modes.map { ($0.id, $0.name, $0.detail) }, selection: mode) {
                        update(["responseBehavior": .string($0)])
                    }
                    ChoiceRow(title: "Permissions", options: Room.permissions.map { ($0.id ?? "", $0.name, $0.detail) }, selection: room.permissionMode ?? "") {
                        update(["permissionMode": $0.isEmpty ? .null : .string($0)])
                    }
                } footer: {
                    Text(Room.modes.first { $0.id == mode }?.detail ?? "")
                }
                Section("Members") {
                    ForEach(choices) { bot in
                        let member = room.memberIds.contains(bot.id)
                        Button {
                            Task { await toggle(bot, member: member) }
                        } label: {
                            HStack {
                                BotRow(bot: bot)
                                if member { Image(systemName: "checkmark").foregroundStyle(.tint) }
                            }
                        }
                        .foregroundStyle(.primary)
                        .disabled(saving || (!member && room.memberIds.count >= 16))
                        .accessibilityAddTraits(member ? .isSelected : [])
                    }
                    if choices.isEmpty { Text("No bots yet.").foregroundStyle(.secondary) }
                }
                Section {
                    Button {
                        update(["archived": .bool(true)], close: true)
                    } label: {
                        Label("Archive Channel", systemImage: "archivebox")
                    }
                    Button(role: .destructive) { confirmingDelete = true } label: {
                        Label("Delete Channel", systemImage: "trash")
                    }
                }
            }
            .disabled(saving)
            .navigationTitle("#\(room.name)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .confirmationDialog("Delete #\(room.name)?", isPresented: $confirmingDelete, titleVisibility: .visible) {
                Button("Delete Channel", role: .destructive) { Task { await delete() } }
            } message: {
                Text("Its messages go too. Bot work threads stay. This can't be undone.")
            }
        }
    }

    private func update(_ fields: [String: JSONValue], close: Bool = false) {
        Task {
            saving = true
            defer { saving = false }
            do {
                room = try await app.client.setRoomState(room.id, fields)
                error = nil
                changed(room)
                if close { dismiss() }
            } catch {
                self.error = BBClient.describe(error, server: app.client.baseURL)
            }
        }
    }

    private func toggle(_ bot: Bot, member: Bool) async {
        saving = true
        defer { saving = false }
        do {
            room = try await app.client.setRoomMember(room.id, bot: bot.id, present: !member)
            error = nil
            changed(room)
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }

    private func delete() async {
        saving = true
        defer { saving = false }
        do {
            try await app.client.deleteRoom(room.id)
            changed(nil)
            dismiss()
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }
}

/// A setting's current choice; tap for every option with what it does.
private struct ChoiceRow: View {
    let title: String
    let options: [(id: String, name: String, detail: String)]
    let selection: String
    let choose: (String) -> Void

    var body: some View {
        NavigationLink {
            ChoiceList(title: title, options: options, selection: selection, choose: choose)
        } label: {
            LabeledContent(title, value: options.first { $0.id == selection }?.name ?? "")
        }
    }
}

private struct ChoiceList: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    let options: [(id: String, name: String, detail: String)]
    let selection: String
    let choose: (String) -> Void

    var body: some View {
        List(options, id: \.id) { option in
            Button {
                if option.id != selection { choose(option.id) }
                dismiss()
            } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(option.name)
                        Text(option.detail).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if option.id == selection { Image(systemName: "checkmark").foregroundStyle(.tint) }
                }
            }
            .foregroundStyle(.primary)
            .accessibilityAddTraits(option.id == selection ? .isSelected : [])
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Name a channel and pick who's in it.
struct NewChannelSheet: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    let created: (Room) -> Void
    @State private var name = ""
    @State private var members: Set<String> = []
    @State private var bots: [Bot]?
    @State private var creating = false
    @State private var error: String?
    @FocusState private var focused: Bool

    private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            Form {
                if let error { Text(error).font(.footnote).foregroundStyle(.red) }
                Section {
                    TextField("Channel name", text: $name)
                        .focused($focused)
                        .submitLabel(.done)
                        .accessibilityIdentifier("channelNameField")
                }
                Section("Members") {
                    if let bots {
                        ForEach(bots.filter { $0.retired != true }) { bot in
                            let member = members.contains(bot.id)
                            Button {
                                if member { members.remove(bot.id) } else if members.count < 16 { members.insert(bot.id) }
                            } label: {
                                HStack {
                                    BotRow(bot: bot)
                                    if member { Image(systemName: "checkmark").foregroundStyle(.tint) }
                                }
                            }
                            .foregroundStyle(.primary)
                            .accessibilityAddTraits(member ? .isSelected : [])
                        }
                    } else if error == nil {
                        ProgressView().frame(maxWidth: .infinity)
                    }
                }
            }
            .navigationTitle("New Channel")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") { Task { await create() } }.disabled(trimmed.isEmpty || creating)
                }
            }
            .task {
                focused = true
                do {
                    bots = try await app.client.botTeams().bots
                } catch {
                    self.error = BBClient.describe(error, server: app.client.baseURL)
                }
            }
        }
        .interactiveDismissDisabled(!trimmed.isEmpty)
    }

    private func create() async {
        creating = true
        defer { creating = false }
        do {
            let room = try await app.client.createRoom(name: trimmed, memberIds: (bots ?? []).map(\.id).filter(members.contains))
            dismiss()
            created(room)
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }
}
