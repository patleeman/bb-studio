import SwiftUI

extension EnvironmentValues {
    /// Puts text in the Bot chat's composer, for Nudge them, which never sends on its own.
    @Entry var loopDraft: ((String) -> Void)?
}

/// A `::loop{id}` card in the Bot's chat: what it is, why, and one-tap
/// buttons by kind. It updates in place: handed off it says who's on it,
/// closed it collapses to one line with Undo. With the Attention Router off
/// it's a quiet placeholder.
struct LoopCard: View {
    let id: String
    @State private var model = LoopsModel.shared
    @State private var pending: LoopAction?
    @State private var error: String?
    @State private var sheet: LoopSheet?
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.duoLayout) private var duoLayout
    @Environment(\.loopDraft) private var draft
    @EnvironmentObject private var app: AppModel

    private var state: LoopCardState {
        let detail = model.detail(id)
        return LoopCardState(enabled: model.enabled, loop: detail?.loop, chosen: detail?.chosen,
                             failure: model.failure(id), pending: pending, error: error)
    }

    /// Wide layouts (the unfolded Duo, an iPad) show every button, as on the desktop.
    private var wide: Bool { duoLayout.twoPages || sizeClass == .regular }

    var body: some View {
        let state = state
        // A container of its own, so tests and VoiceOver find each card by its loop.
        VStack(spacing: 0) {
            switch state.phase {
            case .loading: LoopCardSkeleton()
            case .off: LoopOffPlaceholder()
            case .missing(let message): LoopMissing(message: message)
            case .open: openCard(state)
            case .handedOff: if let loop = state.loop { LoopHandedOff(loop: loop, since: model.detail(id)?.handedOffAt, pending: pending, run: run) }
            case .closed: if let loop = state.loop { LoopCollapsed(loop: loop, label: state.closedLabel, canUndo: state.canUndo, pending: pending, run: run) }
            case .waiting: if let loop = state.loop { LoopSnoozed(loop: loop, pending: pending, run: run) }
            }
        }
        .animation(.smooth(duration: 0.25), value: state.phase)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("loop-\(id)")
        .task(id: model.enabled) {
            await model.checkEnabled()
            if model.enabled == true, model.detail(id) == nil { await model.load(id) }
        }
        .sheet(item: $sheet) { sheet in
            if let loop = state.loop {
                switch sheet {
                case .snooze: LoopSnoozeSheet(loop: loop) { run(.snooze($0)) }
                case .choose: LoopChooseSheet(loop: loop) { run(.choose($0)) }
                }
            }
        }
    }

    private func openCard(_ state: LoopCardState) -> some View {
        LoopOpenCard(state: state, wide: wide, run: tap, handOff: { run(.handOff(owner: $0)) }, handOffTargets: model.handOffTargets)
    }

    private func tap(_ button: LoopCardState.Button) {
        guard let loop = state.loop else { return }
        switch button {
        case .done: run(.done)
        case .gotIt: run(.gotIt)
        case .drop: run(.drop)
        case .keep: run(.keep)
        case .option(let option): run(.choose(option))
        case .snooze: sheet = .snooze
        case .chooseSheet: sheet = .choose
        case .handOff: run(.handOff(owner: "cos"))
        case .nudge:
            if let draft { draft(LoopFormat.nudgeDraft(loop)) } else { app.draftForBot(LoopFormat.nudgeDraft(loop)) }
        }
    }

    private func run(_ action: LoopAction) {
        var state = state
        guard state.begin(action) else { return }
        sheet = nil
        pending = action
        error = nil
        Task {
            do {
                try await model.perform(id, action)
                pending = nil
            } catch {
                pending = nil
                self.error = BBClient.describe(error)
            }
        }
    }
}

enum LoopSheet: String, Identifiable {
    case snooze, choose
    var id: String { rawValue }
}

/// The card while open: header, title, why, and its buttons.
private struct LoopOpenCard: View {
    let state: LoopCardState
    let wide: Bool
    let run: (LoopCardState.Button) -> Void
    let handOff: (String) -> Void
    let handOffTargets: [(owner: String, name: String)]

