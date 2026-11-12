import SwiftUI

/// The cards BB web stacks above the composer: model fallback, plan mode, goal,
/// background work, todos and queued messages. Each shows only when it applies.
struct ThreadShelf: View {
    @ObservedObject var model: ThreadModel
    @EnvironmentObject private var app: AppModel
    @AppStorage(ServerScope.key("dismissedFallbacks")) private var dismissedFallbacks = ""
    @State private var editing: QueuedMessage?
    @State private var queueExpanded = false

    var body: some View {
        let shelf = model.shelf
        VStack(spacing: 6) {
            if let fallback = shelf.fallback, let seq = fallback.sourceSeq,
                !dismissedFallbacks.split(separator: ",").contains(Substring(String(Int(seq))))
            {
                ShelfCard(icon: "arrow.triangle.swap", tint: .orange) {
                    Text("Switched from \(fallback.originalModel) to \(fallback.fallbackModel)").lineLimit(2)
                } trailing: {
                    dismiss("Dismiss") { dismissedFallbacks += ",\(Int(seq))" }
                }
            }
            if shelf.isPlanning {
                ShelfCard(icon: "list.bullet.clipboard", tint: .blue) {
                    Text("Plan mode").fontWeight(.medium)
                } trailing: {
                    dismiss("Exit plan mode") { Task { await model.perform { try await $0.exitPlanMode($1) } } }
                }
            }
            if let goal = shelf.goal {
                ShelfCard(icon: "target", tint: .purple) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(goal.objective).lineLimit(2)
                        let status = goalStatus(goal)
                        if !status.isEmpty {
                            Text(status).font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                } trailing: {
                    dismiss("Clear goal") { Task { await model.perform { try await $0.clearGoal($1) } } }
                }
            }
            if let first = shelf.background.first {
                ShelfCard(icon: first.workflowName != nil ? "flowchart" : "terminal", tint: .green) {
                    HStack(spacing: 4) {
                        Text(first.workflowName ?? first.description ?? "Background work").lineLimit(1)
                        if shelf.background.count > 1 {
                            Text("+\(shelf.background.count - 1) more").foregroundStyle(.secondary)
                        }
                    }
                } trailing: {
                    ProgressView().controlSize(.mini)
                }
            }
            if !shelf.todos.isEmpty {
                TodoCard(items: shelf.todos)
            }
            if model.queued.count > 1, !queueExpanded {
                queueSummary
            } else {
                if model.queued.count > 1 { queueHeader }
                List {
                    ForEach(model.queued) { message in
                        queuedCard(message)
                            .listRowInsets(EdgeInsets(top: 3, leading: 0, bottom: 3, trailing: 0))
                            .listRowSeparator(.hidden)
                            .listRowBackground(Color.clear)
                    }
                    .onMove { from, to in
                        guard let index = from.first else { return }
                        move(model.queued[index].id, to: to > index ? to - 1 : to)
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .scrollBounceBehavior(.basedOnSize)
                .environment(\.defaultMinListRowHeight, 40)
                .contentMargins(.vertical, 0, for: .scrollContent)
                .frame(height: min(CGFloat(model.queued.count) * 55, 250))
            }
        }
        .animation(.snappy, value: model.shelf)
        .animation(.snappy, value: model.queued)
        .sheet(item: $editing) { message in
            QueuedMessageEditor(client: app.client, message: message) {
                Task { await model.loadInteractions() }
            }
        }
    }

    /// Two or more queued messages fold into one row so the shelf stays short.
    private var queueSummary: some View {
        let next = model.queued[0]
        return ShelfCard(icon: "tray.full", tint: .secondary) {
            Button { withAnimation(.snappy) { queueExpanded = true } } label: {
                VStack(alignment: .leading, spacing: 1) {
                    Text("\(model.queued.count) queued").fontWeight(.medium)
                    Text(next.text.isEmpty ? "Attachment" : next.text).foregroundStyle(.secondary).lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(.rect)
            }
            .accessibilityIdentifier("queueSummary")
            .accessibilityHint("Shows the queued messages")
        } trailing: {
            chevron(expanded: false) { queueExpanded = true }
        }
    }

    private var queueHeader: some View {
        Button { withAnimation(.snappy) { queueExpanded = false } } label: {
            HStack {
                Text("\(model.queued.count) queued · hold and drag to reorder")
                    .font(.caption).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "chevron.down").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                    .frame(width: 30, height: 22)
            }
            .padding(.leading, 12).padding(.trailing, 4)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Collapse queue")
    }

    private func chevron(expanded: Bool, action: @escaping () -> Void) -> some View {
        Button { withAnimation(.snappy, action) } label: {
            Image(systemName: "chevron.up")
                .font(.caption2.weight(.semibold))
                .rotationEffect(.degrees(expanded ? 180 : 0))
                .frame(width: 30, height: 30)
        }
        .foregroundStyle(.secondary)
        .accessibilityLabel(expanded ? "Collapse queue" : "Expand queue")
    }

    private func queuedCard(_ message: QueuedMessage) -> some View {
        ShelfCard(icon: message.isRetry ? "arrow.clockwise" : message.isDraft ? "doc.text" : "clock", tint: .secondary) {
            Button {
                if message.editable != false { editing = message }
            } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(message.text.isEmpty ? "Attachment" : message.text).lineLimit(2)
                    Text(message.attachmentCount > 0 ? "\(message.status) · \(message.attachmentCount) attachment\(message.attachmentCount == 1 ? "" : "s")" : message.status)
                        .font(.caption2).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(.rect)
            }
            .accessibilityHint(message.editable != false ? "Edits the message" : "")
        } trailing: {
            HStack(spacing: 2) {
                Button {
                    Task { await model.perform { try await $0.sendQueuedNow($1, message.id) } }
                } label: {
                    Image(systemName: "arrow.up.circle").frame(width: 30, height: 30)
                }
                .accessibilityLabel("Send now")
                dismiss("Remove from queue") {
                    Task { await model.perform { try await $0.deleteQueued($1, message.id) } }
                }
            }
        }
        .contextMenu {
            if message.editable != false {
                Button { editing = message } label: { Label("Edit", systemImage: "pencil") }
            }
            Button {
                Task { await model.perform { try await $0.sendQueuedNow($1, message.id) } }
            } label: { Label("Send Now", systemImage: "arrow.up.circle") }
            if model.queued.count > 1, let index = model.queued.firstIndex(where: { $0.id == message.id }) {
                if index > 0 {
                    Button { move(message.id, to: 0) } label: { Label("Move to Top", systemImage: "arrow.up.to.line") }
                    Button { move(message.id, to: index - 1) } label: { Label("Move Up", systemImage: "arrow.up") }
                }
                if index < model.queued.count - 1 {
                    Button { move(message.id, to: index + 1) } label: { Label("Move Down", systemImage: "arrow.down") }
                }
            }
            Button { UIPasteboard.general.string = message.text } label: { Label("Copy", systemImage: "doc.on.doc") }
            Button(role: .destructive) {
                Task { await model.perform { try await $0.deleteQueued($1, message.id) } }
            } label: { Label("Remove", systemImage: "trash") }
        }
    }

    /// Moves a queued message to `index` right away, then tells the server
    /// which neighbours it now sits between. A refresh follows either way.
    @discardableResult
    private func move(_ id: String, to index: Int?) -> Bool {
        guard let index, let from = model.queued.firstIndex(where: { $0.id == id }), from != index else { return false }
        withAnimation(.snappy) {
            let message = model.queued.remove(at: from)
            model.queued.insert(message, at: min(index, model.queued.count))
        }
        let ids = model.queued.map(\.id)
        guard let at = ids.firstIndex(of: id) else { return false }
        let previous = at > 0 ? ids[at - 1] : nil
        let next = at + 1 < ids.count ? ids[at + 1] : nil
        Task { await model.perform { try await $0.reorderQueued($1, id, previous: previous, next: next) } }
        return true
    }

    private func dismiss(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: "xmark").font(.caption.weight(.semibold)).frame(width: 30, height: 30)
        }
        .foregroundStyle(.secondary)
        .accessibilityLabel(label)
    }

