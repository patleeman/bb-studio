import SwiftUI

/// Studio Tasks' board: a column at a time, To do through Done, each task
/// with its due day, who it's for, and where its agent stands.
struct TasksView: View {
    @EnvironmentObject private var app: AppModel
    @AppStorage("tasksColumn") private var column = "todo"
    @State private var tasks: [StudioTask] = []
    @State private var loaded = false
    @State private var error: String?
    @State private var creating = false
    @State private var showArchived = false
    @State private var listener: UUID?
    @State private var reload: Task<Void, Never>?

    private var shown: [StudioTask] {
        tasks.filter { $0.status == column && $0.archived == showArchived }
    }

    var body: some View {
        List {
            Section {
                Picker("Column", selection: $column) {
                    ForEach(StudioTask.statuses, id: \.self) { status in
                        let count = tasks.filter { $0.status == status && $0.archived == showArchived }.count
                        Text(count > 0 ? "\(StudioTask.statusLabel(status)) \(count)" : StudioTask.statusLabel(status)).tag(status)
                    }
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }
            if let error {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
            Section {
                ForEach(shown) { task in
                    NavigationLink(value: Route.task(id: task.id)) { TaskRow(task: task) }
                        .swipeActions(edge: .leading) {
                            if let next = next(task.status) {
                                Button { Task { await move(task, to: next) } } label: {
                                    Label(StudioTask.statusLabel(next), systemImage: next == "done" ? "checkmark.circle" : "arrow.right")
                                }
                                .tint(next == "done" ? .green : .blue)
                            }
                        }
                        .swipeActions(edge: .trailing) {
                            Button { Task { await archive(task) } } label: {
                                Label(task.archived ? "Restore" : "Archive", systemImage: task.archived ? "tray.and.arrow.up" : "archivebox")
                            }
                            .tint(.orange)
                        }
                        .contextMenu { menu(task) }
                }
            }
        }
        .overlay {
            if loaded, shown.isEmpty, error == nil {
                ContentUnavailableView(
                    showArchived ? "No archived tasks" : "Nothing in \(StudioTask.statusLabel(column))",
                    systemImage: "checklist",
                    description: Text(column == "todo" && !showArchived ? "Add a task for you or an agent." : ""))
            } else if !loaded, error == nil {
                ProgressView()
            }
        }
        .navigationTitle(showArchived ? "Archived Tasks" : "Tasks")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { creating = true } label: { Label("New Task", systemImage: "plus") }
            }
            ToolbarItem(placement: .secondaryAction) {
                Toggle(isOn: $showArchived) { Label("Show Archived", systemImage: "archivebox") }
            }
        }
        .refreshable { await load() }
        .sheet(isPresented: $creating) {
            TaskEditor(task: nil, status: column) { created in
                if let created { app.path.append(.task(id: created.id)) }
            }
        }
        .task(id: showArchived) { await load() }
        .task {
            listener = app.realtime.listen { event in
                switch event {
                case .pluginSignal("studio-tasks", _, _), .connected: scheduleReload()
                default: break
                }
            }
        }
        .onDisappear { if let listener { app.realtime.removeListener(listener) } }
    }

    @ViewBuilder
    private func menu(_ task: StudioTask) -> some View {
        Menu {
            ForEach(StudioTask.statuses.filter { $0 != task.status }, id: \.self) { status in
                Button(StudioTask.statusLabel(status)) { Task { await move(task, to: status) } }
            }
        } label: { Label("Move to", systemImage: "arrow.right.square") }
        Button { Task { await archive(task) } } label: {
            Label(task.archived ? "Restore from Archive" : "Archive", systemImage: task.archived ? "tray.and.arrow.up" : "archivebox")
        }
    }

    private func next(_ status: String) -> String? {
        switch status {
        case "todo": "in_progress"
        case "in_progress": "review"
        case "review": "done"
        default: nil
        }
    }

    private func scheduleReload() {
        reload?.cancel()
        reload = Task {
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            await load()
        }
    }

    private func load() async {
        do {
            tasks = try await app.client.tasksBoard(includeArchived: showArchived)
            error = nil
        } catch where !BBClient.isCancellation(error) {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        } catch {}
        loaded = true
    }