    var body: some View {
        let loop = state.loop!
        let buttons = state.buttons(wide: wide)
        VStack(alignment: .leading, spacing: 10) {
            LoopCardHeader(loop: loop)
            VStack(alignment: .leading, spacing: 4) {
                Text(loop.title).font(.headline).fixedSize(horizontal: false, vertical: true)
                if !loop.why.isEmpty {
                    Text(loop.why).font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            if loop.kind == .decide && loop.options.count <= LoopCardState.inlineOptions {
                LoopOptionButtons(options: loop.options, pending: state.pending) { run(.option($0)) }
                LoopButtonRow(buttons: buttons.shown.filter { if case .option = $0 { false } else { true } },
                              more: buttons.more, pending: state.pending, run: run, handOff: handOff, handOffTargets: handOffTargets)
            } else {
                LoopButtonRow(buttons: buttons.shown, more: buttons.more, pending: state.pending, run: run, handOff: handOff, handOffTargets: handOffTargets)
            }
            if let error = state.error {
                Label(error, systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(.orange)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .secondarySystemBackground), in: .rect(cornerRadius: 20, style: .continuous))
        .accessibilityElement(children: .contain)
    }
}

struct LoopCardHeader: View {
    let loop: LoopItem

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: LoopFormat.kindSymbol(loop.kind))
            Text(LoopFormat.header(loop)).lineLimit(1)
            if loop.priority == .urgent {
                Text("Urgent").font(.caption2.weight(.bold)).foregroundStyle(.white)
                    .padding(.horizontal, 6).padding(.vertical, 2).background(.red, in: .capsule)
            }
            Spacer(minLength: 8)
            if let corner = LoopFormat.corner(loop) {
                Text(corner).foregroundStyle(corner == "Today" ? Color.accentColor : .secondary)
            }
        }
        .font(.subheadline)
        .foregroundStyle(.secondary)
    }
}

/// A decision's options, full width, two lines each.
private struct LoopOptionButtons: View {
    let options: [String]
    let pending: LoopAction?
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
            }
        }
    }
}

/// Pill buttons, the first filled, and ⋯ for the rest.
private struct LoopButtonRow: View {
    let buttons: [LoopCardState.Button]
    let more: [LoopCardState.Button]
    let pending: LoopAction?
    let run: (LoopCardState.Button) -> Void
    let handOff: (String) -> Void
    let handOffTargets: [(owner: String, name: String)]

    var body: some View {
        FlowLayout(spacing: 8) {
            ForEach(Array(buttons.enumerated()), id: \.element) { index, button in
                if button == .handOff {
                    handOffMenu { LoopPill(title: button.label, style: .secondary, busy: isPending(button)) }
                } else {
                    Button { run(button) } label: {
                        LoopPill(title: button.label, style: style(button, first: index == 0), busy: isPending(button))
                    }
                    .buttonStyle(.plain)
                    .disabled(pending != nil)
                }
            }
            if !more.isEmpty {
                Menu {
                    ForEach(more, id: \.self) { button in
                        if button == .handOff {
                            handOffMenu { Label("Hand off…", systemImage: "arrowshape.turn.up.right") }
                        } else {
                            Button(role: button == .drop ? .destructive : nil) { run(button) } label: {
                                Label(button.label, systemImage: symbol(button))
                            }
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.body.weight(.semibold))
                        .frame(width: 40, height: 36)
                        .background(.fill.tertiary, in: .capsule)
                }
                .accessibilityLabel("More actions")
                .disabled(pending != nil)
            }
        }
    }

    @ViewBuilder
    private func handOffMenu<Label: View>(@ViewBuilder label: () -> Label) -> some View {
        Menu {
            Section("Hand off to") {
                ForEach(handOffTargets, id: \.owner) { target in
                    Button(target.name) { handOff(target.owner) }
                }
            }
        } label: { label() }
        .disabled(pending != nil)
    }

    private func isPending(_ button: LoopCardState.Button) -> Bool {
        switch (button, pending) {
        case (.done, .done?), (.gotIt, .gotIt?), (.drop, .drop?), (.keep, .keep?), (.handOff, .handOff?): true
        default: false
        }
    }

    private func style(_ button: LoopCardState.Button, first: Bool) -> LoopPill.Style {
        if button == .drop { return .plain }
        return first && [.done, .gotIt].contains(button) ? .primary : .secondary
    }

    private func symbol(_ button: LoopCardState.Button) -> String {
        switch button {
        case .done: "checkmark"
        case .drop: "xmark"
        case .keep: "pin"
        case .snooze: "clock"
        default: "circle"
        }
    }
}

struct LoopPill: View {
    enum Style { case primary, secondary, plain }
    let title: String
    let style: Style
    var busy = false

