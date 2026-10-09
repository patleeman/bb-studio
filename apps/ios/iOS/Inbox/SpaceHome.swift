import SwiftUI

// MARK: Switcher

/// All, then one chip per Space, like the web sidebar's dots. A Space with a
/// thread that needs you has an amber mark; + makes a new Space.
struct SpaceSwitcher: View {
    let spaces: [InboxModel.SpaceSection]
    let shown: String
    let select: (String) -> Void
    let add: () -> Void

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    chip(id: "all", title: "All", symbol: "square.grid.2x2", tint: .secondary, needsYou: spaces.contains { $0.needsYou })
                    ForEach(spaces) { section in
                        chip(
                            id: section.id, title: section.space.label, symbol: section.space.emoji == nil ? "circle.fill" : nil,
                            tint: Color(hex: section.space.color), needsYou: section.needsYou)
                    }
                    Button(action: add) {
                        Image(systemName: "plus")
                            .font(.subheadline.weight(.semibold))
                            .frame(width: 32, height: 32)
                            .background(.quaternary, in: .circle)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("New Space")
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 6)
            }
            .onAppear { proxy.scrollTo(shown, anchor: .center) }
            .onChange(of: shown) { withAnimation { proxy.scrollTo(shown, anchor: .center) } }
        }
    }

    private func chip(id: String, title: String, symbol: String?, tint: Color, needsYou: Bool) -> some View {
        let selected = shown == id
        return Button { select(id) } label: {
            HStack(spacing: 5) {
                if let symbol { Image(systemName: symbol).font(.caption2).foregroundStyle(tint) }
                Text(title).lineLimit(1)
            }
            .font(.subheadline.weight(selected ? .semibold : .regular))
            .padding(.horizontal, 12)
            .frame(height: 32)
            .background(selected ? Color.accentColor.opacity(0.18) : Color.secondary.opacity(0.12), in: .capsule)
            .overlay(alignment: .topTrailing) {
                if needsYou {
                    Circle().fill(.orange).frame(width: 8, height: 8).offset(x: -2, y: 2)
                        .accessibilityHidden(true)
                }
            }
        }
        .buttonStyle(.plain)
        .id(id)
        .accessibilityLabel(needsYou ? "\(title), needs you" : title)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// Placed in a paged Space's list: a swipe that starts on a row opens that
/// row's actions, and one anywhere else (a header, the gaps, past the last
/// row) turns the page.
struct YieldsRowSwipesToPager: UIViewRepresentable {
    func makeUIView(context: Context) -> UIView { Probe() }
    func updateUIView(_ view: UIView, context: Context) {}

    private final class Probe: UIView {
        override func didMoveToWindow() {
            super.didMoveToWindow()
            // The pager finishes building after this view joins it.
            DispatchQueue.main.async { [weak self] in self?.attach() }
        }

        private func attach() {
            var ancestor = superview
            while let view = ancestor, !((view as? UIScrollView)?.isPagingEnabled ?? false) { ancestor = view.superview }
            guard let pager = ancestor as? UIScrollView,
                  !(pager.gestureRecognizers ?? []).contains(where: { $0 is RowTouch }) else { return }
            pager.addGestureRecognizer(RowTouch(pager: pager))
        }
    }

    /// Watches each touch begin without taking it: the pager's pan is off
    /// while the touch started on a row cell of a page's list.
    private final class RowTouch: UIGestureRecognizer {
        weak var pager: UIScrollView?

        init(pager: UIScrollView) {
            self.pager = pager
            super.init(target: nil, action: nil)
            cancelsTouchesInView = false
            delaysTouchesBegan = false
            delaysTouchesEnded = false
        }

        override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
            if let pager, let touch = touches.first, event.allTouches?.count == 1 {
                pager.panGestureRecognizer.isEnabled = !onRow(pager.hitTest(touch.location(in: pager), with: event), pager: pager)
            }
            state = .failed
        }

        private func onRow(_ hit: UIView?, pager: UIScrollView) -> Bool {
            var view = hit
            while let current = view, current !== pager {
                // Headers are cells too, but only rows have an index path.
                if let cell = current as? UICollectionViewCell, let list = cell.superview as? UICollectionView, list !== pager {
                    return list.indexPath(for: cell) != nil
                }
                view = current.superview
            }
            return false
        }
    }
}

// MARK: Rows

/// On a collapsed thread's row: how many sub-threads it folds away.
struct CollapsedChildrenMark: View {
    let count: Int

