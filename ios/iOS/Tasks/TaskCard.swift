import SwiftUI

struct TaskCard: View {
    let id: String
    var expanded = false
    @State private var model = TasksModel.shared
    @State private var pending: TaskAction?
    @State private var error: String?
    @State private var sheet: TaskCardSheet?
    @State private var showsHistory = false
    @EnvironmentObject private var app: AppModel
    @Environment(\.openTaskThread) private var openThread
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if model.supported == false {
            if id.hasPrefix("loop_") { LoopCard(id: id) } else { TaskNotice(text: "Update BB Studio on your Mac to see this card.", symbol: "arrow.down.circle") }
        } else {
            card
        }
    }

    private var card: some View {
        VStack(spacing: 0) {
            if let view = model.views[id] {
                content(view)
            } else if let failure = model.failures[id] {
                TaskNotice(text: failure, symbol: "questionmark.circle")
            } else {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(Color(uiColor: .secondarySystemBackground))
                    .frame(height: 110)
                    .overlay(ProgressView())
            }
        }
        .animation(reduceMotion ? nil : .smooth(duration: 0.25), value: model.views[id]?.task)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("task-\(id)")
        .task(id: id) { await model.load(id) }
        .sheet(item: $sheet) { sheet in
            if let task = model.views[id]?.task {
                switch sheet {
                case .snooze: LoopSnoozeSheet(loop: task.asLoop) { run(.snooze($0)) }
                case .choose: TaskChooseSheet(task: task) { run(.choose($0)) }
                }
            }
        }
    }

    @ViewBuilder
    private func content(_ view: TaskView) -> some View {
        let task = view.task
        if task.isClosed && !expanded {
            TaskCollapsed(task: task, reopen: reopenLabel(view), pending: pending) { run(.reopen) }
        } else {
            TaskCardBody(view: view, names: model.names, expanded: expanded, pending: pending, error: error, showsHistory: $showsHistory,
                         reopen: reopenLabel(view), run: run, sheet: { sheet = $0 }, open: open)
        }
    }

    private func reopenLabel(_ view: TaskView) -> String? {
        let task = view.task
        guard task.isClosed || task.stale, !task.isRecurring else { return nil }
        if task.closedBy.map(TaskItem.isYou) == true { return "Undo" }
        if !task.isMine {
            let name = model.names.short(task)
            return "Reopen for \(name.hasPrefix("Its ") ? "its" + name.dropFirst(3) : name)"
        }
        return task.stale ? nil : "Undo"
    }

    private func open(_ threadId: String) {
        if let openThread { openThread(threadId) } else { app.openTaskThread(threadId) }
    }

    private func run(_ action: TaskAction) {
        guard pending == nil else { return }
        sheet = nil
        pending = action
        error = nil
        Task {
            do {
                let note = try await model.perform(id, action)
                pending = nil
                if let note { app.flash(note) }
            } catch {
                pending = nil
                self.error = BBClient.describe(error)
            }
        }
    }
}

enum TaskCardSheet: String, Identifiable {
    case snooze, choose
    var id: String { rawValue }
}

extension TaskItem {
    var asLoop: LoopItem {
        var loop = LoopItem(Studio.LoopsGetOutputLoop())
        loop.id = id
        loop.title = title
        loop.why = why
        loop.options = options
        loop.trigger = trigger
        loop.due = due
        return loop
    }
}

