import SwiftUI

/// Type something now, decide where it goes after. The draft survives closing
/// the sheet, so a half-written thought is still there next time.
struct QuickWriteView: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @AppStorage("quickWriteDraft") private var text = ""
    @AppStorage("runningPlugins") private var runningPlugins = ""
    @FocusState private var focused: Bool
    @State private var dictating = false
    @State private var startingThread = false
    @State private var saving = false
    @State private var error: String?

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
    private func running(_ id: String) -> Bool { runningPlugins.split(separator: ",").contains(Substring(id)) }

    var body: some View {
        NavigationStack {
            ZStack(alignment: .topLeading) {
                if text.isEmpty {
                    Text("Write something…")
                        .foregroundStyle(.tertiary)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 8)
                        .allowsHitTesting(false)
                }
                TextEditor(text: $text)
                    .focused($focused)
                    .scrollContentBackground(.hidden)
                    .accessibilityIdentifier("quickWriteText")
            }
            .padding(.horizontal)
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 8) {
                    if let error { Text(error).font(.footnote).foregroundStyle(.red) }
                    HStack {
                        Button { dictating = true } label: {
                            Label("Dictate", systemImage: "mic.fill").labelStyle(.iconOnly)
                        }
                        .accessibilityIdentifier("quickWriteDictate")
                        Spacer()
                        if !trimmed.isEmpty {
                            Text("\(trimmed.split(whereSeparator: \.isWhitespace).count) words")
                                .font(.footnote).foregroundStyle(.secondary).monospacedDigit()
                        }
                    }
                    .font(.title3)
                }
                .padding(.horizontal)
                .padding(.vertical, 10)
                .background(.bar)
            }
            .navigationTitle("Write")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { saveMenu }
            }
            .sheet(isPresented: $dictating) {
                DictationView(threadId: nil, autoStart: true, insertLabel: ("Insert", "text.insert")) { spoken in
                    text = text.isEmpty ? spoken : text + (text.hasSuffix("\n") ? "" : "\n\n") + spoken
                    focused = true
                }
            }
            .sheet(isPresented: $startingThread) { NewThreadView(text: trimmed) }
            .onAppear { focused = true }
        }
    }

    /// Save makes a page; the menu offers the other homes for it.
    private var saveMenu: some View {
        Menu {
            if running("pages") {
                Button("Save as Page", systemImage: "doc.richtext") { Task { await savePage() } }
            }
            if running("studio-tasks") {
                Button("Save as Task", systemImage: "checklist") { Task { await saveTask() } }
            }
            Button("Start a Thread", systemImage: "bubble.left.and.text.bubble.right") { startingThread = true }
            Button("Copy", systemImage: "doc.on.doc") {
                UIPasteboard.general.string = trimmed
                text = ""
                dismiss()
            }
        } label: {
            if saving { ProgressView() } else { Text("Save").fontWeight(.semibold) }
        } primaryAction: {
            Task { running("pages") ? await savePage() : await saveTask() }
        }
        .disabled(trimmed.isEmpty || saving)
        .accessibilityIdentifier("quickWriteSave")
    }

    private func savePage() async {
        await attempt {
            let page = try await app.client.createPage(title: PageTitle.from(trimmed), markdown: trimmed)
            app.openPage(page.id)
        }
    }

    /// First line is the title; the rest is the description.
    private func saveTask() async {
        let lines = trimmed.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false)
        let first = String(lines.first ?? "")
        let title = first.count > 120 ? PageTitle.from(first) : first
        var description = lines.count > 1 ? String(lines[1]).trimmingCharacters(in: .whitespacesAndNewlines) : ""
        if first.count > 120 { description = trimmed }
        let project = UserDefaults.standard.string(forKey: "studioProject") ?? ""
        await attempt {
            let task = try await app.client.createTask(
                title: title, description: description, projectId: project.isEmpty || project == "none" ? nil : project,
                due: nil, assignee: nil)
            app.openStudio(kind: nil, .task(id: task.id))
        }
    }

    private func attempt(_ work: () async throws -> Void) async {
        saving = true
        defer { saving = false }
        do {
            try await work()
            text = ""
            dismiss()
            Task { await StudioStore.shared.load(app.client) }
        } catch {
            self.error = (error as? BBError)?.message ?? BBClient.describe(error, server: app.client.baseURL)
        }
    }
}