    var body: some View {
        HStack(spacing: 2) {
            Image(systemName: "arrow.turn.down.right")
            Text("\(count)").monospacedDigit()
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(count) sub-thread\(count == 1 ? "" : "s") collapsed")
    }
}

/// By space's two-line row, as the web sidebar draws it: a status dot (or the
/// lead's star or a pin), the title with its age, and the thread's latest line
/// from Studio, red when it failed and amber when blocked. A thread that waits
/// on you swaps its age for a pill that says why; a read, idle one has no dot
/// and steps back.
struct SpaceThreadRow: View {
    /// How the lead and pinned threads are told apart without a heading.
    enum Mark: Hashable {
        /// The label names the heartbeat when one runs.
        case lead(String)
        case pinned
    }

    let thread: ThreadEntry
    var line: ThreadLine?
    var mark: Mark?
    var hidden = false
    /// Sub-threads folded away under this one.
    var collapsedChildren = 0
    @ObservedObject private var muted = MutedThreads.shared
    /// Written by the thread screen as the reader types; see `Drafts`.
    @AppStorage private var draft: Data?

    init(thread: ThreadEntry, line: ThreadLine?, mark: Mark? = nil, hidden: Bool = false, collapsedChildren: Int = 0) {
        self.thread = thread
        self.line = line
        self.mark = mark
        self.hidden = hidden
        self.collapsedChildren = collapsedChildren
        _draft = AppStorage(ServerScope.key("draft.\(thread.id)"))
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            leading
                .frame(width: 12, height: 12)
                .padding(.top, 4)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(ThreadTitles.resolve(thread.displayTitle))
                        .font(.body.weight(state.waits ? .semibold : .regular))
                        .foregroundStyle(state == .idle ? .secondary : .primary)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    Group {
                        if collapsedChildren > 0 { CollapsedChildrenMark(count: collapsedChildren) }
                        if hidden { Image(systemName: "eye.slash").accessibilityLabel("Hidden") }
                        if muted.ids.contains(thread.id) { Image(systemName: "bell.slash").accessibilityLabel("Muted") }
                        if let pill = state.pill {
                            Text(pill.label)
                                .font(.caption2.weight(.bold))
                                .tracking(0.4)
                                .foregroundStyle(pill.text)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 1)
                                .background(state.color, in: .capsule)
                                .fixedSize()
                        } else {
                            Text(Self.age(Date(timeIntervalSince1970: at / 1000))).monospacedDigit()
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                HStack(spacing: 4) {
                    if draft != nil {
                        Text("Draft").foregroundStyle(.red)
                        if line != nil { Text("·") }
                    }
                    if let line {
                        Text(line.text).foregroundStyle(lineColor(line.kind))
                    } else if draft == nil {
                        // Rows keep two lines while a thread has nothing to say yet.
                        Text(" ")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
        }
        .dynamicTypeSize(...DynamicTypeSize.accessibility2)
    }

    private var at: Double { max(thread.updatedAt, thread.latestAttentionAt ?? 0, line?.at ?? 0) }

    /// The status dot, or the lead's star or a pin in the state's colour.
    @ViewBuilder private var leading: some View {
        switch mark {
        case .lead(let label):
            Image(systemName: "star.fill")
                .font(.system(size: 11))
                .foregroundStyle(state == .idle ? Color.secondary : state.color)
                .accessibilityLabel([label, state.label].compactMap { $0 }.joined(separator: ", "))
        case .pinned:
            Image(systemName: "pin.fill")
                .font(.system(size: 10))
                .foregroundStyle(state == .idle ? Color.secondary : state.color)
                .accessibilityLabel(["Pinned", state.label].compactMap { $0 }.joined(separator: ", "))
        case nil:
            // A read, idle thread has no dot, so one that wants you stands out.
            Circle()
                .fill(state == .idle ? Color.clear : state.color)
                .frame(width: 8, height: 8)
                .accessibilityLabel(state.label ?? "")
                .accessibilityHidden(state.label == nil)
        }
    }

    private func lineColor(_ kind: ThreadLine.Kind) -> Color {
        switch kind {
        case .progress: .secondary
        case .failure: .red
        case .blocked: .orange
        }
    }

    enum State {
        case needsYou, working, error, unread, idle

        var color: Color {
            switch self {
            case .needsYou: .orange
            case .working: .green
            case .error: .red
            case .unread: .blue
            case .idle: .secondary.opacity(0.4)
            }
        }

        var label: String? {
            switch self {
            case .needsYou: "Needs you"
            case .working: "Working"
            case .error: "Unread error"
            case .unread: "Unread result"
            case .idle: nil
            }
        }

        /// A question, an unread failure or an unread result: the thread waits on you.
        var waits: Bool { pill != nil }

        /// What a waiting thread shows in place of its age.
        var pill: (label: String, text: Color)? {
            switch self {
            case .needsYou: ("NEEDS YOU", .black)
            case .error: ("FAILED", .white)
            case .unread: ("DONE", .white)
            case .working, .idle: nil
            }
        }

        /// A question outranks a failure, which outranks a result.
        var waitRank: Int {
            switch self {
            case .needsYou: 0
            case .error: 1
            case .unread: 2
            case .working, .idle: 3
            }
        }
    }

    /// The most urgent state, as the web's By space dot shows it.
    var state: State { Self.state(of: thread) }

    static func state(of thread: ThreadEntry) -> State {
        if thread.hasPendingInteraction == true { return .needsYou }
        if thread.isRunning { return .working }
        if thread.isUnread { return thread.status == "error" ? .error : .unread }
        return .idle
    }

    /// "now", "5m", "3h", "2d", "3w", "4mo" or "1y", as the web sidebar says it.
    static func age(_ date: Date, now: Date = .now) -> String {
        let minutes = Int(max(0, now.timeIntervalSince(date)) / 60)
        if minutes < 1 { return "now" }
        if minutes < 60 { return "\(minutes)m" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h" }
        let days = hours / 24
        if days < 7 { return "\(days)d" }
        if days < 30 { return "\(days / 7)w" }
        if days < 365 { return "\(days / 30)mo" }
        return "\(days / 365)y"
    }
}

/// An open Studio item in a Space: a small chip, like a tab, so items don't
/// blur into the thread rows below.
struct SpaceItemChip: View {
    let item: SpaceOpenItem

    var body: some View {
        HStack(spacing: 5) {
            Group {
                if let emoji = item.emoji {
                    Text(emoji)
                } else {
                    Image(systemName: symbol).foregroundStyle(.secondary)
                }
            }
            .font(.caption)
            Text(item.title.isEmpty ? "Untitled" : item.title).font(.subheadline).lineLimit(1)
            if item.pinned { Image(systemName: "pin.fill").font(.system(size: 9)).foregroundStyle(.secondary).accessibilityLabel("Pinned") }
        }
        .padding(.horizontal, 10)
        .frame(height: 30)
        .background(Color.secondary.opacity(0.12), in: .capsule)
        .contentShape(.capsule)
        .accessibilityElement(children: .combine)
        .accessibilityHint(item.kindLabel)
    }

    private var symbol: String {
        switch Route(href: item.href) {
        case .page: StudioKind.of("page").symbol
        case .drawing: StudioKind.of("drawing").symbol
        case .artifact: StudioKind.of("artifact").symbol
        case .recording: StudioKind.of("recording").symbol
        case .table: "tablecells"
        case .design: StudioKind.of("design").symbol
        default: "doc"
        }
    }
}

// MARK: Lead and heartbeat

/// Picks the Space's lead from its threads, and sets the heartbeat that wakes it.
struct SpaceLeadSheet: View {
    let space: StudioSpace
    let lead: SpaceLead?
    let threads: [ThreadEntry]
    var saved: () async -> Void = {}
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    @Environment(\.dismiss) private var dismiss
    @State private var leadId = ""
    @State private var beating = false
    @State private var cadence = "hourly"
    @State private var time = Date()
    @State private var cron = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Lead", selection: $leadId) {
                        Text("None").tag("")
                        ForEach(threads) { Text(ThreadTitles.resolve($0.displayTitle)).tag($0.id) }
                    }
                } footer: {
                    Text("The lead is one of the Space's threads. It sits on top of the Space, and the heartbeat wakes it.")
                }
                Section {
                    Toggle("Heartbeat", isOn: $beating).disabled(leadId.isEmpty)
                    if beating, !leadId.isEmpty { HeartbeatFields(cadence: $cadence, time: $time, cron: $cron) }
                } footer: {
                    Text(leadId.isEmpty ? "Pick a lead to turn on the heartbeat." : "Wakes the lead on this schedule.")
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
            }
            .navigationTitle("Lead and Heartbeat")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(busy || (beating && cadence == "custom" && cron.trimmingCharacters(in: .whitespaces).isEmpty))
                }
            }
        }
        .task {
            leadId = lead?.threadId ?? ""
            beating = lead?.heartbeat != nil
            cadence = lead?.heartbeat ?? "hourly"
            cron = lead?.cron ?? ""
            if let parsed = HeartbeatFields.date(lead?.time) { time = parsed }
        }
    }

    private var timeText: String { HeartbeatFields.text(time) }

    private func save() async {
        busy = true
        defer { busy = false }
        do {
            try await operation.run(currentServer: { app.serverURL }, work: { client in
                let newLead = leadId.isEmpty ? nil : leadId
                if newLead != lead?.threadId { try await client.setSpaceLead(space.id, threadId: newLead) }
                // Clearing the lead turns the heartbeat off on the server.
                if newLead != nil, beating || lead?.heartbeat != nil {
                    let custom = cadence == "custom" ? cron.trimmingCharacters(in: .whitespaces) : nil
                    try await client.setSpaceHeartbeat(space.id, enabled: beating, cadence: cadence, time: timeText, cron: custom)
                }
            }, completion: { _ in
                Task { await saved() }
                dismiss()
            })
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }
}

