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

/// By space's two-line row: a status dot, the title with its age, and the
/// thread's latest line from Studio, red when it failed and amber when blocked.
struct SpaceThreadRow: View {
    let thread: ThreadEntry
    var line: ThreadLine?
    /// "Lead", with the heartbeat when one runs.
    var badge: String?
    var hidden = false
    @ObservedObject private var muted = MutedThreads.shared
    /// Written by the thread screen as the reader types; see `Drafts`.
    @AppStorage private var draft: Data?

    init(thread: ThreadEntry, line: ThreadLine?, badge: String? = nil, hidden: Bool = false) {
        self.thread = thread
        self.line = line
        self.badge = badge
        self.hidden = hidden
        _draft = AppStorage(ServerScope.key("draft.\(thread.id)"))
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Circle()
                .fill(state.color)
                .frame(width: 8, height: 8)
                .padding(.top, 6)
                .accessibilityLabel(state.label ?? "")
                .accessibilityHidden(state.label == nil)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(ThreadTitles.resolve(thread.displayTitle))
                        .font(.body.weight(thread.isUnread ? .semibold : .regular))
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    Group {
                        if hidden { Image(systemName: "eye.slash").accessibilityLabel("Hidden") }
                        if muted.ids.contains(thread.id) { Image(systemName: "bell.slash").accessibilityLabel("Muted") }
                        Text(Self.age(Date(timeIntervalSince1970: at / 1000))).monospacedDigit()
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                HStack(spacing: 4) {
                    if let badge {
                        Text(badge).foregroundStyle(Color.accentColor)
                        if line != nil || draft != nil { Text("·") }
                    }
                    if draft != nil {
                        Text("Draft").foregroundStyle(.red)
                        if line != nil { Text("·") }
                    }
                    if let line {
                        Text(line.text).foregroundStyle(lineColor(line.kind))
                    } else if badge == nil, draft == nil {
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

/// An open Studio item in a Space, like a tab.
struct SpaceItemRow: View {
    let item: SpaceOpenItem

    var body: some View {
        HStack(spacing: 10) {
            Group {
                if let emoji = item.emoji {
                    Text(emoji)
                } else {
                    Image(systemName: symbol).foregroundStyle(.secondary)
                }
            }
            .frame(width: 22)
            VStack(alignment: .leading, spacing: 1) {
                Text(item.title).lineLimit(1)
                if !item.kindLabel.isEmpty {
                    Text(item.kindLabel).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
            if item.pinned { Image(systemName: "pin.fill").font(.caption2).foregroundStyle(.secondary).accessibilityLabel("Pinned") }
        }
    }

    private var symbol: String {
        switch Route(href: item.href) {
        case .page: StudioKind.of("page").symbol
        case .drawing: StudioKind.of("drawing").symbol
        case .artifact: StudioKind.of("artifact").symbol
        case .recording: StudioKind.of("recording").symbol
        case .table: "tablecells"
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
                    if beating, !leadId.isEmpty {
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
            if let parts = lead?.time?.split(separator: ":"), parts.count == 2, let hour = Int(parts[0]), let minute = Int(parts[1]) {
                time = Calendar.current.date(bySettingHour: hour, minute: minute, second: 0, of: .now) ?? .now
            }
        }
    }

    private var timeText: String {
        let parts = Calendar.current.dateComponents([.hour, .minute], from: time)
        return String(format: "%02d:%02d", parts.hour ?? 9, parts.minute ?? 0)
    }

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