    private func goalStatus(_ goal: Goal) -> String {
        var parts: [String] = []
        switch goal.status {
        case "paused": parts.append("Paused")
        case "budgetLimited": parts.append("Budget reached")
        default: break
        }
        if let used = goal.tokensUsed {
            parts.append(goal.tokenBudget.map { "\(tokens(used)) of \(tokens($0)) tokens" } ?? "\(tokens(used)) tokens")
        }
        return parts.joined(separator: " · ")
    }

    private func tokens(_ value: Double) -> String {
        value.formatted(.number.notation(.compactName))
    }
}

struct ShelfCard<Content: View, Trailing: View>: View {
    let icon: String
    let tint: Color
    @ViewBuilder let content: Content
    @ViewBuilder let trailing: Trailing

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: icon).foregroundStyle(tint).frame(width: 18)
            content.font(.footnote).frame(maxWidth: .infinity, alignment: .leading)
            trailing
        }
        .padding(.leading, 12)
        .padding(.trailing, 4)
        .padding(.vertical, 6)
        .frame(minHeight: 40)
        .background(.fill.quaternary, in: .rect(cornerRadius: 14))
        .buttonStyle(.plain)
    }
}

/// "3/7 complete" with the task in progress; expands to the whole list.
struct TodoCard: View {
    let items: [Todos.Item]
    @State private var expanded = false