    private func move(_ task: StudioTask, to status: String) async {
        do {
            try await app.client.moveTask(task.id, to: status)
            await load()
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }

    private func archive(_ task: StudioTask) async {
        do {
            try await app.client.archiveTask(task.id, archived: !task.archived)
            await load()
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }
}

struct TaskRow: View {
    let task: StudioTask

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(task.displayTitle).font(.body.weight(.medium)).lineLimit(2)
            HStack(spacing: 8) {
                if let due = task.due {
                    Label(StudioTask.formatDue(due), systemImage: "calendar")
                        .foregroundStyle(task.isOverdue ? .red : .secondary)
                }
                if let assignee = task.assignee {
                    Label(assignee == "me" ? "You" : "Agent", systemImage: assignee == "me" ? "person" : "sparkles")
                        .foregroundStyle(.secondary)
                }
                if let handoff = task.handoff {
                    TaskHandoffBadge(handoff: handoff, short: true)
                }
                if task.links > 0 {
                    Label("\(task.links)", systemImage: "link").foregroundStyle(.secondary)
                }
            }
            .font(.caption)
            .labelStyle(.titleAndIcon)
        }
        .padding(.vertical, 2)
    }
}

struct TaskHandoffBadge: View {
    let handoff: TaskHandoff
    var short = false

    private var tint: Color {
        switch handoff.state {
        case "starting": .blue
        case "working": .purple
        case "needs-input": .orange
        case "replied", "ready": .green
        case "failed": .red
        default: .gray
        }
    }

    var body: some View {
        Text(short ? handoff.shortLabel : handoff.label)
            .font(.caption.weight(.medium))
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .foregroundStyle(tint)
            .background(tint.opacity(0.14), in: .capsule)
    }
}

