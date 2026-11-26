import SwiftUI

/// Skills: Auto-learn and Run now on top, as on the desktop; + New skill;
/// then each on-demand skill with its trigger line and when it was last used.
struct SkillsLayerView: View {
    let store: MemoryStore
    /// False on the unfolded Duo, where + New skill is in the bar.
    var newSkillRow = true

    var body: some View {
        List {
            if let learning = store.learning.value {
                AutoLearnSection(store: store, learning: learning)
            }
            if let notice = store.notice {
                Label(notice, systemImage: "exclamationmark.triangle").font(.footnote).foregroundStyle(.secondary)
                    .accessibilityIdentifier("memoryNotice")
            }
            if let skills = store.skills.value {
                SkillRows(store: store, skills: skills.filter(\.listed), newSkillRow: newSkillRow)
            }
        }
        .listStyle(.plain)
        .overlay { MemoryLoadState(load: store.skills) { store.loadSkills(force: true) } }
        .refreshable { await store.refresh(.skills) }
        .task(id: ObjectIdentifier(store)) { store.loadSkills() }
        .accessibilityIdentifier("memory-skills")
    }
}

private struct SkillRows: View {
    let store: MemoryStore
    let skills: [MemorySkill]
    let newSkillRow: Bool

    var body: some View {
        if newSkillRow {
            Button { Router.shared.push(.memoryNewSkill(botId: store.botId)) } label: {
                Label("New skill", systemImage: "plus").foregroundStyle(.tint)
            }
            .accessibilityIdentifier("memorySkillNew")
        }
        if skills.isEmpty {
            ContentUnavailableView("No skills yet", systemImage: "wand.and.stars",
                                   description: Text("The Bot saves a way of working as a skill when it will come up again."))
                .listRowSeparator(.hidden)
        }
        ForEach(skills) { skill in
            // On the shell's stack, from either page: its title line and rail on the Duo.
            Button { Router.shared.push(.memorySkill(botId: store.botId, name: skill.name)) } label: {
                HStack {
                    SkillRow(skill: skill)
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                }
                .contentShape(.rect)
            }
            .tint(.primary)
            .accessibilityIdentifier("memorySkill-\(skill.name)")
        }
    }
}

private struct SkillRow: View {
    let skill: MemorySkill
    @Environment(\.look) private var look

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(skill.name)
            Text(skill.description).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            HStack(spacing: 6) {
                if skill.stale { Text("Stale").foregroundStyle(look.warningText) }
                Text(skill.lastUsed())
            }
            .font(.caption).foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

/// Auto-learn (daily and when a conversation is archived), its last run, and Run now.
private struct AutoLearnSection: View {
    let store: MemoryStore
    let learning: SkillLearning
    /// The switch's state until the reload after it lands.
    @State private var pending: Bool?

    var body: some View {
        let enabled = pending ?? learning.enabled
        Section {
            Toggle(isOn: Binding(get: { enabled }, set: { next in pending = next; Task { await store.setLearning(next); pending = nil } })) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Auto-learn")
                    Text("Daily + on archive").font(.subheadline).foregroundStyle(.secondary)
                }
            }
            .disabled(store.busy && pending == nil)
            .sensoryFeedback(.selection, trigger: enabled)
            .accessibilityIdentifier("memoryAutoLearn")
            HStack {
                Text(learning.status()).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                    .accessibilityIdentifier("memoryAutoLearnStatus")
                Spacer(minLength: 8)
                Button("Run now") { Task { await store.runLearning() } }
                    .buttonStyle(.bordered)
                    .disabled(store.busy || !enabled || learning.reviewing)
                    .accessibilityIdentifier("memoryAutoLearnRun")
            }
        }
        .listSectionSeparator(.hidden)
    }
}

/// A skill, pushed: what it's for, its text (editable), and its versions.
struct SkillScreen: View {
    let store: MemoryStore
    let skill: MemorySkill
    @State private var history = PageLoad<[SkillVersion]>()
    @State private var editing = false

    private var currentText: String? { history.value?.first { $0.body != nil }?.body }