/// The cadence, time and cron fields a heartbeat is set with, shared by a Space's
/// lead and the Chief of Staff.
struct HeartbeatFields: View {
    @Binding var cadence: String
    @Binding var time: Date
    @Binding var cron: String

    var body: some View {
        Picker("Every", selection: $cadence) {
            ForEach(SpaceLead.cadences, id: \.id) { Text($0.label).tag($0.id) }
        }
        if cadence == "custom" {
            TextField("Cron (minute hour day month weekday)", text: $cron)
                .font(.body.monospaced())
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
        } else if ["daily", "weekdays", "weekly", "hourly", "every2hours", "every6hours"].contains(cadence) {
            DatePicker(cadence.hasPrefix("every") || cadence == "hourly" ? "At minute" : "At", selection: $time,
                displayedComponents: .hourAndMinute)
        }
    }

    static func date(_ text: String?) -> Date? {
        guard let parts = text?.split(separator: ":"), parts.count == 2, let hour = Int(parts[0]), let minute = Int(parts[1]) else { return nil }
        return Calendar.current.date(bySettingHour: hour, minute: minute, second: 0, of: .now)
    }

    static func text(_ date: Date) -> String {
        let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", parts.hour ?? 9, parts.minute ?? 0)
    }
}

/// Sets the heartbeat that wakes the Chief of Staff (`chief_of_staff_set_run`).
struct ChiefHeartbeatSheet: View {
    var saved: () async -> Void = {}
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    @Environment(\.dismiss) private var dismiss
    @State private var chief: SpaceLead?
    @State private var loaded = false
    @State private var beating = false
    @State private var cadence = "hourly"
    @State private var time = Date()
    @State private var cron = ""
    @State private var busy = false
    @State private var error: String?

