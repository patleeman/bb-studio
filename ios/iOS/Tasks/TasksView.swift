import SwiftUI

struct TasksView: View {
    var openChat: () -> Void
    var sidebar = false
    @State private var model = TasksModel.shared
    @State private var adding = ""
    @State private var addError: String?
    @State private var owner = TaskOwnerFilter.all
    @State private var expanded: String?
    @State private var showsDone = false
    @State private var loading = false
    @FocusState private var addFocused: Bool
    @EnvironmentObject private var app: AppModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if model.supported == false {
            LoopsView(attention: nil, openChat: openChat, sidebar: sidebar)
        } else {
            list
        }
    }

    private var list: some View {
        let shown = model.tasks.filter { owner.matches($0, botThreadId: model.botThreadId) }
        let sections = TaskRules.sections(shown)
        return ScrollViewReader { proxy in
            List {
                Section {
                    addField
                    TaskOwnerChips(owner: $owner)
                        .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                }
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                if model.list == nil, let error = model.listError {
                    Section {
                        VStack(alignment: .leading, spacing: 10) {
                            Label(error, systemImage: "wifi.exclamationmark").foregroundStyle(.secondary)
                            Button("Retry") { Task { await reload() } }
                                .buttonStyle(.bordered)
                                .accessibilityIdentifier("tasks-retry")
                        }
                        .padding(.vertical, 4)
                    }
                } else if model.list == nil {
                    Section { HStack { Spacer(); ProgressView(); Spacer() }.listRowBackground(Color.clear) }
                }
                let today = sections[.today] ?? [], later = sections[.later] ?? []
                if !today.isEmpty || !later.isEmpty {
                    if !today.isEmpty {
                        Section {
                            ForEach(today) { row($0) }
                        } header: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Mine").font(.caption2.weight(.semibold)).foregroundStyle(.tertiary)
                                Text("Today")
                            }
                            .accessibilityElement(children: .combine)
                            .accessibilityLabel("Mine, Today")
                        }
                    }
                    if !later.isEmpty {
                        Section {
                            ForEach(later) { row($0) }
                        } header: {
                            if today.isEmpty {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Mine").font(.caption2.weight(.semibold)).foregroundStyle(.tertiary)
                                    Text("Later")
                                }
                                .accessibilityElement(children: .combine)
                                .accessibilityLabel("Mine, Later")
                            } else {
                                Text("Later")
                            }
                        }
                    }
                }
                ForEach([TaskSection.agents, .waiting, .scheduled], id: \.self) { section in
                    if let tasks = sections[section], !tasks.isEmpty {
                        Section(section.title) { ForEach(tasks) { row($0) } }
                    }
                }
                if let done = sections[.done], !done.isEmpty {
                    Section {
                        if showsDone { ForEach(done) { row($0) } }
                    } header: {
                        Button { withAnimation(reduceMotion ? nil : .default) { showsDone.toggle() } } label: {
                            HStack {
                                Text("\(done.count) done")
                                Spacer()
                                Image(systemName: showsDone ? "chevron.down" : "chevron.right")
                            }
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("tasks-done-toggle")
                        .accessibilityValue(showsDone ? "Shown" : "Hidden")
                    }
                }
                if model.list != nil && sections.values.allSatisfy(\.isEmpty) {
                    Section {
                        if model.tasks.isEmpty {
                            ContentUnavailableView("No tasks yet", systemImage: "checkmark.circle",
                                                   description: Text("Add one above. When \(LoopsModel.shared.botName) or an agent needs you, it shows here and in the chat."))
                                .accessibilityIdentifier("tasks-empty")
                        } else {
                            ContentUnavailableView {
                                Label("No tasks match this filter", systemImage: "line.3.horizontal.decrease.circle")
                            } actions: {
                                Button("Show all") { owner = .all }.accessibilityIdentifier("tasks-show-all")
                            }
                            .accessibilityIdentifier("tasks-empty-filter")
                        }
                    }
                    .listRowBackground(Color.clear)
                }
            }
            .listStyle(.insetGrouped)
            .modifier(SidebarListMargins(enabled: sidebar))
            .accessibilityIdentifier("tasks-screen")
            .refreshable { await reload() }
            .task { await reload() }
            .onChange(of: model.focus, initial: true) { _, focus in
                guard let focus else { return }
                model.focus = nil
                expanded = focus
                if model.task(focus)?.isClosed == true { showsDone = true }
                Task {
                    if model.task(focus) == nil { await model.load(focus) }
                    guard let task = model.task(focus), TaskRules.section(task) != .today else { return }
                    try? await Task.sleep(for: .milliseconds(250))
                    withAnimation(reduceMotion ? nil : .default) { proxy.scrollTo(focus) }
                }
            }
        }
    }

    private func reload() async {
        await model.refresh()
    }

    private var addField: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 10) {
                Image(systemName: "plus").foregroundStyle(.secondary)
                TextField("Add a task for yourself", text: $adding)
                    .focused($addFocused)
                    .submitLabel(.done)
                    .onSubmit(add)
                    .accessibilityIdentifier("tasks-add")
                    .accessibilityHint("Adds it to your Today list")
            }
            .padding(.horizontal, 14).frame(minHeight: 48)
            .background(Color(uiColor: .secondarySystemBackground), in: .rect(cornerRadius: 14, style: .continuous))
            if let addError { Text(addError).font(.caption).foregroundStyle(.orange) }
        }
    }

    private func add() {
        let text = adding.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        adding = ""
        addError = nil
        Task {
            do { try await model.add(text) } catch {
                adding = text
                addError = BBClient.describe(error)
            }
        }
    }

    @ViewBuilder
    private func row(_ task: TaskItem) -> some View {
        let open = expanded == task.id
        VStack(alignment: .leading, spacing: 10) {
            TaskRow(task: task, names: model.names, expanded: open) {
                withAnimation(reduceMotion ? nil : .smooth(duration: 0.2)) { expanded = open ? nil : task.id }
            }
            if open {
                TaskCard(id: task.id, expanded: true)
                    .padding(.bottom, 4)
            }
        }
        .id(task.id)
        .contextMenu { TaskMenu(task: task, names: model.names) }
    }
}