    var body: some View {
        HStack(spacing: 6) {
            if busy { ProgressView().controlSize(.small) }
            Text(title)
        }
        .font(.body.weight(style == .primary ? .semibold : .regular))
        .foregroundStyle(style == .primary ? Color.black : style == .plain ? .secondary : .primary)
        .padding(.horizontal, style == .plain ? 6 : 16)
        .frame(minHeight: 36)
        .background {
            switch style {
            case .primary: Capsule().fill(Color.accentColor)
            case .secondary: Capsule().fill(.fill.tertiary)
            case .plain: Color.clear
            }
        }
        .contentShape(.capsule)
    }
}

/// "Larkspur lead is on it · 12 min", with Open thread and Take back.
private struct LoopHandedOff: View {
    let loop: LoopItem
    let since: Date?
    let pending: LoopAction?
    let run: (LoopAction) -> Void
    @EnvironmentObject private var app: AppModel
    @State private var model = LoopsModel.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: LoopFormat.kindSymbol(loop.kind))
                Text(["Handed off", loop.area].compactMap { $0 }.joined(separator: " · "))
            }
            .font(.subheadline).foregroundStyle(.secondary)
            Text(loop.title).font(.headline)
            HStack(spacing: 6) {
                Circle().fill(.green).frame(width: 8, height: 8)
                Text("\(model.ownerName(loop.owner)) is on it").font(.subheadline.weight(.semibold))
                Text("· \(LoopFormat.since(since ?? loop.updatedAt))").font(.subheadline).foregroundStyle(.secondary)
            }
            HStack(spacing: 8) {
                if let thread = loop.ownerThreadId {
                    Button { app.openThread(thread) } label: {
                        Label("Open thread", systemImage: "bubble.left")
                            .padding(.horizontal, 14).frame(minHeight: 36)
                            .background(.fill.tertiary, in: .capsule)
                    }
                    .buttonStyle(.plain)
                }
                Button { run(.takeBack) } label: {
                    LoopPill(title: "Take back", style: .plain, busy: pending == .takeBack)
                }
                .buttonStyle(.plain)
                .disabled(pending != nil)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .secondarySystemBackground), in: .rect(cornerRadius: 20, style: .continuous))
        .accessibilityElement(children: .contain)
    }
}

/// A closed loop on one line, with Undo when you closed it.
private struct LoopCollapsed: View {
    let loop: LoopItem
    let label: String
    let canUndo: Bool
    let pending: LoopAction?
    let run: (LoopAction) -> Void

    private var symbol: String {
        if loop.status == .dropped { return "xmark.circle" }
        switch loop.kind {
        case .read: return "book"
        case .decide: return "arrow.triangle.branch"
        default: return "checkmark.circle"
        }
    }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: symbol).foregroundStyle(loop.status == .dropped ? Color.secondary : .green)
            (Text(label).fontWeight(.semibold) + Text(" · \(loop.title)").foregroundStyle(.secondary))
                .lineLimit(1)
            Spacer(minLength: 4)
            if let closed = loop.closedAt {
                Text(closed.formatted(.dateTime.hour(.defaultDigits(amPM: .omitted)).minute())).font(.subheadline).foregroundStyle(.secondary)
            }
            if canUndo {
                Button { run(.undo) } label: {
                    if pending == .undo { ProgressView().controlSize(.small) } else { Image(systemName: "arrow.uturn.backward") }
                }
                .buttonStyle(.borderless)
                .disabled(pending != nil)
                .accessibilityLabel("Undo")
            }
        }
        .font(.subheadline)
        .padding(.horizontal, 14).padding(.vertical, 12)
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(.separator))
        .accessibilityElement(children: .contain)
    }
}

