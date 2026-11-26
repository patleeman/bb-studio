import SwiftUI

/// Core: what the Bot always reads. The core skill's sections, each edited
/// in place, under the budget all always-on skills share.
struct CoreLayerView: View {
    let store: MemoryStore
    /// The section being edited ("skill:heading").
    @State private var editing: String?

    var body: some View {
        List {
            if let core = store.core.value {
                CoreBudgetRow(chars: core.chars, cap: core.cap)
                if let error = store.core.error {
                    PageLoadErrorRow(message: error, id: "memoryCoreRetry") { store.loadCore(force: true) }
                }
                CoreSections(store: store, core: core, editing: $editing)
                if !core.warnings.isEmpty { CoreWarnings(warnings: core.warnings) }
            }
        }
        .listStyle(.plain)
        .overlay { MemoryLoadState(load: store.core) { store.loadCore(force: true) } }
        .refreshable { await store.refresh(.core) }
        .task(id: ObjectIdentifier(store)) { store.loadCore() }
        .accessibilityIdentifier("memory-core")
    }
}

private struct CoreSections: View {
    let store: MemoryStore
    let core: MemoryCore
    @Binding var editing: String?

    var body: some View {
        if let skill = core.coreSkill {
            ForEach(CoreText.coreSections(skill.body)) { section in
                CoreSectionRow(store: store, skill: skill.name, heading: section.heading, section: section.heading, text: section.text,
                               cap: CoreText.cap(for: section.heading), editing: $editing)
            }
        } else {
            ContentUnavailableView("No always-on skill", systemImage: "brain",
                                   description: Text("The Bot's core skill holds its preferences and check-in list."))
                .listRowSeparator(.hidden)
        }
        ForEach(core.otherSkills) { skill in
            CoreSectionRow(store: store, skill: skill.name, heading: skill.name, section: nil, text: skill.body, cap: nil, editing: $editing)
        }
    }
}

/// "Always on · 1,420 / 2,000 chars" over a meter; past 90% it says "Near limit".
private struct CoreBudgetRow: View {
    let chars: Int
    let cap: Int
    @Environment(\.look) private var look

    var body: some View {
        let level = MemoryBudget.level(chars: chars, cap: cap)
        VStack(spacing: 6) {
            HStack {
                Text("Always on")
                Spacer()
                if level != .fine { Text(level == .over ? "Over limit" : "Near limit").fontWeight(.semibold) }
                Text(MemoryBudget.label(chars: chars, cap: cap)).monospacedDigit()
            }
            .font(.footnote)
            .foregroundStyle(level == .fine ? AnyShapeStyle(.secondary) : AnyShapeStyle(look.warningText))
            ProgressView(value: MemoryBudget.fraction(chars: chars, cap: cap))
                .tint(level == .fine ? look.accent : look.warningText)
        }
        .padding(.vertical, 6)
        .listRowSeparator(.hidden)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Always on, \(chars) of \(cap) characters" + (level == .fine ? "" : level == .over ? ", over the limit" : ", near the limit"))
        .accessibilityIdentifier("memoryBudget")
    }
}

/// One section: its heading, line count and text; tap it or Edit to edit in place.
private struct CoreSectionRow: View {
    let store: MemoryStore
    let skill: String
    let heading: String
    /// The section's heading in the skill, or nil when the row is a whole other always-on skill.
    let section: String?
    let text: String
    let cap: Int?
    @Binding var editing: String?

    private var id: String { "\(skill):\(heading)" }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if editing == id {
                CoreSectionEditor(store: store, skill: skill, heading: heading, section: section, text: text, cap: cap) { editing = nil }
            } else {
                CoreSectionHeader(heading: heading, text: text, cap: cap, edit: { editing = id })
                Button { editing = id } label: { CoreLines(text: text) }
                    .buttonStyle(.plain)
                    .accessibilityHint("Edits \(heading)")
            }
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("memorySection-\(heading)")
    }
}

private struct CoreSectionHeader: View {
    let heading: String
    let text: String
    let cap: Int?
    /// Nil while editing: the row has no Edit button then.
    var edit: (() -> Void)?
    @Environment(\.look) private var look

    var body: some View {
        HStack(spacing: 8) {
            Text(heading).font(.body.weight(.semibold)).accessibilityAddTraits(.isHeader)
            Spacer(minLength: 8)
            if let cap {
                let over = CoreText.bulletCount(text) > cap
                Text(MemoryBudget.lines(text, cap: cap)).font(.caption).monospacedDigit()
                    .foregroundStyle(over ? AnyShapeStyle(look.warningText) : AnyShapeStyle(.secondary))
            }
            if let edit {
                Button("Edit", action: edit)
                    .font(.subheadline)
                    .foregroundStyle(look.accent)
                    .buttonStyle(.borderless)
                    .frame(minHeight: 44)
                    .accessibilityLabel("Edit \(heading)")
                    .accessibilityIdentifier("memorySectionEdit")
            }
        }
        .frame(minHeight: 44)
    }
}