    var body: some View {
        let done = items.filter { $0.status == "completed" }.count
        let current = items.first { $0.status == "in_progress" } ?? items.first { $0.status == "pending" }
        VStack(alignment: .leading, spacing: 6) {
            Button { withAnimation(.snappy) { expanded.toggle() } } label: {
                HStack(spacing: 10) {
                    Image(systemName: "checklist").foregroundStyle(.teal).frame(width: 18)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("\(done)/\(items.count) complete").fontWeight(.medium)
                        if !expanded, let current {
                            Text(current.text).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: "chevron.up")
                        .font(.caption2.weight(.semibold))
                        .rotationEffect(.degrees(expanded ? 180 : 0))
                        .foregroundStyle(.secondary)
                        .frame(width: 30, height: 30)
                }
                .contentShape(.rect)
            }
            if expanded {
                ScrollView {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(sorted) { item in
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Image(systemName: symbol(item.status))
                                    .foregroundStyle(item.status == "completed" ? Color.green : item.status == "in_progress" ? .blue : .secondary)
                                Text(item.text)
                                    .strikethrough(item.status == "completed")
                                    .foregroundStyle(item.status == "completed" ? .secondary : .primary)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.leading, 28)
                    .padding(.bottom, 4)
                }
                .frame(maxHeight: 220)
                .fixedSize(horizontal: false, vertical: true)
            }
        }
        .font(.footnote)
        .buttonStyle(.plain)
        .padding(.leading, 12)
        .padding(.trailing, 4)
        .padding(.vertical, 6)
        .background(.fill.quaternary, in: .rect(cornerRadius: 14))
    }

    /// In progress first, then pending, then completed, as BB web orders them.
    private var sorted: [Todos.Item] {
        let rank = ["in_progress": 0, "pending": 1, "completed": 2]
        return items.enumerated().sorted {
            (rank[$0.element.status] ?? 1, $0.offset) < (rank[$1.element.status] ?? 1, $1.offset)
        }.map(\.element)
    }

    private func symbol(_ status: String) -> String {
        switch status {
        case "completed": "checkmark.circle.fill"
        case "in_progress": "circle.dotted.circle"
        default: "circle"
        }
    }
}