/// Snoozed or queued: when it comes back, and Surface now (Undo for a snooze).
private struct LoopSnoozed: View {
    let loop: LoopItem
    let pending: LoopAction?
    let run: (LoopAction) -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: LoopFormat.triggerSymbol(loop.trigger)).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(loop.title).fontWeight(.semibold).lineLimit(1)
                Text("\(loop.status == .snoozed ? "Snoozed" : "Later") · \(LoopFormat.trigger(loop.trigger))")
                    .foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 4)
            Button { run(.undo) } label: {
                if pending == .undo { ProgressView().controlSize(.small) } else { Image(systemName: "arrow.uturn.backward") }
            }
            .buttonStyle(.borderless)
            .disabled(pending != nil)
            .accessibilityLabel("Bring it back now")
        }
        .font(.subheadline)
        .padding(.horizontal, 14).padding(.vertical, 12)
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(.separator))
        .accessibilityElement(children: .contain)
    }
}

/// The Attention Router is off: say so quietly instead of a card.
struct LoopOffPlaceholder: View {
    var body: some View {
        Label("Attention Router is off", systemImage: "tray")
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 14).padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(.separator, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
            .accessibilityIdentifier("loop-card-off")
    }
}

private struct LoopMissing: View {
    let message: String
    var body: some View {
        Label(message, systemImage: "questionmark.circle")
            .font(.subheadline).foregroundStyle(.secondary)
            .padding(.horizontal, 14).padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(.separator))
    }
}

private struct LoopCardSkeleton: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 20, style: .continuous)
            .fill(Color(uiColor: .secondarySystemBackground))
            .frame(height: 120)
            .overlay(ProgressView())
    }
}

/// Snooze's choices with when each comes back. A sheet on the phone.
struct LoopSnoozeSheet: View {
    let loop: LoopItem
    let pick: (LoopSnooze) -> Void
    @State private var picking = false
    @State private var date = Date().addingTimeInterval(3600)
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach([LoopSnooze.laterToday, .tonight, .tomorrow, .weekend], id: \.self) { row($0) }
                }
                Section { row(.home) }
                Section {
                    if picking {
                        DatePicker("Snooze until", selection: $date, in: Date()..., displayedComponents: [.date, .hourAndMinute])
                        Button("Snooze until then") { pick(.at(date)) }
                    } else {
                        Button { picking = true } label: { Label("Pick a time…", systemImage: "calendar.badge.clock") }
                    }
                }
            }
            .navigationTitle("Snooze")
            .navigationBarTitleDisplayMode(.inline)
            .accessibilityIdentifier("loop-snooze-sheet")
            .toolbar {
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 0) {
                        Text("Snooze").font(.headline)
                        Text(loop.title).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
        .presentationDetents([.large])
    }

    private func row(_ snooze: LoopSnooze) -> some View {
        Button { pick(snooze) } label: {
            HStack {
                Label(snooze.label, systemImage: snooze.symbol)
                Spacer()
                Text(when(snooze)).foregroundStyle(.secondary)
            }
        }
        .tint(.primary)
    }

    private func when(_ snooze: LoopSnooze) -> String {
        guard let date = snooze.date() else { return "Home" }
        if snooze == .laterToday || snooze == .tonight { return date.formatted(date: .omitted, time: .shortened) }
        return date.formatted(.dateTime.weekday(.abbreviated).hour().minute())
    }
}

/// More than three options: the whole list in a sheet.
struct LoopChooseSheet: View {
    let loop: LoopItem
    let choose: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if !loop.why.isEmpty { Section { Text(loop.why).foregroundStyle(.secondary) } }
                Section {
                    ForEach(loop.options, id: \.self) { option in
                        let parts = LoopOption(option)
                        Button { choose(option) } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(parts.title).font(.body.weight(.semibold))
                                if let detail = parts.detail { Text(detail).font(.subheadline).foregroundStyle(.secondary) }
                            }
                        }
                        .tint(.primary)
                    }
                }
            }
            .navigationTitle(loop.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }
}
