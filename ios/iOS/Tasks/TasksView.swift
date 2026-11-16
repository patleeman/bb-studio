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
    @State private var unfolded: Set<String> = []
    @FocusState private var addFocused: Bool
    @EnvironmentObject private var app: AppModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.showTaskDetail) private var showDetail
    @Environment(\.shownTaskDetail) private var shownDetail
    @Environment(\.openTaskThread) private var openThread

    var body: some View {
        if model.supported == false {
            LoopsView(attention: nil, openChat: openChat, sidebar: sidebar)
        } else {
            list
        }
    }

    private var list: some View {
        let nodes = model.board.map(TaskTree.nodes) ?? []
        let tree = TasksBoardShape(nodes)
        let shown = tree.shown(model.tasks.filter { owner.matches($0, botThreadId: model.botThreadId) })
        let sections = TaskRules.sections(shown)
        let asks = owner == .all || owner == .mine ? model.areaAsks : []
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
                mine(today: sections[.today] ?? [], later: sections[.later] ?? [], asks: asks, tree: tree)
                ForEach([TaskSection.agents, .waiting, .scheduled], id: \.self) { section in
                    if let tasks = sections[section], !tasks.isEmpty {
                        Section(section.title) { ForEach(tasks) { row($0, tree: tree) } }
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
                if model.list != nil && sections.values.allSatisfy(\.isEmpty) && asks.isEmpty {
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
            .onAppear { model.tasksShown += 1 }
            .onDisappear { model.tasksShown = max(0, model.tasksShown - 1) }
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
        await model.refresh(full: true)
    }

    @ViewBuilder
    private func mine(today: [TaskItem], later: [TaskItem], asks: [AreaAsk], tree: TasksBoardShape) -> some View {
        if !today.isEmpty || !asks.isEmpty {
            let needs = today.filter(\.needsYou), rest = today.filter { !$0.needsYou }
            Section {
                ForEach(needs) { row($0, tree: tree) }
                ForEach(asks) { ask in AreaAskRow(ask: ask, open: { openArea(ask) }) }
                ForEach(rest) { row($0, tree: tree) }
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
                ForEach(later) { row($0, tree: tree) }
            } header: {
                if today.isEmpty && asks.isEmpty {
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

    private func openArea(_ ask: AreaAsk) {
        if let thread = ask.ownerThread {
            if let openThread { openThread(thread) } else { app.openTaskThread(thread) }
        } else {
            openChat()
        }
    }

    private func openChild(_ id: String) {
        if let showDetail { return showDetail(id) }
        withAnimation(reduceMotion ? nil : .smooth(duration: 0.2)) { expanded = expanded == id ? nil : id }
    }

    private func openThreadOf(_ id: String) {
        if let openThread { openThread(id) } else { app.openTaskThread(id) }
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
    private func row(_ task: TaskItem, tree: TasksBoardShape = TasksBoardShape([])) -> some View {
        let open = expanded == task.id && showDetail == nil
        let node = task.isMine ? nil : tree.node(task.id)
        let below = node?.belowText
        let folded = unfolded.contains(task.id)
        VStack(alignment: .leading, spacing: 10) {
            TaskRow(task: task, names: model.names, expanded: open || shownDetail == task.id) {
                if let showDetail {
                    showDetail(task.id)
                } else {
                    withAnimation(reduceMotion ? nil : .smooth(duration: 0.2)) { expanded = open ? nil : task.id }
                }
            }
            if let node, let below {
                FlightFoldButton(node: node, text: below, open: folded) {
                    withAnimation(reduceMotion ? nil : .smooth(duration: 0.2)) {
                        if folded { unfolded.remove(task.id) } else { unfolded.insert(task.id) }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityIdentifier("tasks-fold-\(task.id)")
                if folded {
                    FlightChildren(node: node, names: model.names, depth: 0, openTask: openChild, openThread: openThreadOf)
                    if let child = expanded, child != task.id, tree.top(of: child) == task.id, showDetail == nil {
                        TaskCard(id: child, expanded: true).padding(.bottom, 4)
                    }
                }
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

struct TasksBoardShape {
    private var nodes: [String: FlightNode] = [:]
    private var nested: Set<String> = []
    private var tops: [String: String] = [:]

    init(_ roots: [FlightNode]) {
        func walk(_ node: FlightNode, top: String?) {
            nodes[node.task.id] = node
            if let top { nested.insert(node.task.id); tops[node.task.id] = top }
            for child in node.children { walk(child, top: top ?? node.task.id) }
        }
        for root in roots { walk(root, top: nil) }
    }

    func top(of id: String) -> String? { tops[id] }

    func node(_ id: String) -> FlightNode? { nested.contains(id) ? nil : nodes[id] }
    func top(_ task: TaskItem) -> Bool { !nested.contains(task.id) }

    func folds(_ task: TaskItem) -> Bool { top(task) && !task.isMine && node(task.id)?.belowText != nil }

    func shown(_ tasks: [TaskItem]) -> [TaskItem] {
        let folding = Set(tasks.filter(folds).map(\.id))
        return tasks.filter { top($0) || $0.isMine || !folding.contains(top(of: $0.id) ?? "") }
    }
}

struct AreaAskRow: View {
    let ask: AreaAsk
    let open: () -> Void

    var body: some View {
        let age = AreaRules.age(ask)
        Button(action: open) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Circle().fill(Color.orange).frame(width: 8, height: 8).frame(width: 14).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(ask.title).lineLimit(2).foregroundStyle(.primary)
                    Text([ask.area, age].filter { !$0.isEmpty }.joined(separator: " · ")).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 6)
                TaskChip(text: "Needs you", tone: .warning)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(AreaRules.label(ask))
        .accessibilityHint(ask.ownerThread == nil ? "Opens the chat" : "Opens who looks after \(ask.area)")
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("tasks-area-ask-\(ask.areaId)")
    }
}