/// One task: its description, links and handoffs, with the board's actions.
struct TaskView: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    let id: String
    @State private var detail: TaskDetail?
    @State private var error: String?
    @State private var chatting = false
    @State private var editing = false
    @State private var handingOff = false
    @State private var addingLink = false
    @State private var sendingBack = false
    @State private var feedback = ""
    @State private var confirmingDelete = false
    @State private var notice: String?
    @State private var listener: UUID?

    var body: some View {
        Group {
            if let task = detail?.task {
                content(task)
            } else if detail != nil {
                ContentUnavailableView("Task not found", systemImage: "checklist", description: Text("It may have been deleted."))
            } else if let error {
                ContentUnavailableView("Couldn't open the task", systemImage: "exclamationmark.triangle", description: Text(error))
            } else {
                ProgressView()
            }
        }
        .overlay(alignment: .bottom) {
            if let notice {
                Text(notice)
                    .font(.subheadline.weight(.medium))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(.regularMaterial, in: .capsule)
                    .padding(.bottom, 12)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.snappy, value: notice)
        .navigationTitle(detail?.task?.displayTitle ?? "Task")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let task = detail?.task {
                ToolbarItem(placement: .primaryAction) { menu(task) }
            }
        }
        .studioChat(
            isPresented: $chatting, pluginId: "studio-tasks", itemId: id, title: detail?.task?.displayTitle ?? "Task",
            projectId: detail?.task?.projectId)
        .sheet(isPresented: $editing) {
            if let task = detail?.task { TaskEditor(task: task, status: task.status) { _ in Task { await load() } } }
        }
        .sheet(isPresented: $handingOff) {
            if let task = detail?.task {
                HandOffSheet(task: task) { threadId in
                    Task { await load() }
                    app.path.append(.thread(id: threadId))
                }
            }
        }
        .sheet(isPresented: $addingLink) {
            if let task = detail?.task {
                TaskLinkPicker(projectId: task.projectId, linked: Set((detail?.links ?? []).map { "\($0.target):\($0.pluginId ?? ""):\($0.itemId)" })) { link in
                    await run("Linked") { try await app.client.linkTask(id, link: link) }
                }
            }
        }
        .alert("Send Back to the Agent", isPresented: $sendingBack) {
            TextField("Feedback", text: $feedback, axis: .vertical)
            Button("Cancel", role: .cancel) { feedback = "" }
            Button("Send") { Task { await sendBack() } }
        } message: {
            Text("Goes to the agent's thread, and the task moves back to In progress.")
        }
        .confirmationDialog(
            "Delete \u{201C}\(detail?.task?.displayTitle ?? "")\u{201D}?", isPresented: $confirmingDelete, titleVisibility: .visible
        ) {
            Button("Delete Task", role: .destructive) { Task { await delete() } }
        } message: {
            Text("Its threads stay. This can't be undone.")
        }
        .task {
            listener = app.realtime.listen { event in
                guard case .pluginSignal("studio-tasks", _, let payload) = event else { return }
                if let changed = payload["taskId"]?.stringValue, changed != id { return }
                Task { await load() }
            }
            await load()
        }
        .onDisappear { if let listener { app.realtime.removeListener(listener) } }
    }

    private func content(_ task: StudioTask) -> some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text(task.displayTitle).font(.title3.weight(.semibold))
                    if let handoff = task.handoff { TaskHandoffBadge(handoff: handoff) }
                }
                .padding(.vertical, 4)
                Menu {
                    ForEach(StudioTask.statuses, id: \.self) { status in
                        Button { Task { await move(to: status) } } label: {
                            if status == task.status {
                                Label(StudioTask.statusLabel(status), systemImage: "checkmark")
                            } else {
                                Text(StudioTask.statusLabel(status))
                            }
                        }
                    }
                } label: {
                    LabeledContent("Status", value: StudioTask.statusLabel(task.status))
                }
                .accessibilityIdentifier("taskStatus")
                if let due = task.due {
                    LabeledContent("Due") {
                        Text(StudioTask.formatDue(due)).foregroundStyle(task.isOverdue ? .red : .secondary)
                    }
                }
                LabeledContent("For", value: task.assignee == "me" ? "You" : task.assignee == "agent" ? "An agent" : "Nobody yet")
                LabeledContent("Project", value: task.projectId.map { StudioStore.shared.projectNames[$0] ?? $0 } ?? "None")
            }
            if !task.description.isEmpty {
                Section("Description") {
                    MarkdownText(task.description).textSelection(.enabled).padding(.vertical, 4)
                }
            }
            Section {
                if task.handoff?.isOpen == true {
                    Button { sendingBack = true } label: { Label("Send Back with Feedback", systemImage: "arrowshape.turn.up.left") }
                }
                Button { handingOff = true } label: {
                    Label(task.handoff == nil ? "Hand to an Agent" : "Hand to Another Agent", systemImage: "sparkles")
                }
                if task.status != "done" {
                    Button { Task { await move(to: "done") } } label: { Label("Mark Done", systemImage: "checkmark.circle") }
                } else if task.openThreads > 0 {
                    Button { Task { await archiveThreads() } } label: {
                        Label(task.openThreads == 1 ? "Archive Its Thread" : "Archive Its \(task.openThreads) Threads", systemImage: "archivebox")
                    }
                }
            }
            if let handoffs = detail?.handoffs, !handoffs.isEmpty {
                Section("Handoffs") {
                    ForEach(handoffs, id: \.threadId) { handoff in
                        NavigationLink(value: Route.thread(id: handoff.threadId)) {
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    TaskHandoffBadge(handoff: handoff)
                                    Spacer()
                                    Text(Date(timeIntervalSince1970: handoff.createdAt / 1000), style: .relative)
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                if let note = handoff.note, !note.isEmpty {
                                    Text(note).font(.subheadline).foregroundStyle(.secondary).lineLimit(3)
                                }
                            }
                        }
                        .disabled(handoff.state == "deleted")
                    }
                }
            }
            Section("Links") {
                ForEach(detail?.links ?? [], id: \.self) { link in
                    linkRow(link)
                        .swipeActions {
                            Button(role: .destructive) { Task { await unlink(link) } } label: { Label("Remove", systemImage: "link.badge.minus") }
                        }
                }
                Button { addingLink = true } label: { Label("Add Link…", systemImage: "link.badge.plus") }
                    .accessibilityIdentifier("addTaskLink")
            }
        }
    }

    @ViewBuilder
    private func linkRow(_ link: TaskLink) -> some View {
        let label = Label(link.label.isEmpty ? link.itemId : link.label, systemImage: link.target == "thread" ? "bubble.left.and.bubble.right" : icon(link.pluginId))
        if link.target == "thread" {
            NavigationLink(value: Route.thread(id: link.itemId)) { label }
        } else if let route = link.href.flatMap(Route.init(href:)) {
            NavigationLink(value: route) { label }
        } else if let href = link.href, let url = URL(string: href, relativeTo: app.client.baseURL) {
            Link(destination: url) { label }
        } else {
            label
        }
    }

    private func icon(_ pluginId: String?) -> String {
        switch pluginId {
        case "pages": "doc.richtext"
        case "talk": "waveform"
        case "excalidraw": "scribble.variable"
        case "artifacts": "doc.text.image"
        case "studio-tasks": "checklist"
        default: "square.dashed"
        }
    }

    private func menu(_ task: StudioTask) -> some View {
        Menu {
            Button { editing = true } label: { Label("Edit", systemImage: "pencil") }
            StudioChatMenuButton(isPresented: $chatting)
            ShareLink(item: app.client.baseURL.appending(path: "plugins/studio-tasks/tasks/\(task.id)")) {
                Label("Share Link", systemImage: "square.and.arrow.up")
            }
            Button { Task { await archive(task) } } label: {
                Label(task.archived ? "Restore from Archive" : "Archive", systemImage: task.archived ? "tray.and.arrow.up" : "archivebox")
            }
            Button(role: .destructive) { confirmingDelete = true } label: { Label("Delete", systemImage: "trash") }
        } label: {
            Label("More", systemImage: "ellipsis")
        }
    }

    private func load() async {
        do {
            detail = try await app.client.task(id)
            error = nil
        } catch where !BBClient.isCancellation(error) {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        } catch {}
    }

    private func run(_ message: String? = nil, _ action: () async throws -> Void) async {
        do {
            try await action()
            await load()
            if let message { flash(message) }
        } catch {
            flash((error as? BBError)?.message ?? BBClient.describe(error, server: app.client.baseURL))
        }
    }

    private func flash(_ text: String) {
        notice = text
        Task {
            try? await Task.sleep(for: .seconds(2.5))
            if notice == text { notice = nil }
        }
    }

    private func move(to status: String) async {
        await run {
            let archived = try await app.client.moveTask(id, to: status)
            if archived > 0 { flash(archived == 1 ? "Archived its thread" : "Archived \(archived) threads") }
        }
    }

    private func archive(_ task: StudioTask) async {
        await run(task.archived ? "Restored" : "Archived") { try await app.client.archiveTask(id, archived: !task.archived) }
    }

    private func archiveThreads() async {
        await run {
            let result = try await app.client.archiveTaskThreads(id)
            flash(result.failed > 0 ? "Archived \(result.archived), \(result.failed) failed" : "Archived \(result.archived)")
        }
    }

    private func unlink(_ link: TaskLink) async {
        await run { try await app.client.unlinkTask(id, link: link) }
    }

    private func sendBack() async {
        let message = feedback.trimmingCharacters(in: .whitespacesAndNewlines)
        feedback = ""
        guard !message.isEmpty else { return }
        await run("Sent to the agent") { _ = try await app.client.sendBackTask(id, message: message) }
    }

    private func delete() async {
        do {
            try await app.client.deleteTask(id)
            dismiss()
        } catch {
            flash(BBClient.describe(error, server: app.client.baseURL))
        }
    }
}

