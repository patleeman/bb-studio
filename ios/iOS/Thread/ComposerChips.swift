import SwiftUI

/// A state that lasts, pinned in a Bot conversation's composer top row while
/// it is true: the Bot paused, plan mode, a goal, todos, notes in progress, editing the last message, the next
/// message's permissions, a hand-off running. Tapping it does its one thing;
/// ✕ (when it has one) undoes it.
struct ComposerChip: Identifiable, Equatable {
    enum Kind: String, Equatable {
        case paused, planMode, goal, todos, notes, editing, permission, handingOff
    }

    var kind: Kind
    var icon: String
    var text: String
    /// The tap's word, shown in the accent ("Resume"); nil when the chip itself is the button.
    var action: String?
    var closes = false
    var busy = false
    var id: String { kind.rawValue }

    /// The chips, in a fixed order, for what holds now.
    static func chips(pause: String?, planning: Bool, goal: String?, todos: [Todos.Item],
                      note: Bool, editing: Bool, permission: String?, handingOff: Bool) -> [ComposerChip] {
        var out: [ComposerChip] = []
        if let pause {
            out.append(ComposerChip(kind: .paused, icon: pause == "stopped" ? "stop.circle" : "pause.circle",
                                    text: pause == "stopped" ? "Stopped" : "Paused", action: "Resume"))
        }
        if planning { out.append(ComposerChip(kind: .planMode, icon: "list.bullet.clipboard", text: "Plan mode")) }
        if goal != nil { out.append(ComposerChip(kind: .goal, icon: "target", text: "Goal")) }
        if !todos.isEmpty {
            let done = todos.filter { $0.status == "completed" }.count
            out.append(ComposerChip(kind: .todos, icon: "checklist", text: "\(done)/\(todos.count) todos"))
        }
        if note { out.append(ComposerChip(kind: .notes, icon: "doc.text", text: "Notes", action: "Open")) }
        if editing { out.append(ComposerChip(kind: .editing, icon: "pencil", text: "Editing last message", closes: true)) }
        if let permission { out.append(ComposerChip(kind: .permission, icon: "lock.shield", text: "Next: \(PermissionMode.label(permission))", closes: true)) }
        if handingOff { out.append(ComposerChip(kind: .handingOff, icon: "arrow.triangle.2.circlepath", text: "Handing off", busy: true)) }
        return out
    }
}

/// The composer's top row of chips. Each chip is a menu where it has more
/// than one action (Plan mode, Goal), else a button; ✕ undoes.
struct ComposerChipsRow: View {
    let chips: [ComposerChip]
    /// The goal's objective, for its menu.
    var goal: String?
    let tap: (ComposerChip.Kind) -> Void
    let close: (ComposerChip.Kind) -> Void

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 6) {
                ForEach(chips) { chip in
                    HStack(spacing: 0) {
                        body(chip)
                        if chip.closes {
                            Button { close(chip.kind) } label: {
                                Image(systemName: "xmark").font(.caption2.weight(.bold))
                                    .frame(width: 32, height: 44).contentShape(.rect)
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(.secondary)
                            .accessibilityLabel("Cancel \(chip.text)")
                            .accessibilityIdentifier("chip-\(chip.kind.rawValue)-close")
                        }
                    }
                    .padding(.leading, 10)
                    .padding(.trailing, chip.closes ? 0 : 10)
                    .frame(minHeight: 30)
                    .background(.fill.tertiary, in: .capsule)
                    .frame(minHeight: 44)
                    .contentShape(.rect)
                }
            }
            .padding(.horizontal, 10)
        }
        .scrollIndicators(.hidden)
        .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
        .font(.footnote)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("composerChips")
    }

    @ViewBuilder private func body(_ chip: ComposerChip) -> some View {
        let label = HStack(spacing: 5) {
            if chip.busy { RunningGlyph().accessibilityHidden(true) } else { Image(systemName: chip.icon).foregroundStyle(.secondary) }
            Text(chip.text).lineLimit(1)
            if let action = chip.action { Text(action).fontWeight(.semibold).foregroundStyle(.tint) }
        }
        .frame(minHeight: 44)
        .contentShape(.rect)
        switch chip.kind {
        case .planMode:
            Menu {
                Button { tap(.planMode) } label: { Label("Exit plan mode", systemImage: "xmark.circle") }
            } label: { label }
            .accessibilityIdentifier("chip-\(chip.kind.rawValue)")
        case .goal:
            Menu {
                if let goal { Section(goal) {} }
                Button(role: .destructive) { tap(.goal) } label: { Label("Clear goal", systemImage: "xmark.circle") }
            } label: { label }
            .accessibilityIdentifier("chip-\(chip.kind.rawValue)")
        default:
            Button { tap(chip.kind) } label: { label }
                .buttonStyle(.plain)
                .disabled(chip.kind == .handingOff)
                .accessibilityLabel([chip.text, chip.action].compactMap { $0 }.joined(separator: ", "))
                .accessibilityIdentifier("chip-\(chip.kind.rawValue)")
        }
    }
}