/// Add tasks one after another: return adds and clears the field for the next.
struct QuickTaskView: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool
    @State private var title = ""
    @State private var due: Due = .none
    @State private var forAgent = false
    @State private var added: [StudioTask] = []
    @State private var adding = false
    @State private var dictating = false
    @State private var error: String?

    enum Due: String, CaseIterable {
        case none = "No date", today = "Today", tomorrow = "Tomorrow"

        var day: String? {
            switch self {
            case .none: nil
            case .today: StudioTask.day(.now)
            case .tomorrow: StudioTask.day(Calendar.current.date(byAdding: .day, value: 1, to: .now) ?? .now)
            }
        }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        TextField("New task", text: $title, axis: .vertical)
                            .focused($focused)
                            .submitLabel(.done)
                            .onChange(of: title) { _, value in
                                // Return in a vertical field arrives as a newline: treat it as submit.
                                guard value.contains("\n") else { return }
                                title = value.replacingOccurrences(of: "\n", with: "")
                                Task { await add() }
                            }
                            .accessibilityIdentifier("quickTaskTitle")
                        if adding {
                            ProgressView()
                        } else {
                            Button { dictating = true } label: { Image(systemName: "mic.fill") }
                                .buttonStyle(.borderless)
                                .accessibilityLabel("Dictate")
                        }
                    }
                    Picker("Due", selection: $due) {
                        ForEach(Due.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .listRowSeparator(.hidden)
                    Toggle("For an agent", isOn: $forAgent)
                } footer: {
                    if let error { Text(error).foregroundStyle(.red) }
                }
                if !added.isEmpty {
                    Section("Added") {
                        ForEach(added.reversed()) { task in
                            Button {
                                dismiss()
                                app.openStudio(kind: nil, .task(id: task.id))
                            } label: {
                                Label {
                                    Text(task.title).foregroundStyle(.primary)
                                } icon: {
                                    Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                                }
                            }
                            .accessibilityIdentifier("quickTaskAdded")
                        }
                    }
                }
            }
            .navigationTitle("New Tasks")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Board") {
                        dismiss()
                        app.openStudio(kind: nil, .tasks)
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(title.trimmingCharacters(in: .whitespaces).isEmpty ? "Done" : "Add") {
                        if title.trimmingCharacters(in: .whitespaces).isEmpty { dismiss() } else { Task { await add() } }
                    }
                    .fontWeight(.semibold)
                    .accessibilityIdentifier("quickTaskAdd")
                }
            }
            .sheet(isPresented: $dictating) {
                DictationView(threadId: nil, autoStart: true, insertLabel: ("Use as Task", "checklist")) { spoken in
                    title = spoken
                    Task { await add() }
                }
            }
            .onAppear { focused = true }
            .onDisappear { if !added.isEmpty { Task { await StudioStore.shared.load(app.client) } } }
        }
        .presentationDetents([.medium, .large])
    }

    private func add() async {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !adding else { return }
        adding = true
        defer { adding = false }
        let project = UserDefaults.standard.string(forKey: "studioProject") ?? ""
        do {
            let task = try await app.client.createTask(
                title: trimmed, description: "", projectId: project.isEmpty || project == "none" ? nil : project,
                due: due.day, assignee: forAgent ? "agent" : nil)
            added.append(task)
            title = ""
            error = nil
            focused = true
        } catch {
            self.error = (error as? BBError)?.message ?? BBClient.describe(error, server: app.client.baseURL)
        }
    }
}