/// A new task, or an existing one's fields.
struct TaskEditor: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    let task: StudioTask?
    let status: String
    var done: (StudioTask?) -> Void
    @State private var title = ""
    @State private var description = ""
    @State private var hasDue = false
    @State private var due = Date()
    @State private var assignee = ""
    @State private var projectId = ""
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Title", text: $title).accessibilityIdentifier("taskTitle")
                    TextField("Description (Markdown)", text: $description, axis: .vertical).lineLimit(4...12)
                }
                Section {
                    Toggle("Due", isOn: $hasDue.animation())
                    if hasDue { DatePicker("Day", selection: $due, displayedComponents: .date) }
                    Picker("For", selection: $assignee) {
                        Text("Nobody yet").tag("")
                        Text("You").tag("me")
                        Text("An agent").tag("agent")
                    }
                    Picker("Project", selection: $projectId) {
                        Text("None").tag("")
                        ForEach(projects, id: \.id) { Text($0.name).tag($0.id) }
                    }
                }
                if let error {
                    Text(error).foregroundStyle(.red).font(.footnote)
                }
            }
            .navigationTitle(task == nil ? "New Task" : "Edit Task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(task == nil ? "Add" : "Save") { Task { await save() } }
                        .disabled(saving || title.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear(perform: fill)
        }
    }

    private var projects: [(id: String, name: String)] {
        StudioStore.shared.projectNames
            .sorted { $0.value.localizedStandardCompare($1.value) == .orderedAscending }
            .map { ($0.key, $0.value) }
    }

    private func fill() {
        guard let task else {
            projectId = UserDefaults.standard.string(forKey: "studioProject") ?? ""
            return
        }
        title = task.title
        description = task.description
        if let day = task.due, let date = StudioTask.date(day) {
            hasDue = true
            due = date
        }
        assignee = task.assignee ?? ""
        projectId = task.projectId ?? ""
    }

    private func save() async {
        saving = true
        defer { saving = false }
        let day = hasDue ? StudioTask.day(due) : nil
        do {
            if let task {
                try await app.client.updateTask(
                    task.id, title: title.trimmingCharacters(in: .whitespaces), description: description,
                    projectId: projectId.isEmpty ? nil : projectId, due: day, assignee: assignee.isEmpty ? nil : assignee)
                done(nil)
            } else {
                let created = try await app.client.createTask(
                    title: title.trimmingCharacters(in: .whitespaces), description: description, status: status,
                    projectId: projectId.isEmpty ? nil : projectId, due: day, assignee: assignee.isEmpty ? nil : assignee)
                done(created)
            }
            dismiss()
        } catch {
            self.error = (error as? BBError)?.message ?? BBClient.describe(error, server: app.client.baseURL)
        }
    }
}