/// A section's lines without their bullet marks; "Add a line" when empty.
private struct CoreLines: View {
    let text: String

    var body: some View {
        let lines = text.split(separator: "\n").map(Self.clean).filter { !$0.isEmpty }
        VStack(alignment: .leading, spacing: 3) {
            if lines.isEmpty {
                Text("Add a line").foregroundStyle(.secondary)
            }
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                Text(line).foregroundStyle(.primary.opacity(0.85))
            }
        }
        .font(.subheadline)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(.rect)
    }

    static func clean(_ line: Substring) -> String {
        SummaryText.inline(String(line).replacing(/^\s{0,3}(?:[-*+]|\d+[.)])\s+/, with: ""))
    }
}

/// The section's text in an editor. Saving goes into the skill's latest text;
/// if this section changed meanwhile, its newer text shows and nothing is saved
/// until you save again.
private struct CoreSectionEditor: View {
    let store: MemoryStore
    let skill: String
    let heading: String
    let section: String?
    let cap: Int?
    var done: () -> Void
    @State private var draft: String
    /// The text the edit started from: a reload doesn't touch an open draft.
    @State private var base: String
    @State private var conflict: String?
    @State private var error: String?
    @State private var saving = false
    @State private var saved = 0
    @FocusState private var focused: Bool

    init(store: MemoryStore, skill: String, heading: String, section: String?, text: String, cap: Int?, done: @escaping () -> Void) {
        self.store = store
        self.skill = skill
        self.heading = heading
        self.section = section
        self.cap = cap
        self.done = done
        _draft = State(initialValue: text)
        _base = State(initialValue: text)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            CoreSectionHeader(heading: heading, text: draft, cap: cap, edit: nil)
            TextField("- One line per rule", text: $draft, axis: .vertical)
                .font(.system(.subheadline, design: .monospaced))
                .lineLimit(3...14)
                .focused($focused)
                .padding(8)
                .background(.background.secondary, in: .rect(cornerRadius: 8))
                .accessibilityLabel(heading)
                .accessibilityIdentifier("memorySectionInput")
            if let conflict {
                MemoryConflictNote(text: conflict)
                    .padding(10)
                    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.orange.opacity(0.5)))
            }
            if let error { Text(error).font(.footnote).foregroundStyle(.red) }
            CoreEditorButtons(saving: saving, replacing: conflict != nil, save: { Task { await save() } }, cancel: done)
        }
        .onAppear { focused = true }
        .sensoryFeedback(.success, trigger: saved)
    }

    private func save() async {
        saving = true
        defer { saving = false }
        error = nil
        switch await store.saveCore(skill: skill, section: section, base: base, text: draft) {
        case .saved:
            saved += 1
            done()
        case .conflict(let newer):
            conflict = newer
            base = newer
        case .failed(let message):
            error = message
        }
    }
}

private struct CoreEditorButtons: View {
    let saving: Bool
    let replacing: Bool
    var save: () -> Void
    var cancel: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(replacing ? "Replace" : "Save", action: save)
                .buttonStyle(.borderedProminent)
                .disabled(saving)
                .accessibilityIdentifier("memorySectionSave")
            Button("Cancel", action: cancel)
                .buttonStyle(.borderless)
                .accessibilityIdentifier("memorySectionCancel")
            if saving { ProgressView() }
        }
        .frame(minHeight: 44)
    }
}

private struct CoreWarnings: View {
    let warnings: [String]
    @Environment(\.look) private var look

    var body: some View {
        Section {
            ForEach(warnings, id: \.self) { warning in
                Label(warning, systemImage: "exclamationmark.triangle").font(.footnote)
                    .foregroundStyle(look.warningText)
            }
        }
        .accessibilityIdentifier("memoryCoreWarnings")
    }
}

/// A layer's first load: a spinner, or why it failed with Retry.
struct MemoryLoadState<Value>: View {
    let load: PageLoad<Value>
    var retry: () -> Void

    var body: some View {
        if load.value == nil {
            if let error = load.error {
                PageLoadFailed(title: "Memory didn't load", message: error, id: "memoryRetry", retry: retry)
            } else {
                ProgressView().accessibilityIdentifier("memoryLoading")
            }
        }
    }
}