@MainActor
enum TaskOwnerFilter: String, CaseIterable, Identifiable {
    case all, mine, bot, agents

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: "Everyone"
        case .mine: "You"
        case .bot: LoopsModel.shared.botName
        case .agents: "Agents"
        }
    }

    func matches(_ task: TaskItem, botThreadId: String?) -> Bool {
        let bot = task.owner == "cos" || (botThreadId.map { task.owner == "thread:\($0)" } ?? false)
        switch self {
        case .all: return true
        case .mine: return task.isMine
        case .bot: return bot
        case .agents: return !task.isMine && !bot
        }
    }
}

private struct TaskOwnerChips: View {
    @Binding var owner: TaskOwnerFilter

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(TaskOwnerFilter.allCases) { filter in
                    Button { owner = filter } label: {
                        Text(filter.title).font(.subheadline)
                            .padding(.horizontal, 14).frame(minHeight: 34)
                            .background(owner == filter ? AnyShapeStyle(Color.accentColor.opacity(0.22)) : AnyShapeStyle(.fill.tertiary), in: .capsule)
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(owner == filter ? .isSelected : [])
                    .accessibilityIdentifier("tasks-owner-\(filter.rawValue)")
                }
            }
        }
    }
}

struct TaskRow: View {
    let task: TaskItem
    let names: TaskNames
    var expanded = false
    let toggle: () -> Void

    var body: some View {
        let status = TaskRules.status(task)
        Button(action: toggle) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                TaskGlyph(status: status)
                VStack(alignment: .leading, spacing: 2) {
                    Text(task.title).lineLimit(expanded ? nil : 2).foregroundStyle(task.isClosed ? .secondary : .primary)
                    if let sub = subtitle(status) {
                        Text(sub).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                    }
                }
                Spacer(minLength: 6)
                if let severity = TaskRules.severity(task) { TaskChip(text: severity.label, tone: severity.tone) }
                if task.needsYou {
                    TaskChip(text: "Needs you", tone: .warning)
                }
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint(expanded ? "Hides the task card" : "Shows the task card")
        .accessibilityIdentifier("task-row-\(task.id)")
        .accessibilityValue(status.id)
    }

    private func subtitle(_ status: TaskStatus) -> String? {
        var parts: [String] = []
        if !task.isMine { parts.append(names.short(task)) }
        if task.isRecurring, let text = task.scheduleText { parts.append(text) }
        if let detail = TaskRules.detail(task) { parts.append(detail) }
        else if task.isMine, !task.isClosed, let date = task.date {
            let day = LoopFormat.day(date)
            parts.append(day == "Today" ? day : "Due \(day)")
        }
        if task.isClosed || task.stale || (!task.isMine && !task.needsYou) { parts.append(status.label) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

struct TaskMenu: View {
    let task: TaskItem
    let names: TaskNames
    var open: (() -> Void)?
    var perform: ((TaskAction) -> Void)?
    @EnvironmentObject private var app: AppModel

    var body: some View {
        if let open { Button { open() } label: { Label("Open", systemImage: "rectangle.portrait.on.rectangle.portrait") } }
        if !task.isClosed && !task.isRecurring {
            if task.isMine {
                if task.kind == .decide, !task.options.isEmpty {
                    Section("Choose") {
                        ForEach(task.options, id: \.self) { option in Button(LoopOption(option).title) { act(.choose(option)) } }
                    }
                } else {
                    Button { act(task.kind == .read ? .gotIt : .done) } label: { Label(task.kind == .read ? "Got it" : "Done", systemImage: "checkmark") }
                }
                if task.canSnooze {
                    Menu {
                        ForEach(LoopSnooze.presets, id: \.self) { snooze in Button(snooze.label) { act(.snooze(snooze)) } }
                    } label: { Label("Snooze", systemImage: "clock") }
                }
            } else {
                Button { act(.takeBack) } label: { Label("Take back", systemImage: "arrow.uturn.backward") }
            }
            Menu {
                ForEach(names.targets(for: task), id: \.owner) { target in Button(target.name) { act(.handOff(target.owner)) } }
            } label: { Label("Hand off", systemImage: "arrowshape.turn.up.right") }
            Button(role: .destructive) { act(.drop) } label: { Label("Dismiss", systemImage: "xmark") }
        }
    }

    private func act(_ action: TaskAction) {
        if let perform { return perform(action) }
        Task {
            do {
                if let note = try await TasksModel.shared.perform(task.id, action) { app.flash(note) }
            } catch {
                app.flash("Couldn't update the task: \(BBClient.describe(error))")
            }
        }
    }
}