/// Hands a task to the project's default agent in a new thread.
/// Pages, drawings, artifacts, recordings and threads a task can point to.
private struct TaskLinkPicker: View {
    let projectId: String?
    let linked: Set<String>
    let pick: (TaskLink) async -> Void
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var items: [TaskLinkable]?
    @State private var query = ""
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Group {
                if let items {
                    let shown = items.filter { !linked.contains($0.id) && (query.isEmpty || $0.label.localizedCaseInsensitiveContains(query)) }
                    if shown.isEmpty {
                        ContentUnavailableView(query.isEmpty ? "Nothing to link" : "No matches", systemImage: "link")
                    } else {
                        List(shown) { item in
                            Button {
                                Task {
                                    await pick(item.link)
                                    dismiss()
                                }
                            } label: {
                                HStack {
                                    Label(item.label.isEmpty ? "Untitled" : item.label, systemImage: symbol(item))
                                        .foregroundStyle(.primary)
                                    Spacer()
                                    Text(item.kind).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                } else if let error {
                    ContentUnavailableView("Couldn't load", systemImage: "exclamationmark.triangle", description: Text(error))
                } else {
                    ProgressView()
                }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always))
            .navigationTitle("Add Link")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .task {
                do {
                    items = try await app.client.taskLinkables(projectId: projectId)
                } catch {
                    self.error = BBClient.describe(error, server: app.client.baseURL)
                }
            }
        }
    }

    private func symbol(_ item: TaskLinkable) -> String {
        if item.target == "thread" { return "bubble.left.and.bubble.right" }
        switch item.pluginId {
        case "pages": return "doc.richtext"
        case "talk": return "waveform"
        case "excalidraw": return "scribble.variable"
        case "artifacts": return "doc.text.image"
        default: return "square.dashed"
        }
    }
}

private struct HandOffSheet: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    let task: StudioTask
    var started: (String) -> Void
    @State private var note = ""
    @State private var projectId = ""
    @State private var workspace = "worktree"
    @State private var starting = false
    @State private var error: String?
    // The agent. Empty means the project's default.
    @State private var defaults: ExecutionChoice?
    @State private var options: ExecutionOptions?
    @State private var providerId = ""
    @State private var modelId = ""
    @State private var reasoning = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Project", selection: $projectId) {
                        if task.projectId == nil { Text("Choose…").tag("") }
                        ForEach(projects, id: \.id) { Text($0.name).tag($0.id) }
                    }
                    Picker("Work in", selection: $workspace) {
                        Text("A new worktree").tag("worktree")
                        Text("The project's folder").tag("folder")
                    }
                } footer: {
                    Text("Starts a thread whose first message is the task and its links; the task follows the thread to Review.")
                }
                Section("Agent") {
                    Picker("Provider", selection: $providerId) {
                        Text(defaultLabel(defaults?.providerId.map { id in options?.providers.first { $0.id == id }?.displayName ?? id }))
                            .tag("")
                        ForEach(options?.providers.filter { $0.available != false } ?? []) { Text($0.displayName).tag($0.id) }
                    }
                    Picker("Model", selection: $modelId) {
                        Text(defaultLabel(defaultModelName)).tag("")
                        ForEach(options?.models ?? []) { Text($0.displayName).tag($0.id) }
                    }
                    if !reasoningLevels.isEmpty {
                        Picker("Reasoning", selection: $reasoning) {
                            Text(defaultLabel(providerId.isEmpty && modelId.isEmpty ? defaults?.reasoningLevel : nil)).tag("")
                            ForEach(reasoningLevels, id: \.self) { Text($0.capitalized).tag($0) }
                        }
                    }
                }
                Section("Note for the agent") {
                    TextField("Optional", text: $note, axis: .vertical).lineLimit(3...8)
                }
                if let error {
                    Text(error).foregroundStyle(.red).font(.footnote)
                }
            }
            .navigationTitle("Hand to an Agent")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Start") { Task { await start() } }.disabled(starting || projectId.isEmpty)
                }
            }
            .onAppear { projectId = task.projectId ?? "" }
            .task(id: projectId) {
                guard !projectId.isEmpty else { return }
                defaults = (try? await app.client.projectDefaults(projectId)) ?? nil
                if providerId.isEmpty { await loadOptions() }
            }
            .task(id: providerId) {
                modelId = ""
                reasoning = ""
                await loadOptions()
            }
        }
    }

    private func loadOptions() async {
        options = try? await app.client.executionOptions(providerId: providerId.isEmpty ? defaults?.providerId : providerId)
    }

    private var selectedModel: ExecutionOptions.Model? {
        let id = modelId.isEmpty && providerId.isEmpty ? defaults?.model : modelId
        return options?.models.first { $0.id == id || $0.model == id } ?? options?.models.first { $0.isDefault == true }
    }

    private var defaultModelName: String? {
        guard providerId.isEmpty else { return options?.models.first { $0.isDefault == true }?.displayName }
        return defaults?.model.map { id in options?.models.first { $0.id == id || $0.model == id }?.displayName ?? id }
    }

    private var reasoningLevels: [String] { selectedModel?.supportedReasoningEfforts?.map(\.reasoningEffort) ?? [] }

    private func defaultLabel(_ value: String?) -> String { value.map { "Default (\($0))" } ?? "Default" }

    private var projects: [(id: String, name: String)] {
        StudioStore.shared.projectNames
            .sorted { $0.value.localizedStandardCompare($1.value) == .orderedAscending }
            .map { ($0.key, $0.value) }
    }

    private func start() async {
        starting = true
        defer { starting = false }
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let threadId = try await app.client.handOffTask(
                task.id, projectId: projectId, providerId: providerId.isEmpty ? nil : providerId,
                model: modelId.isEmpty ? nil : modelId, reasoningLevel: reasoning.isEmpty ? nil : reasoning,
                note: trimmed.isEmpty ? nil : trimmed, workspace: workspace)
            dismiss()
            started(threadId)
        } catch {
            self.error = (error as? BBError)?.message ?? BBClient.describe(error, server: app.client.baseURL)
        }
    }
}

