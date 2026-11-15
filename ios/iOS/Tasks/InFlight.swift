import SwiftUI

struct InFlightBar: View {
    let threadId: String
    var typing = false
    @State private var model = TasksModel.shared
    @State private var showsDone = false
    @State private var hidden: [String: Date] = [:]
    @AppStorage("inFlightCollapsed") private var collapsed = false
    @EnvironmentObject private var app: AppModel
    @Environment(\.openTaskThread) private var openThread
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var rows: [TaskItem] {
        let visible = (model.flights[threadId]?.tasks ?? []).filter { hidden[$0.id] != $0.updatedAt }
        return visible.contains { !$0.isClosed } ? visible : []
    }

    var body: some View {
        let rows = rows
        Group {
            if let error = model.flightErrors[threadId], model.flights[threadId] == nil, error.contains("Tasks could not be loaded") {
                Label(error, systemImage: "exclamationmark.triangle").font(.footnote).foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("in-flight-error")
            } else if !rows.isEmpty {
                bar(rows)
            }
        }
    }

    static func poll(_ threadId: String) async {
        while !Task.isCancelled {
            await TasksModel.shared.loadFlight(threadId)
            try? await Task.sleep(for: .seconds(60))
        }
    }

    private func bar(_ rows: [TaskItem]) -> some View {
        let open = rows.filter { !$0.isClosed }
        let finished = rows.filter(\.isClosed)
        let needs = rows.filter(\.needsYou).count
        let names = model.names
        return VStack(spacing: 0) {
            HStack(spacing: 0) {
                Button {
                    if typing {
                        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                        collapsed = false
                        return
                    }
                    withAnimation(reduceMotion ? nil : .smooth(duration: 0.2)) { collapsed.toggle() }
                } label: {
                    HStack(spacing: 6) {
                        Text("In flight").font(.footnote.weight(.semibold))
                        if needs > 0 {
                            HStack(spacing: 4) {
                                Circle().fill(Color.orange).frame(width: 6, height: 6)
                                Text("\(needs) \(needs == 1 ? "needs" : "need") you")
                            }
                            .font(.caption).foregroundStyle(.orange)
                            .accessibilityIdentifier("in-flight-needs")
                        }
                        Spacer(minLength: 4)
                        Text("\(open.count)").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                            .accessibilityIdentifier("in-flight-count")
                        Image(systemName: collapsed || typing ? "chevron.up" : "chevron.down").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                    }
                    .padding(.horizontal, 12)
                    .frame(minHeight: 40)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("In flight, \(open.count) open\(needs > 0 ? ", \(needs) \(needs == 1 ? "needs" : "need") you" : "")")
                .accessibilityValue(collapsed || typing ? "Collapsed" : "Expanded")
                .accessibilityHint(collapsed || typing ? "Shows the tasks" : "Hides the tasks")
                .accessibilityIdentifier("in-flight-toggle")
                if !finished.isEmpty {
                    Divider().frame(height: 22)
                    Button("Clear done") { clearDone(finished) }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 12)
                        .frame(minHeight: 40)
                        .accessibilityIdentifier("in-flight-clear")
                }
            }
            if !collapsed && !typing {
                Divider().opacity(0.5)
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(open) { row($0, names: names) }
                        if !finished.isEmpty {
                            Button {
                                withAnimation(reduceMotion ? nil : .smooth(duration: 0.2)) { showsDone.toggle() }
                            } label: {
                                HStack(spacing: 4) {
                                    Text("\(finished.count) done").monospacedDigit()
                                    Image(systemName: showsDone ? "chevron.down" : "chevron.right").font(.caption2.weight(.semibold))
                                    Spacer()
                                }
                                .font(.caption).foregroundStyle(.secondary)
                                .padding(.horizontal, 12)
                                .frame(minHeight: 36)
                                .contentShape(.rect)
                            }
                            .buttonStyle(.plain)
                            .accessibilityValue(showsDone ? "Shown" : "Hidden")
                            .accessibilityIdentifier("in-flight-done")
                            if showsDone { ForEach(finished) { row($0, names: names) } }
                        }
                    }
                }
                .scrollBounceBehavior(.basedOnSize)
                .frame(maxHeight: 164)
                .fixedSize(horizontal: false, vertical: true)
            }
        }
        .background(Color(uiColor: .secondarySystemBackground).opacity(0.92), in: .rect(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(.separator.opacity(0.6), lineWidth: 0.5))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("in-flight")
    }

    private func row(_ task: TaskItem, names: TaskNames) -> some View {
        let status = TaskRules.status(task)
        return HStack(spacing: 0) {
            Button { reveal(task, names: names) } label: {
                HStack(spacing: 8) {
                    TaskGlyph(status: status)
                    Text(task.title).font(.footnote).lineLimit(1).layoutPriority(1)
                    if !task.isMine {
                        Text(names.short(task)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    if let detail = TaskRules.detail(task) {
                        Text(detail).font(.caption).foregroundStyle(.tertiary).lineLimit(1)
                    }
                    Spacer(minLength: 4)
                    if status.id == "needs-you" {
                        TaskChip(text: "Needs you", tone: .warning)
                    } else {
                        Text(status.label).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                .padding(.leading, 12).padding(.trailing, task.cardKind == nil ? 12 : 2)
                .frame(minHeight: 40)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityLabel([task.title, task.isMine ? nil : names.short(task), status.label, TaskRules.detail(task)].compactMap { $0 }.joined(separator: ", "))
            .accessibilityHint("Opens the task card")
            .accessibilityIdentifier("in-flight-row")
            .accessibilityValue(status.id)
            if task.cardKind != nil {
                Button { dismiss(task) } label: {
                    Image(systemName: "xmark").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                        .frame(width: 40, height: 40)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Remove \(task.title) from In flight")
                .accessibilityIdentifier("in-flight-dismiss")
            }
        }
    }

    private func reveal(_ task: TaskItem, names: TaskNames) {
        if task.cardKind != nil || task.isMine {
            app.sheet = .task(id: task.id)
            return
        }
        if let owner = names.threadId(task.owner), owner != threadId {
            if let openThread { openThread(owner) } else { app.openTaskThread(owner) }
        } else {
            app.sheet = .task(id: task.id)
        }
    }

    private func dismiss(_ task: TaskItem) {
        hidden[task.id] = task.updatedAt
        Task {
            do { try await model.dismiss(task.id, in: threadId) } catch {
                hidden[task.id] = nil
                app.flash("Couldn't remove it: \(BBClient.describe(error))")
            }
        }
    }

    private func clearDone(_ finished: [TaskItem]) {
        showsDone = false
        for task in finished { hidden[task.id] = task.updatedAt }
        Task {
            do { try await model.clearDone(in: threadId) } catch {
                for task in finished { hidden[task.id] = nil }
                app.flash("Couldn't clear them: \(BBClient.describe(error))")
            }
        }
    }
}

extension EnvironmentValues {
    @Entry var openTaskThread: ((String) -> Void)?
}
