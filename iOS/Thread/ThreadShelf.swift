import SwiftUI

/// The cards BB web stacks above the composer: model fallback, plan mode, goal,
/// background work, todos and queued messages. Each shows only when it applies.
struct ThreadShelf: View {
    @ObservedObject var model: ThreadModel
    @AppStorage("dismissedFallbacks") private var dismissedFallbacks = ""

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
                ShelfCard(icon: first.workflowName != nil ? "square.stack.3d.up" : "terminal", tint: .green) {
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
            ForEach(model.queued) { message in
                ShelfCard(icon: message.isRetry ? "arrow.clockwise" : message.isDraft ? "doc.text" : "clock", tint: .secondary) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(message.text.isEmpty ? "Attachment" : message.text).lineLimit(2)
                        Text(message.attachmentCount > 0 ? "\(message.status) · \(message.attachmentCount) attachment\(message.attachmentCount == 1 ? "" : "s")" : message.status)
                            .font(.caption2).foregroundStyle(.secondary)
                    }
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
            }
        }
        .animation(.snappy, value: model.shelf)
        .animation(.snappy, value: model.queued)
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