/// The composer's one small status line (round 7): working and for how
/// long, work running in the background, and how many messages wait in the
/// queue. Plain text, no row of its own: "Working · 11s · 1 in background";
/// the background part opens what runs (its name and how long), and goes
/// where the line has no room for it.
struct ComposerStatus: Equatable {
    var running: Bool
    /// When the running turn began (the last message sent, in ms).
    var since: Double?
    var queued: Int
    var background: [BackgroundWork] = []

    var shown: Bool { running || queued > 0 || !background.isEmpty }

    /// "1 in background", or nil with nothing there.
    var backgroundText: String? { background.isEmpty ? nil : "\(background.count) in background" }

    /// "Working · 1m 12s", "Working · 40s", or "Working" without a start.
    static func working(since: Double?, now: Date) -> String {
        guard let since else { return "Working" }
        return "Working · " + duration(since: since, now: now)
    }

    /// "40s", "1m 12s", "2h 5m": how long since `since` (ms).
    static func duration(since: Double, now: Date) -> String {
        let seconds = max(0, Int(now.timeIntervalSince1970 - since / 1000))
        if seconds < 60 { return "\(seconds)s" }
        if seconds < 3600 { return "\(seconds / 60)m \(seconds % 60)s" }
        return "\(seconds / 3600)h \(seconds % 3600 / 60)m"
    }

    /// A background task's line in its menu: "Run the test suite · 2m 3s".
    static func line(_ work: BackgroundWork, now: Date) -> String {
        guard let started = work.startedAt else { return work.name }
        return work.name + " · " + duration(since: started, now: now)
    }
}

struct ComposerStatusLine: View {
    let status: ComposerStatus
    let showQueue: () -> Void

    var body: some View {
        HStack(spacing: 6) {
            if status.running || !status.background.isEmpty { RunningGlyph().accessibilityHidden(true) }
            // The background part goes first where the line is too narrow.
            ViewThatFits(in: .horizontal) {
                leading(background: true)
                leading(background: false)
            }
            Spacer(minLength: 8)
            if status.queued > 0 {
                Button(action: showQueue) { Text("\(status.queued) queued").frame(minHeight: 28).contentShape(.rect) }
                    .buttonStyle(.plain)
                    .fixedSize()
                    .accessibilityIdentifier("composerQueued")
            }
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .padding(.horizontal, 12)
        .frame(minHeight: 28)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("composerStatus")
    }

    private func leading(background: Bool) -> some View {
        HStack(spacing: 0) {
            if status.running {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Text(ComposerStatus.working(since: status.since, now: context.date)).monospacedDigit()
                }
                .accessibilityIdentifier("composerWorking")
            }
            if background, let text = status.backgroundText {
                if status.running { Text(" · ") }
                ComposerBackgroundMenu(work: status.background, text: text)
            }
        }
        .fixedSize()
    }
}

/// "1 in background" in the status line: a tap lists what runs, and for how long.
private struct ComposerBackgroundMenu: View {
    let work: [BackgroundWork]
    let text: String

    var body: some View {
        Menu {
            Section("In background") {
                ForEach(work) { work in Text(ComposerStatus.line(work, now: .now)) }
            }
        } label: {
            Text(text).frame(minHeight: 28).contentShape(.rect)
        }
        .menuOrder(.fixed)
        .buttonStyle(.plain)
        .accessibilityLabel(text + ". Show")
        .accessibilityIdentifier("composerBackground")
    }
}
