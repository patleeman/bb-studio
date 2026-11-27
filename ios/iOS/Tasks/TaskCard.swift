import SwiftUI

/// An old `::loop` or `::work` card in a message, and the task sheet: read
/// only. Personal to-dos are gone; the card shows the task's title, state,
/// line, what it needs and what it made, with no buttons that change it.
struct TaskCard: View {
    let id: String
    var expanded = false
    @State private var model = TasksModel.shared
    @State private var showsHistory = false
    @EnvironmentObject private var app: AppModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        card
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
    }

    @ViewBuilder
    private func content(_ view: TaskView) -> some View {
        if view.task.isClosed && !expanded {
            TaskCollapsed(task: view.task)
        } else {
            TaskCardBody(view: view, names: model.names, expanded: expanded, showsHistory: $showsHistory, open: open, follow: follow)
        }
    }

    private func open(_ threadId: String) {
        app.open(.conversation(threadId))
    }

    private func follow(_ output: TaskItem.Output) {
        guard let target = TaskCardContent.target(output) else { return }
        app.openLink(target)
    }
}

/// What a read-only task card shows, worked out from the task.
struct TaskCardContent: Equatable {
    var title: String
    var why: String?
    /// "You", the Bot's name or a lead's.
    var owner: String
    var state: TaskStatus
    /// Its progress line, or what it needs.
    var line: String?
    /// What it needs from you, while it does.
    var needs: String?
    var outputs: [TaskItem.Output]

    @MainActor init(_ task: TaskItem, names: TaskNames) {
        title = task.title
        why = task.why.isEmpty ? nil : task.why
        owner = task.isMine ? "You" : names.short(task)
        state = TaskRules.status(task)
        needs = task.needsYou ? task.needs.flatMap { $0.isEmpty ? nil : $0 } : nil
        line = needs == nil ? TaskRules.detail(task) : nil
        outputs = task.outputs
    }

    /// Where an output opens: its link, or the item it names.
    static func target(_ output: TaskItem.Output) -> LinkTarget? {
        for text in [output.url, output.ref].compactMap({ $0 }) where !text.isEmpty {
            if let target = Links.parse(text) { return target }
        }
        return nil
    }
}

struct TaskCardBody: View {
    let view: TaskView
    let names: TaskNames
    let expanded: Bool
    @Binding var showsHistory: Bool
    let open: (String) -> Void
    let follow: (TaskItem.Output) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var task: TaskItem { view.task }
    private var content: TaskCardContent { TaskCardContent(task, names: names) }
    private var history: [TaskHistoryLine] { names.history(view.history.map { ($0.type, $0.at, $0.data) }) }
    private var threadToOpen: String? {
        if task.isRecurring { return task.conversation ?? names.threadId(task.owner) }
        if let owner = task.ownerThreadId { return names.threadId("thread:\(owner)") ?? owner }
        if let worker = task.workers.first { return worker }
        return task.conversation
    }

    var body: some View {
        let content = content
        VStack(alignment: .leading, spacing: 10) {
            TaskHeader(task: task)
            VStack(alignment: .leading, spacing: 4) {
                Text(content.title).font(.headline).fixedSize(horizontal: false, vertical: true)
                if let why = content.why {
                    Text(why).font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            ownerLine(content)
            if let needs = content.needs {
                Text(needs).font(.subheadline)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.orange.opacity(0.14), in: .rect(cornerRadius: 12, style: .continuous))
                    .accessibilityLabel("Needs you: \(needs)")
                    .accessibilityIdentifier("task-needs")
            }
            if !content.outputs.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(content.outputs.enumerated()), id: \.offset) { _, output in
                        let opens = TaskCardContent.target(output) != nil
                        Button { follow(output) } label: {
                            Label(output.title, systemImage: output.symbol)
                                .font(.subheadline)
                                .foregroundStyle(opens ? AnyShapeStyle(.tint) : AnyShapeStyle(.primary))
                                .lineLimit(2)
                                .frame(minHeight: 30, alignment: .leading)
                                .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .disabled(!opens)
                        .accessibilityIdentifier("task-output")
                    }
                }
            }
            if let thread = threadToOpen {
                Button { open(thread) } label: {
                    Label(task.isRecurring && task.automation?.kind != "runner" ? "Open chat" : "Open thread", systemImage: "bubble.left")
                        .padding(.horizontal, 14).frame(minHeight: 36)
                        .background(.fill.tertiary, in: .capsule)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("task-open-thread")
            }
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
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .secondarySystemBackground), in: .rect(cornerRadius: 20, style: .continuous))
        .overlay {
            if content.needs != nil {
                RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Color.orange.opacity(0.55), lineWidth: 1)
            }
        }
        .accessibilityElement(children: .contain)
    }

    private func ownerLine(_ content: TaskCardContent) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            TaskGlyph(status: content.state)
            Text(content.owner).font(.subheadline.weight(.semibold))
            Text("· \(content.state.label)").font(.subheadline).foregroundStyle(content.state.tone == .warning ? Color.orange : .secondary)
            if let count = task.automation?.count, task.automation?.role == "finding", count > 1 {
                Text("· Found \(count) times").font(.subheadline).foregroundStyle(.secondary)
            }
            if let line = content.line {
                Text("· \(line)").font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("task-state")
        .accessibilityValue(content.state.id)
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

struct TaskCollapsed: View {
    let task: TaskItem

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
        }
        .font(.subheadline)
        .padding(.horizontal, 14).padding(.vertical, 4)
        .frame(minHeight: 48)
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(.separator))
        .accessibilityElement(children: .combine)
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