    private var hasChief: Bool { chief?.threadId != nil }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle("Heartbeat", isOn: $beating).disabled(!hasChief)
                    if beating, hasChief { HeartbeatFields(cadence: $cadence, time: $time, cron: $cron) }
                } footer: {
                    Text(!loaded ? "Loading…" : hasChief ? "Wakes the Chief of Staff on this schedule." : "Set a Chief of Staff to turn on the heartbeat.")
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
            }
            .navigationTitle("Chief of Staff Heartbeat")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(busy || !hasChief || (beating && cadence == "custom" && cron.trimmingCharacters(in: .whitespaces).isEmpty))
                }
            }
        }
        .task {
            do {
                chief = try await app.client.chiefOfStaff()
            } catch {
                self.error = BBClient.describe(error, server: app.client.baseURL)
            }
            loaded = true
            beating = chief?.heartbeat != nil
            cadence = chief?.heartbeat ?? "hourly"
            cron = chief?.cron ?? ""
            if let parsed = HeartbeatFields.date(chief?.time) { time = parsed }
        }
    }

    private func save() async {
        busy = true
        defer { busy = false }
        do {
            try await operation.run(currentServer: { app.serverURL }, work: { client in
                let custom = cadence == "custom" ? cron.trimmingCharacters(in: .whitespaces) : nil
                try await client.setChiefOfStaffHeartbeat(enabled: beating, cadence: cadence, time: HeartbeatFields.text(time), cron: custom)
            }, completion: { _ in
                Task { await saved() }
                dismiss()
            })
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }
}