    var body: some View {
        Group {
            if editing, let text = currentText {
                SkillEditor(store: store, skill: skill, text: text) { saved in
                    editing = false
                    if saved { history.retry() }
                }
            } else {
                SkillReader(store: store, skill: skill, history: history)
            }
        }
        // Edit in the iPhone's bar, the Duo's rail; the editor's own actions replace it while editing.
        .screenToolbar(skill.name, actions: !editing && currentText != nil
            ? [ScreenAction(id: "skillEdit", title: "Edit", systemImage: "pencil") { editing = true }] : [])
        .task { load() }
        .accessibilityIdentifier("skill-page")
    }

    private func load() {
        let (client, botId, name) = (store.client, store.botId, skill.name)
        history.describe = { BBClient.describe($0, server: client.baseURL) }
        history.run(key: "\(client.baseURL.absoluteString)|\(botId ?? "")|\(name)") { try await client.memorySkillHistory(botId: botId, name: name) }
    }
}

private struct SkillReader: View {
    let store: MemoryStore
    let skill: MemorySkill
    let history: PageLoad<[SkillVersion]>

    var body: some View {
        List {
            Section {
                Text(skill.description).accessibilityIdentifier("skillDescription")
                Text(skill.lastUsed()).font(.footnote).foregroundStyle(.secondary)
            }
            if let text = history.value?.first(where: { $0.body != nil })?.body {
                Section("Instructions") {
                    Text(text).font(.system(.footnote, design: .monospaced)).textSelection(.enabled)
                        .accessibilityIdentifier("skillBody")
                }
            }
            if let versions = history.value {
                SkillVersions(store: store, versions: versions) { history.retry() }
            }
            if let error = history.error {
                PageLoadErrorRow(message: error, id: "skillRetry") { history.retry() }
            }
        }
        .overlay { if history.waiting { ProgressView() } }
        .refreshable { await history.reload() }
    }
}

/// The versions, newest first; any but the newest can be restored.
private struct SkillVersions: View {
    let store: MemoryStore
    let versions: [SkillVersion]
    var reverted: () -> Void
    @State private var confirming: SkillVersion?

    var body: some View {
        Section("Versions") {
            ForEach(Array(versions.enumerated()), id: \.element.id) { index, version in
                SkillVersionRow(version: version, current: index == 0) { confirming = version }
            }
        }
        .confirmationDialog("Restore this version?", isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }),
                            titleVisibility: .visible, presenting: confirming) { version in
            Button("Restore") { Task { if await store.revert(version) { reverted() } } }
                .accessibilityIdentifier("skillRevertConfirm")
        } message: { _ in
            Text("The text now stays in the history.")
        }
    }
}

private struct SkillVersionRow: View {
    let version: SkillVersion
    let current: Bool
    var revert: () -> Void

    var body: some View {
        DisclosureGroup {
            Text(version.diff.isEmpty ? "No text change" : version.diff)
                .font(.system(.caption, design: .monospaced))
                .textSelection(.enabled)
            if !current, version.body != nil {
                Button("Restore this version", systemImage: "arrow.uturn.backward", action: revert)
                    .accessibilityIdentifier("skillRevert-\(version.id)")
            }
        } label: {
            HStack {
                Text(MemoryFormat.shortDate(version.at) + (current ? " · Current" : ""))
                Spacer()
                Text(version.change).font(.caption).monospacedDigit().foregroundStyle(.secondary)
            }
        }
        .accessibilityIdentifier("skillVersion-\(version.id)")
    }
}

/// Edits a skill's trigger line and text; saved only over the text it began from.
private struct SkillEditor: View {
    let store: MemoryStore
    let skill: MemorySkill
    var done: (_ saved: Bool) -> Void
    @State private var description: String
    @State private var text: String
    @State private var base: String
    @State private var conflict: String?
    @State private var error: String?
    @State private var saving = false
    @State private var saved = 0

    init(store: MemoryStore, skill: MemorySkill, text: String, done: @escaping (Bool) -> Void) {
        self.store = store
        self.skill = skill
        self.done = done
        _description = State(initialValue: skill.description)
        _text = State(initialValue: text)
        _base = State(initialValue: text)
    }

