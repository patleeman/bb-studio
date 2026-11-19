import SwiftUI

struct InFlightBar: View {
    let threadId: String
    var typing = false
    var liveStep: String? = nil
    var workers = 0
    @State private var model = TasksModel.shared
    @State private var showsDone = false
    @State private var hidden: [String: Date] = [:]
    @State private var unfolded: Set<String> = []
    @AppStorage("inFlightCollapsed") private var collapsed = false
    @EnvironmentObject private var app: AppModel
    @Environment(\.openTaskThread) private var openThread
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.look) private var look

    private var rows: [FlightNode] {
        guard let flight = model.flights[threadId] else { return [] }
        let visible = TaskTree.nodes(flight).filter { hidden[$0.task.id] != $0.task.updatedAt }
        let rowsFeed = flight.rows != nil
        return visible.contains { Self.live($0, rowsFeed: rowsFeed) } ? visible : []
    }

    static func live(_ node: FlightNode, rowsFeed: Bool) -> Bool {
        node.row.open && !(rowsFeed && node.task.stale)
    }

    var body: some View {
        let rows = rows
        Group {
            if let error = model.flightErrors[threadId], model.flights[threadId] == nil, error.contains("Tasks could not be loaded") {
                Label(error, systemImage: "exclamationmark.triangle").font(.footnote).foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("in-flight-error")
            } else if typing {
                if !rows.isEmpty || liveStep != nil || workers > 0 { line(rows) }
            } else if !rows.isEmpty {
                bar(rows)
            }
        }
    }

    static func shows(_ threadId: String) -> Bool {
        guard let flight = TasksModel.shared.flights[threadId] else { return false }
        return TaskTree.nodes(flight).contains { live($0, rowsFeed: flight.rows != nil) }
    }

    static func listedWorkers(_ threadId: String) -> Set<String> {
        guard let flight = TasksModel.shared.flights[threadId] else { return [] }
        func ids(_ node: FlightNode) -> [String] { node.workers.map(\.threadId) + node.task.workers + node.children.flatMap(ids) }
        return Set(TaskTree.nodes(flight).flatMap(ids))
    }

    static func poll(_ threadId: String) async {
        while !Task.isCancelled {
            await TasksModel.shared.loadFlight(threadId)
            try? await Task.sleep(for: .seconds(60))
        }
    }

    private func bar(_ rows: [FlightNode]) -> some View {
        let rowsFeed = model.flights[threadId]?.rows != nil
        let open = rows.filter { Self.live($0, rowsFeed: rowsFeed) }
        let finished = rows.filter { !Self.live($0, rowsFeed: rowsFeed) }
        let names = model.names
        return VStack(spacing: 0) {
            header(open: open, finished: finished, rowsFeed: rowsFeed)
            if !collapsed && !typing {
                Divider().opacity(0.5)
                ScrollView {
                    VStack(spacing: 0) {
                        if let liveStep { live(liveStep) }
                        ForEach(open) { node in row(node, names: names) }
                        if !finished.isEmpty {
                            doneToggle(finished.count)
                            if showsDone { ForEach(finished) { node in row(node, names: names) } }
                        }
                    }
                }
                .scrollBounceBehavior(.basedOnSize)
                .frame(maxHeight: 164)
                .fixedSize(horizontal: false, vertical: true)
            }
        }
        .background(look.stackFill, in: .rect(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(.separator.opacity(0.6), lineWidth: 0.5))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("in-flight")
    }

    private func live(_ step: String) -> some View {
        HStack(spacing: 8) {
            ProgressView().controlSize(.mini).frame(width: 14)
            Text(step).font(.footnote).lineLimit(1).truncationMode(.tail)
            Spacer(minLength: 4)
            Text("Running").font(.caption2).lineLimit(1).fixedSize()
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 40)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(step), running")
        .accessibilityIdentifier("in-flight-live")
    }

    private func latest(_ open: [FlightNode]) -> String? {
        if let liveStep { return liveStep }
        if let running = open.first(where: \.isRunning), let text = running.task.step ?? running.task.line ?? Optional(running.task.title) { return text }
        if workers > 0 { return workers == 1 ? "1 worker" : "\(workers) workers" }
        return nil
    }

    private func line(_ rows: [FlightNode]) -> some View {
        let rowsFeed = model.flights[threadId]?.rows != nil
        let open = rows.filter { Self.live($0, rowsFeed: rowsFeed) }
        let needs = open.filter(\.row.needsYou).count
        let step = latest(open)
        let busy = liveStep != nil || open.contains(where: \.isRunning)
        let title = open.isEmpty ? "Working" : "In flight \(open.count)"
        let label = [open.isEmpty ? "Working" : "In flight, \(open.count) open", needs > 0 ? "\(needs) \(needs == 1 ? "needs" : "need") you" : nil, step]
            .compactMap { $0 }.joined(separator: ", ")
        return Button {
            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
            collapsed = false
        } label: {
            HStack(spacing: 6) {
                if needs > 0 { Circle().fill(Color.orange).frame(width: 7, height: 7) }
                Text(title).fontWeight(.semibold).monospacedDigit().layoutPriority(1)
                if let step {
                    Text("·").foregroundStyle(.tertiary)
                    Text(step).lineLimit(1).truncationMode(.tail)
                }
                Spacer(minLength: 4)
                if busy { ProgressView().controlSize(.mini) }
                Image(systemName: "chevron.up").font(.caption2.weight(.semibold))
            }
            .font(.footnote)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 12)
            .frame(height: 34)
            .frame(maxWidth: .infinity)
            .background(look.stackFill, in: .rect(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(.separator.opacity(0.6), lineWidth: 0.5))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityValue("Collapsed")
        .accessibilityHint("Shows the tasks")
        .accessibilityIdentifier("in-flight-toggle")
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("in-flight")
    }

    private func header(open: [FlightNode], finished: [FlightNode], rowsFeed: Bool) -> some View {
        let needs = open.filter(\.row.needsYou).count
        let running = rowsFeed ? open.filter(\.isRunning).count : 0
        let needsText = "\(needs) \(needs == 1 ? "needs" : "need") you"
        let label = ["In flight, \(open.count) open", needs > 0 ? needsText : nil, running > 0 ? "\(running) running" : nil, liveStep].compactMap { $0 }.joined(separator: ", ")
        return HStack(spacing: 0) {
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
                            Text(needsText)
                        }
                        .font(.caption).foregroundStyle(.orange)
                        .lineLimit(1).fixedSize()
                        .accessibilityIdentifier("in-flight-needs")
                    }
                    if let liveStep, collapsed {
                        Text(liveStep).font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.tail)
                        ProgressView().controlSize(.mini)
                    } else if running > 0 {
                        Text("\(running) running").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            .accessibilityIdentifier("in-flight-running")
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
            .accessibilityLabel(label)
            .accessibilityValue(collapsed || typing ? "Collapsed" : "Expanded")
            .accessibilityHint(collapsed || typing ? "Shows the tasks" : "Hides the tasks")
            .accessibilityIdentifier("in-flight-toggle")
            if !finished.isEmpty {
                Divider().frame(height: 22)
                Button("Clear done") { clearDone(finished.map(\.task)) }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 40)
                    .accessibilityIdentifier("in-flight-clear")
            }
        }
    }

    private func doneToggle(_ count: Int) -> some View {
        Button {
            withAnimation(reduceMotion ? nil : .smooth(duration: 0.2)) { showsDone.toggle() }
        } label: {
            HStack(spacing: 4) {
                Text("\(count) done today").monospacedDigit()
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
    }

    private func row(_ node: FlightNode, names: TaskNames) -> some View {
        let task = node.task
        let owner = task.isMine ? nil : names.short(task)
        let text = TaskTree.text(node, owner: owner, titleOf: { id in model.task(id)?.title })
        let folded = unfolded.contains(task.id)
        return VStack(spacing: 0) {
            HStack(spacing: 0) {
                Button { reveal(task, names: names) } label: {
                    InFlightRowLabel(node: node, owner: owner, text: text)
                        .padding(.leading, 12).padding(.trailing, task.cardKind == nil && node.belowText == nil ? 12 : 2)
                        .frame(minHeight: 40)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .combine)
                .accessibilityLabel(text.aria)
                .accessibilityHint("Opens the task card")
                .accessibilityIdentifier("in-flight-row")
                .accessibilityValue(text.value)
                if let below = node.belowText {
                    FlightFoldButton(node: node, text: below, open: folded) {
                        withAnimation(reduceMotion ? nil : .smooth(duration: 0.2)) {
                            if folded { unfolded.remove(task.id) } else { unfolded.insert(task.id) }
                        }
                    }
                    .accessibilityIdentifier("in-flight-fold")
                }
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
            if folded {
                FlightChildren(node: node, names: names, depth: 1, openTask: { app.sheet = .task(id: $0) }, openThread: open)
            }
        }
    }

    private func open(_ thread: String) {
        if let openThread { openThread(thread) } else { app.openTaskThread(thread) }
    }

    private func reveal(_ task: TaskItem, names: TaskNames) {
        if task.cardKind != nil || task.isMine {
            app.sheet = .task(id: task.id)
            return
        }
        if let owner = names.threadId(task.owner), owner != threadId {
            open(owner)
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

private struct InFlightRowLabel: View {
    let node: FlightNode
    let owner: String?
    let text: FlightText

    var body: some View {
        let task = node.task
        HStack(spacing: 8) {
            FlightGlyph(node: node)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) {
                    Text(task.title).font(.footnote).lineLimit(1)
                    if let owner { Text(owner).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                    if let line = text.line { Text(line).font(.caption).foregroundStyle(.tertiary).lineLimit(1) }
                }
                HStack(spacing: 8) {
                    Text(task.title).font(.footnote).lineLimit(1)
                    if let owner { Text(owner).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                }
                Text(task.title).font(.footnote).lineLimit(1)
            }
            Spacer(minLength: 4)
            if text.look == .needsYou && !task.stale {
                TaskChip(text: "Needs you", tone: .warning).fixedSize()
            } else {
                Text(text.right).font(.caption2).foregroundStyle(text.look == .running ? .primary : .secondary).lineLimit(1).fixedSize()
            }
        }
    }
}

struct FlightGlyph: View {
    let node: FlightNode
    var size: CGFloat = 14

    var body: some View {
        let look = node.look
        Group {
            if node.task.stale {
                TaskGlyph(status: TaskRules.status(node.task))
            } else if look == .running {
                FlightRing(progress: StepProgress(node.task.step), size: size - 2)
            } else {
                TaskGlyph(status: TaskStatus(id: look.rawValue, label: look.label, glyph: Self.glyph(look), tone: .plain))
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    static func glyph(_ look: FlightLook) -> TaskStatus.Glyph {
        switch look {
        case .running: .running
        case .waiting: .waiting
        case .needsYou: .needsYou
        case .todo: .todo
        case .done: .done
        case .failed: .failed
        }
    }
}

struct FlightRing: View {
    let progress: StepProgress?
    var size: CGFloat = 12

    var body: some View {
        let part = progress.map { max(0.04, $0.fraction) } ?? 0.25
        ZStack {
            Circle().stroke(Color.green.opacity(0.22), lineWidth: 2)
            Circle().trim(from: 0, to: part).stroke(Color.green, style: StrokeStyle(lineWidth: 2, lineCap: .round)).rotationEffect(.degrees(-90))
        }
        .frame(width: size, height: size)
    }
}

struct FlightFoldButton: View {
    let node: FlightNode
    let text: String
    let open: Bool
    let toggle: () -> Void

    var body: some View {
        let below = node.below
        Button(action: toggle) {
            HStack(spacing: 3) {
                Image(systemName: below.workers > 0 ? "person.2" : "list.bullet").font(.caption2)
                Text("\(below.workers > 0 ? below.workers : below.subtasks)").font(.caption2.monospacedDigit())
                Image(systemName: open ? "chevron.down" : "chevron.right").font(.caption2.weight(.semibold))
            }
            .foregroundStyle(.secondary)
            .frame(minWidth: 44, minHeight: 40)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(open ? "Hide" : "Show") \(text) under \(node.task.title)")
        .accessibilityValue(open ? "Shown" : "Hidden")
    }
}

struct FlightChildren: View {
    let node: FlightNode
    let names: TaskNames
    let depth: Int
    let openTask: (String) -> Void
    let openThread: (String) -> Void

    var body: some View {
        VStack(spacing: 0) {
            ForEach(node.workers, id: \.threadId) { worker in
                Button { openThread(worker.threadId) } label: {
                    HStack(spacing: 8) {
                        Circle().fill(worker.running ? Color.green : Color.secondary.opacity(0.6)).frame(width: 6, height: 6)
                        Image(systemName: "person.crop.circle").font(.caption2).foregroundStyle(.secondary)
                        Text(worker.name).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        Spacer(minLength: 0)
                    }
                    .padding(.leading, 12 + CGFloat(depth) * 16).padding(.trailing, 12)
                    .frame(minHeight: 32)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Open worker \(worker.spoken)")
                .accessibilityIdentifier("in-flight-worker")
            }
            ForEach(node.children) { child in
                FlightChildRow(node: child, names: names, depth: depth, openTask: openTask, openThread: openThread)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Under \(node.task.title)")
    }
}

private struct FlightChildRow: View {
    let node: FlightNode
    let names: TaskNames
    let depth: Int
    let openTask: (String) -> Void
    let openThread: (String) -> Void

    var body: some View {
        let owner = node.task.isMine ? nil : names.short(node.task)
        let text = TaskTree.text(node, owner: owner)
        VStack(spacing: 0) {
            Button { openTask(node.task.id) } label: {
                HStack(spacing: 8) {
                    FlightGlyph(node: node, size: 12)
                    Text(node.task.title).font(.caption).foregroundStyle(node.task.isClosed ? .secondary : .primary).lineLimit(1)
                    if let line = text.line { Text(line).font(.caption2).foregroundStyle(.tertiary).lineLimit(1) }
                    Spacer(minLength: 4)
                    Text(text.right).font(.caption2).foregroundStyle(text.look == .needsYou ? .orange : .secondary).lineLimit(1).fixedSize()
                }
                .padding(.leading, 12 + CGFloat(depth) * 16).padding(.trailing, 12)
                .frame(minHeight: 32)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(text.aria)
            .accessibilityValue(text.value)
            .accessibilityIdentifier("in-flight-subtask")
            if !node.workers.isEmpty || !node.children.isEmpty {
                FlightChildren(node: node, names: names, depth: depth + 1, openTask: openTask, openThread: openThread)
            }
        }
    }
}

extension EnvironmentValues {
    @Entry var openTaskThread: ((String) -> Void)?
    @Entry var showTaskDetail: ((String) -> Void)?
    @Entry var shownTaskDetail: String?
}