/// `::task{id="tsk_…"}` in a reply: the task's title, column and agent state.
struct TaskCard: View {
    @EnvironmentObject private var app: AppModel
    let id: String
    @State private var task: StudioTask?
    @State private var missing = false

    var body: some View {
        NavigationLink(value: Route.task(id: id)) {
            HStack(spacing: 12) {
                Image(systemName: task?.status == "done" ? "checkmark.circle.fill" : "checklist")
                    .font(.body.weight(.medium))
                    .foregroundStyle(.green)
                    .frame(width: 44, height: 44)
                    .background(Color.green.opacity(0.12), in: .rect(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 3) {
                    Text(task?.displayTitle ?? (missing ? "Deleted task" : "Task"))
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(missing ? .secondary : .primary)
                        .lineLimit(2)
                    if let task {
                        HStack(spacing: 6) {
                            Text(StudioTask.statusLabel(task.status))
                            if let due = task.due {
                                Text("· \(StudioTask.formatDue(due))").foregroundStyle(task.isOverdue ? .red : .secondary)
                            }
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
            }
            .padding(10)
            .frame(maxWidth: 420, alignment: .leading)
            .background(.fill.quaternary, in: .rect(cornerRadius: 14))
            .contentShape(.rect(cornerRadius: 14))
        }
        .buttonStyle(.plain)
        .disabled(missing)
        .accessibilityIdentifier("taskCard")
        .task(id: id) {
            guard let detail = try? await app.client.task(id) else { return }
            task = detail.task
            missing = detail.task == nil
        }
    }
}