struct TaskCardBody: View {
    let view: TaskView
    let names: TaskNames
    let expanded: Bool
    let pending: TaskAction?
    let error: String?
    @Binding var showsHistory: Bool
    let reopen: String?
    let run: (TaskAction) -> Void
    let sheet: (TaskCardSheet) -> Void
    let open: (String) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var task: TaskItem { view.task }
    private var status: TaskStatus { TaskRules.status(task) }
    private var history: [TaskHistoryLine] { names.history(view.history.map { ($0.type, $0.at, $0.data) }) }
    private var everMine: Bool {
        view.history.contains { event in
            if event.type == "added_by_you" { return true }
            guard event.type == "created" || event.type == "handed_off",
                  let data = try? JSONSerialization.jsonObject(with: Data(event.data.utf8)) as? [String: Any] else { return false }
            return TaskItem.isYou(data["owner"] as? String) || TaskItem.isYou(data["from"] as? String)
        }
    }
    private var threadToOpen: String? {
        if task.isRecurring { return task.conversation ?? names.threadId(task.owner) }
        if let owner = task.ownerThreadId { return names.threadId("thread:\(owner)") ?? owner }
        if let worker = task.workers.first { return worker }
        return task.conversation
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            TaskHeader(task: task)
            VStack(alignment: .leading, spacing: 4) {
                Text(task.title).font(.headline).fixedSize(horizontal: false, vertical: true)
                if !task.why.isEmpty {
                    Text(task.why).font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            ownerLine
            if task.needsYou, let needs = task.needs, !needs.isEmpty {
                Text(needs).font(.subheadline)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.orange.opacity(0.14), in: .rect(cornerRadius: 12, style: .continuous))
                    .accessibilityLabel("Needs you: \(needs)")
                    .accessibilityIdentifier("task-needs")
            }
            if task.isMine && !task.isClosed && task.kind == .decide && !task.options.isEmpty {
                if task.options.count <= 3 {
                    TaskOptionButtons(options: task.options, pending: pending) { run(.choose($0)) }
                } else {
                    Button { sheet(.choose) } label: { LoopPill(title: "Choose… (\(task.options.count))", style: .primary) }
                        .buttonStyle(.plain)
                        .disabled(pending != nil)
                }
            }
            buttons
            if !history.isEmpty {
                Button {
                    withAnimation(reduceMotion ? nil : .smooth(duration: 0.2)) { showsHistory.toggle() }
                } label: {
                    HStack(spacing: 4) {
                        Text("History \(history.count)")
                        Image(systemName: showsHistory || expanded ? "chevron.down" : "chevron.right").font(.caption2.weight(.semibold))
                    }
                    .font(.footnote).foregroundStyle(.secondary)
                    .frame(minHeight: 30)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("task-history-toggle")
                .accessibilityValue(showsHistory || expanded ? "Shown" : "Hidden")
                if showsHistory || expanded {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(Array(history.prefix(expanded ? 20 : 6).enumerated()), id: \.offset) { _, line in
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Text(LoopFormat.since(line.at)).font(.caption).foregroundStyle(.tertiary).frame(width: 44, alignment: .leading)
                                Text(line.text).font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("task-history")
                }
            }
            if expanded && !view.runs.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Latest runs").font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
                    ForEach(view.runs) { run in
                        let s = TaskRules.status(run)
                        HStack(spacing: 8) {
                            TaskGlyph(status: s)
                            Text(run.line ?? run.title).font(.footnote).lineLimit(2)
                            Spacer(minLength: 4)
                            Text(LoopFormat.since(run.createdAt)).font(.caption).foregroundStyle(.tertiary)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }
            if let error {
                Label(error, systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(.orange)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .secondarySystemBackground), in: .rect(cornerRadius: 20, style: .continuous))
        .overlay {
            if task.needsYou {
                RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Color.orange.opacity(0.55), lineWidth: 1)
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var ownerLine: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            TaskGlyph(status: status)
            Text(task.isMine ? "You" : names.short(task)).font(.subheadline.weight(.semibold))
            Text("· \(status.label)").font(.subheadline).foregroundStyle(status.tone == .warning ? Color.orange : .secondary)
            if let count = task.automation?.count, task.automation?.role == "finding", count > 1 {
                Text("· Found \(count) times").font(.subheadline).foregroundStyle(.secondary)
            }
            if !task.needsYou, let detail = TaskRules.detail(task) {
                Text("· \(detail)").font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("task-state")
        .accessibilityValue(status.id)
    }

    @ViewBuilder
    private var buttons: some View {
        FlowLayout(spacing: 8) {
            if task.isRecurring {
                if let thread = threadToOpen { openButton(thread, title: task.automation?.kind == "runner" ? "Open thread" : "Open chat") }
            } else if task.isClosed || task.stale {
                if let reopen {
                    Button { run(.reopen) } label: { LoopPill(title: reopen, style: .secondary, busy: pending == .reopen) }
                        .buttonStyle(.plain).disabled(pending != nil)
                        .accessibilityIdentifier("task-reopen")
                }
                if let thread = threadToOpen { openButton(thread, title: "Open thread") }
            } else if task.isMine {
                if task.kind != .decide || task.options.isEmpty {
                    let read = task.kind == .read
                    Button { run(read ? .gotIt : .done) } label: { LoopPill(title: read ? "Got it" : "Done", style: .primary, busy: pending == .done || pending == .gotIt) }
                        .buttonStyle(.plain).disabled(pending != nil)
                        .accessibilityIdentifier("task-done")
                }
                if task.canSnooze && view.todo {
                    Button { sheet(.snooze) } label: { LoopPill(title: "Snooze", style: .secondary, busy: { if case .snooze = pending { true } else { false } }()) }
                        .buttonStyle(.plain).disabled(pending != nil)
                        .accessibilityIdentifier("task-snooze")
                }
                handOffMenu { LoopPill(title: "Hand off", style: .secondary, busy: { if case .handOff = pending { true } else { false } }()) }
                more(drop: true, done: false)
            } else {
                if let thread = threadToOpen { openButton(thread, title: "Open thread") }
                Button { run(.takeBack) } label: { LoopPill(title: everMine ? "Take back" : "Take over", style: .secondary, busy: pending == .takeBack) }
                    .buttonStyle(.plain).disabled(pending != nil)
                    .accessibilityIdentifier("task-take-back")
                more(drop: true, done: true)
            }
        }
    }

    private func openButton(_ thread: String, title: String) -> some View {
        Button { open(thread) } label: {
            Label(title, systemImage: "bubble.left")
                .padding(.horizontal, 14).frame(minHeight: 36)
                .background(.fill.tertiary, in: .capsule)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("task-open-thread")
    }

    private func handOffMenu<Label: View>(@ViewBuilder label: () -> Label) -> some View {
        Menu {
            Section("Hand off to") {
                ForEach(names.targets(for: task), id: \.owner) { target in
                    Button(target.name) { run(.handOff(target.owner)) }
                }
            }
        } label: { label() }
        .disabled(pending != nil)
        .accessibilityIdentifier("task-hand-off")
    }

    private func more(drop: Bool, done: Bool) -> some View {
        Menu {
            if done { Button { run(.done) } label: { SwiftUI.Label("Mark done", systemImage: "checkmark") } }
            if !task.isMine {
                Section("Hand off to") {
                    ForEach(names.targets(for: task), id: \.owner) { target in
                        Button(target.name) { run(.handOff(target.owner)) }
                    }
                }
            }
            if drop { Button(role: .destructive) { run(.drop) } label: { SwiftUI.Label("Dismiss", systemImage: "xmark") } }
        } label: {
            Image(systemName: "ellipsis")
                .font(.body.weight(.semibold))
                .frame(width: 40, height: 36)
                .background(.fill.tertiary, in: .capsule)
        }
        .accessibilityLabel("More actions")
        .accessibilityIdentifier("task-more")
        .disabled(pending != nil)
    }
}

struct TaskHeader: View {
    let task: TaskItem

    var body: some View {
        let kind = TaskRules.kind(task)
        HStack(spacing: 6) {
            Image(systemName: kind.symbol)
            Text(header(kind.label)).lineLimit(1)
            if let severity = TaskRules.severity(task) {
                TaskChip(text: severity.label, tone: severity.tone).accessibilityIdentifier("task-severity")
            }
            if task.priority == .urgent && !task.isClosed {
                TaskChip(text: "Urgent", tone: .destructive)
            }
            Spacer(minLength: 8)
            if let corner = corner {
                Text(corner).foregroundStyle(corner == "Today" ? Color.accentColor : .secondary).lineLimit(1)
            }
        }
        .font(.subheadline)
        .foregroundStyle(.secondary)
    }

    private func header(_ label: String) -> String {
        var parts = [label]
        if let text = task.scheduleText, task.isRecurring { parts.append(text) }
        else if let step = task.step, !task.isClosed, !task.isMine { parts.append(step) }
        else if task.kind == .decide, task.options.count > 1, task.isMine, !task.isClosed { parts.append("\(task.options.count) options") }
        else if let area = task.area, !area.isEmpty { parts.append(area) }
        return parts.joined(separator: " · ")
    }

    private var corner: String? {
        if task.isClosed, let closed = task.closedAt { return closed.formatted(.dateTime.hour(.defaultDigits(amPM: .omitted)).minute()) }
        if task.kind == .waitingOutside { return "Since \(LoopFormat.day(task.createdAt))" }
        guard let date = task.date else { return nil }
        let label = LoopFormat.day(date)
        return label == "Today" ? label : "Due \(label)"
    }
}

struct TaskChip: View {
    let text: String
    let tone: TaskStatus.Tone

    var body: some View {
        Text(text).font(.caption2.weight(.bold))
            .lineLimit(1)
            .fixedSize()
            .foregroundStyle(tone == .muted ? Color.secondary : .white)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(TaskGlyph.color(tone).opacity(tone == .muted ? 0.2 : 1), in: .capsule)
    }
}

struct TaskGlyph: View {
    let status: TaskStatus

    static func color(_ tone: TaskStatus.Tone) -> Color {
        switch tone {
        case .warning: .orange
        case .destructive: .red
        case .success: .green
        case .muted: .secondary
        case .plain: .accentColor
        }
    }

    var body: some View {
        Group {
            switch status.glyph {
            case .needsYou: Circle().fill(Color.orange).frame(width: 8, height: 8)
            case .running: Circle().fill(Color.green).frame(width: 8, height: 8)
            case .waiting: Circle().strokeBorder(Color.secondary, lineWidth: 1.2).frame(width: 9, height: 9)
            case .todo: Circle().strokeBorder(Color.accentColor, lineWidth: 1.2).frame(width: 9, height: 9)
            case .done: Image(systemName: status.stale ? "stop.circle" : "checkmark.circle.fill").font(.caption).foregroundStyle(status.stale ? Color.secondary : .green)
            case .failed: Image(systemName: "exclamationmark.circle.fill").font(.caption).foregroundStyle(.red)
            case .dropped: Image(systemName: "xmark.circle").font(.caption).foregroundStyle(.secondary)
            }
        }
        .frame(width: 14)
        .accessibilityHidden(true)
    }
}

private struct TaskOptionButtons: View {
    let options: [String]
    let pending: TaskAction?
    let choose: (String) -> Void

    var body: some View {
        VStack(spacing: 8) {
            ForEach(options, id: \.self) { option in
                let parts = LoopOption(option)
                Button { choose(option) } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(parts.title).font(.body.weight(.semibold))
                            if let detail = parts.detail { Text(detail).font(.subheadline).foregroundStyle(.secondary) }
                        }
                        Spacer(minLength: 0)
                        if pending == .choose(option) { ProgressView() }
                    }
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.fill.tertiary, in: .rect(cornerRadius: 14, style: .continuous))
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .disabled(pending != nil)
                .accessibilityLabel("Choose \(option)")
                .accessibilityIdentifier("task-option")
            }
        }
    }
}

struct TaskCollapsed: View {
    let task: TaskItem
    let reopen: String?
    let pending: TaskAction?
    let run: () -> Void

    var body: some View {
        let status = TaskRules.status(task)
        HStack(spacing: 10) {
            TaskGlyph(status: status)
            (Text(label(status)).fontWeight(.semibold) + Text(" · \(task.title)").foregroundStyle(.secondary))
                .lineLimit(1)
            Spacer(minLength: 4)
            if let closed = task.closedAt {
                Text(closed.formatted(.dateTime.hour(.defaultDigits(amPM: .omitted)).minute())).font(.subheadline).foregroundStyle(.secondary)
            }
            if let reopen {
                Button(action: run) {
                    if pending == .reopen { ProgressView().controlSize(.small) } else { Image(systemName: "arrow.uturn.backward") }
                }
                .buttonStyle(.borderless)
                .frame(minWidth: 44, minHeight: 44)
                .disabled(pending != nil)
                .accessibilityLabel(reopen)
                .accessibilityIdentifier("task-reopen")
            }
        }
        .font(.subheadline)
        .padding(.horizontal, 14).padding(.vertical, 4)
        .frame(minHeight: 48)
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(.separator))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("task-collapsed")
        .accessibilityValue(status.id)
    }

    private func label(_ status: TaskStatus) -> String {
        if task.state == .done, let line = task.line, line.hasPrefix("Chose: ") { return "Chose \(line.dropFirst(7))" }
        return status.label
    }
}

struct TaskNotice: View {
    let text: String
    let symbol: String

    var body: some View {
        Label(text, systemImage: symbol)
            .font(.subheadline).foregroundStyle(.secondary)
            .padding(.horizontal, 14).padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(.separator))
    }
}

struct TaskChooseSheet: View {
    let task: TaskItem
    let choose: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if !task.why.isEmpty { Section { Text(task.why).foregroundStyle(.secondary) } }
                Section {
                    ForEach(task.options, id: \.self) { option in
                        Button { choose(option) } label: {
                            let parts = LoopOption(option)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(parts.title).foregroundStyle(.primary)
                                if let detail = parts.detail { Text(detail).font(.subheadline).foregroundStyle(.secondary) }
                            }
                        }
                        .accessibilityLabel("Choose \(option)")
                    }
                }
            }
            .navigationTitle("Choose")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }
}

struct TaskSheet: View {
    let id: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                TaskCard(id: id, expanded: true).padding(16)
            }
            .navigationTitle("Task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() }.accessibilityIdentifier("task-sheet-close") } }
        }
        .accessibilityIdentifier("task-sheet")
    }
}