    private var ready: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !saving }

    var body: some View {
        Form {
            Section("When to use it") {
                TextField("When to use it, in one sentence", text: $description, axis: .vertical)
                    .lineLimit(1...4)
                    .accessibilityIdentifier("skillDescriptionField")
            }
            Section("Instructions") {
                TextField("The steps and the pitfalls", text: $text, axis: .vertical)
                    .font(.system(.footnote, design: .monospaced))
                    .lineLimit(8...40)
                    .accessibilityIdentifier("skillBodyField")
            }
            if let conflict {
                Section { MemoryConflictNote(text: conflict) }
            }
            if let error { Section { Text(error).foregroundStyle(.red).font(.footnote) } }
        }
        .screenActions([
            ScreenAction(id: "skillSave", title: conflict == nil ? "Save" : "Replace", systemImage: "checkmark", disabled: !ready) { Task { await save() } },
            ScreenAction(id: "skillCancel", title: "Cancel", systemImage: "xmark") { done(false) },
        ])
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { done(false) } }
            ToolbarItem(placement: .confirmationAction) {
                Button(conflict == nil ? "Save" : "Replace") { Task { await save() } }
                    .disabled(!ready)
                    .accessibilityIdentifier("skillSave")
            }
        }
        .navigationBarBackButtonHidden()
        .sensoryFeedback(.success, trigger: saved)
    }

    private func save() async {
        saving = true
        defer { saving = false }
        error = nil
        let trigger = description.trimmingCharacters(in: .whitespacesAndNewlines)
        switch await store.saveSkill(name: skill.name, base: base, description: trigger.isEmpty ? skill.description : trigger, body: text) {
        case .saved:
            saved += 1
            done(true)
        case .conflict(let newer):
            conflict = newer
            base = newer
        case .failed(let message):
            error = message
        }
    }
}

/// A skill or section that changed while you edited: what it says now.
struct MemoryConflictNote: View {
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("This changed while you edited. Now it reads:")
            Text(text.isEmpty ? "(empty)" : text).foregroundStyle(.secondary).lineLimit(12)
            Text("Save again to replace it with yours.")
        }
        .font(.footnote)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("memoryConflict")
    }
}

/// + New skill: a name, when to use it, and the instructions.
struct NewSkillScreen: View {
    let store: MemoryStore
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var description = ""
    @State private var text = ""
    @State private var error: String?
    @State private var saving = false

    private var problem: String? {
        MemorySkill.nameProblem(name, taken: (store.skills.value ?? []).map(\.name))
    }

    private var ready: Bool {
        !name.isEmpty && problem == nil && !saving
            && !description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        Form {
            Section {
                TextField("weekly-review", text: Binding(get: { name }, set: { name = $0.lowercased().replacingOccurrences(of: " ", with: "-") }))
                    .font(.system(.body, design: .monospaced))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("newSkillName")
            } header: { Text("Name") } footer: { if let problem { Text(problem) } }
            Section("When to use it") {
                TextField("When to use it, in one sentence", text: $description, axis: .vertical)
                    .lineLimit(1...4)
                    .accessibilityIdentifier("newSkillDescription")
            }
            Section("Instructions") {
                TextField("The steps and the pitfalls", text: $text, axis: .vertical)
                    .font(.system(.footnote, design: .monospaced))
                    .lineLimit(6...30)
                    .accessibilityIdentifier("newSkillBody")
            }
            if let error { Section { Text(error).foregroundStyle(.red).font(.footnote) } }
        }
        .navigationTitle("New skill")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") { Task { await save() } }.disabled(!ready).accessibilityIdentifier("newSkillSave")
            }
        }
        // On the Duo the bar hides: Save is in the rail.
        .screenActions([ScreenAction(id: "newSkillSave", title: "Save", systemImage: "checkmark", disabled: !ready) { Task { await save() } }])
    }

    private func save() async {
        saving = true
        defer { saving = false }
        error = await store.addSkill(name: name, description: description.trimmingCharacters(in: .whitespacesAndNewlines), body: text)
        if error == nil { dismiss() }
    }
}

/// A skill by name, pushed on the shell's stack: found in its Bot's Memory.
struct MemorySkillRoute: View {
    let botId: String?
    let name: String
    @EnvironmentObject private var app: AppModel

    var body: some View {
        let store = MemoryStore.shared(botId: botId, client: app.client)
        if let skill = store.skills.value?.first(where: { $0.name == name }) {
            SkillScreen(store: store, skill: skill)
        } else {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                .task { if store.skills.value == nil { store.loadSkills() } }
        }
    }
}
