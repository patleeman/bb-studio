import SwiftUI

/// A bot's automations (`bot_automations`): check-ins, reminders, watchers and
/// runners in one list. Swipe to pause or delete; tap for the details, recent
/// runs, Run now and Edit; + makes one of each kind. "Turn off check-ins"
/// pauses every check-in, the old sheet's Off.
struct BotAutomationsSheet: View {
    var botId: String? = nil
    var botName: String = BotInfo.defaultName
    var active = true
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var automations: [BotAutomation]?
    @State private var editing: Editing?
    @State private var deleting: BotAutomation?
    @State private var busy = false
    @State private var error: String?

    struct Editing: Identifiable { var kind: BotAutomation.Kind; var automation: BotAutomation?; var id: String { automation?.id ?? "new-\(kind.rawValue)" } }

    var body: some View {
        NavigationStack {
            List {
                if let error { Section { Text(error).foregroundStyle(.red).font(.callout) } }
                ForEach(BotAutomation.Kind.allCases) { kind in
                    let rows = (automations ?? []).filter { $0.kind == kind }
                    if !rows.isEmpty {
                        Section(kind == .checkin ? "Check-ins" : kind.title + "s") {
                            ForEach(rows) { automation in
                                NavigationLink {
                                    BotAutomationDetail(automation: automation, botId: botId, active: active) { editing = Editing(kind: automation.kind, automation: automation) } changed: { await load() }
                                } label: { BotAutomationRow(automation: automation) }
                                .swipeActions(edge: .trailing) {
                                    Button(role: .destructive) { deleting = automation } label: { Label(automation.original ? "Turn off" : "Delete", systemImage: "trash") }
                                    if automation.state == "active" || automation.state == "paused" {
                                        Button { act(automation.active ? .pause : .resume, automation) } label: {
                                            Label(automation.active ? "Pause" : "Resume", systemImage: automation.active ? "pause" : "play")
                                        }.tint(.orange)
                                    }
                                }
                            }
                        }
                    }
                }
                if let automations, automations.contains(where: { $0.kind == .checkin && $0.active }) {
                    Section {
                        Button("Turn off check-ins", role: .destructive) { Task { await checkinsOff() } }.disabled(busy)
                    } footer: { Text("Pauses every check-in; \(botName) then only wakes when you write.") }
                }
            }
            .overlay {
                if automations == nil, error == nil { ProgressView() }
                else if automations?.isEmpty == true {
                    ContentUnavailableView("No check-ins", systemImage: "alarm", description: Text("\(botName) only wakes when you write. Add a check-in, reminder or watcher with +."))
                }
            }
            .refreshable { await load() }
            .navigationTitle("Automations")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        ForEach(BotAutomation.Kind.allCases) { kind in
                            Button { editing = Editing(kind: kind, automation: nil) } label: { Label(kind.title, systemImage: kind.symbol) }
                        }
                    } label: { Image(systemName: "plus") }
                    .disabled(!active)
                    .accessibilityLabel("New automation")
                }
            }
            .sheet(item: $editing) { editing in
                BotAutomationEditor(kind: editing.kind, automation: editing.automation, botId: botId, runners: (automations ?? []).filter { $0.kind == .runner }) { await load() }
            }
            .confirmationDialog(deleting.map { $0.original ? "Turn off the check-in?" : "Delete \($0.name)?" } ?? "", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
                if let deleting {
                    Button(deleting.original ? "Turn off" : "Delete", role: .destructive) {
                        Task {
                            if deleting.original { act(.pause, deleting) } else { await run { try await app.client.deleteBotAutomation(id: deleting.id, botId: botId) } }
                        }
                    }
                }
            }
            .task { await load() }
        }
    }

    private func load() async {
        #if DEBUG
        if let demo = BotDemo.current { automations = demo.automations; return }
        #endif
        do { automations = try await app.client.botAutomations(botId: botId); error = nil } catch { self.error = BBClient.describe(error, server: app.client.baseURL) }
    }

    private func run(_ work: @escaping () async throws -> Void) async {
        busy = true
        defer { busy = false }
        do { try await work(); await load() } catch { self.error = BBClient.describe(error, server: app.client.baseURL) }
    }

    private func act(_ action: BBClient.BotAutomationAction, _ automation: BotAutomation) {
        Task { await run { _ = try await app.client.botAutomation(action, id: automation.id, botId: botId) } }
    }

    private func checkinsOff() async {
        await run {
            for each in (automations ?? []) where each.kind == .checkin && each.active {
                _ = try await app.client.botAutomation(.pause, id: each.id, botId: botId)
            }
        }
    }
}

struct BotAutomationRow: View {
    let automation: BotAutomation
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: automation.kind.symbol).foregroundStyle(automation.active ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary)).frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(automation.name).foregroundStyle(automation.active ? .primary : .secondary).lineLimit(1)
                Text(automation.scheduleText).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 4)
            Text(status).font(.caption).foregroundStyle(.secondary).monospacedDigit()
        }
        .accessibilityElement(children: .combine)
    }

    private var status: String {
        switch automation.state {
        case "paused": "Paused"
        case "done": "Done"
        case "ended": "Ended"
        default: automation.nextRunAt.map { Date(timeIntervalSince1970: $0 / 1000).formatted(.dateTime.weekday(.abbreviated).hour().minute()) } ?? ""
        }
    }
}

/// One automation: what it does, its schedule, recent runs, and its actions.
struct BotAutomationDetail: View {
    let automation: BotAutomation
    var botId: String?
    var active: Bool
    var edit: () -> Void
    var changed: () async -> Void
    @EnvironmentObject private var app: AppModel
    @State private var current: BotAutomation?
    @State private var runs: [BotAutomationRun]?
    @State private var error: String?
    @State private var busy = false

    private var shown: BotAutomation { current ?? automation }

    var body: some View {
        List {
            Section {
                LabeledContent("Kind", value: shown.kind.title)
                LabeledContent("Schedule", value: shown.scheduleText)
                if let next = shown.nextRunAt, shown.active { LabeledContent("Next run", value: Date(timeIntervalSince1970: next / 1000).formatted(date: .abbreviated, time: .shortened)) }
                if shown.kind == .watcher, shown.target != "main" { LabeledContent("Wakes", value: shown.targetName) }
                if let model = shown.model?.model { LabeledContent("Model", value: [model, shown.model?.reasoning].compactMap { $0 }.joined(separator: " · ")) }
            }
            Section(shown.kind == .watcher ? "Script" : shown.kind == .runner ? "Job" : "Instruction") {
                if let script = shown.script {
                    Text(script.body).font(.caption.monospaced()).textSelection(.enabled)
                    if !shown.instruction.isEmpty { Text("With its output: \(shown.instruction)").font(.callout).foregroundStyle(.secondary) }
                } else {
                    Text(shown.instruction)
                }
            }
            Section {
                if shown.state == "active" || shown.state == "paused" {
                    Button(shown.active ? "Pause" : "Resume", systemImage: shown.active ? "pause" : "play") { act(shown.active ? .pause : .resume) }
                        .disabled(busy || (!shown.active && !active))
                }
                if shown.state != "done" { Button("Run now", systemImage: "bolt") { act(.runNow) }.disabled(busy || !active) }
                Button("Edit", systemImage: "pencil", action: edit)
            }
            Section("Recent runs") {
                if let runs, !runs.isEmpty {
                    ForEach(runs) { run in
                        HStack(alignment: .firstTextBaseline) {
                            Text(Date(timeIntervalSince1970: run.at / 1000).formatted(.dateTime.weekday(.abbreviated).hour().minute())).font(.caption).foregroundStyle(.secondary).monospacedDigit().frame(width: 92, alignment: .leading)
                            Text(run.outcome + (run.manual ? " · manual" : "")).font(.callout).foregroundStyle(run.status == "failed" ? .red : run.outcome.hasPrefix("Woke") ? .primary : .secondary).lineLimit(3)
                        }
                    }
                } else {
                    Text(runs == nil ? "Loading…" : "No runs yet.").foregroundStyle(.secondary)
                }
            }
            if let error { Section { Text(error).foregroundStyle(.red) } }
        }
        .navigationTitle(shown.name)
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await loadRuns() }
        .task { await loadRuns() }
    }

    private func loadRuns() async {
        #if DEBUG
        if let demo = BotDemo.current { runs = demo.automationRuns; return }
        #endif
        do { runs = try await app.client.botAutomationRuns(id: automation.id, botId: botId) } catch { self.error = BBClient.describe(error, server: app.client.baseURL) }
    }

    private func act(_ action: BBClient.BotAutomationAction) {
        Task {
            busy = true
            defer { busy = false }
            do {
                current = try await app.client.botAutomation(action, id: automation.id, botId: botId)
                error = nil
                await changed()
                if action == .runNow { try? await Task.sleep(for: .seconds(2)) }
                await loadRuns()
            } catch { self.error = BBClient.describe(error, server: app.client.baseURL) }
        }
    }
}

/// New or Edit: name, instruction or script, the schedule, and a model for agent kinds.
struct BotAutomationEditor: View {
    let kind: BotAutomation.Kind
    let automation: BotAutomation?
    var botId: String?
    var runners: [BotAutomation] = []
    var saved: () async -> Void
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var draft = BotAutomationDraft()
    @State private var busy = false
    @State private var error: String?
    @State private var loaded = false

    private var original: Bool { automation?.original == true }
    private var ok: Bool {
        if original { return true }
        let name = draft.name.trimmingCharacters(in: .whitespaces)
        return !name.isEmpty && (kind == .watcher ? !draft.script.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty : !draft.instruction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    var body: some View {
        NavigationStack {
            Form {
                if original {
                    Section { Text("The bot's original check-in: what it does is its Memory page's Check-in section. It takes one repeating schedule.").font(.callout).foregroundStyle(.secondary) }
                } else {
                    Section {
                        TextField("Name", text: $draft.name)
                        if kind == .watcher {
                            Picker("Interpreter", selection: $draft.interpreter) { ForEach(["bash", "sh", "node", "python3"], id: \.self) { Text($0) } }
                            TextEditor(text: $draft.script).font(.caption.monospaced()).frame(minHeight: 140).autocorrectionDisabled().textInputAutocapitalization(.never)
                            Stepper("Timeout \(draft.timeoutSeconds) s", value: $draft.timeoutSeconds, in: 5...900, step: 5)
                            TextField("With the output (optional)", text: $draft.instruction, axis: .vertical)
                            if !runners.isEmpty {
                                Picker("Wakes", selection: $draft.target) {
                                    Text("The bot").tag("main")
                                    ForEach(runners) { Text("Runner \($0.name)").tag($0.id) }
                                }
                            }
                        } else {
                            TextField(kind == .runner ? "Job" : kind == .reminder ? "Remind it to…" : "Instruction", text: $draft.instruction, axis: .vertical).lineLimit(2...6)
                        }
                    } footer: {
                        Text(kind == .watcher ? "Runs on the BB server host. Exit 0 and print the finding to wake the bot with it; print nothing (or exit non-zero) and nothing happens." : kind.blurb)
                    }
                }
                ScheduleFields(schedule: $draft.schedule, once: kind == .reminder)
                if (kind == .checkin || kind == .reminder) && !original {
                    Section {
                        TextField("The bot's model", text: $draft.model).autocorrectionDisabled().textInputAutocapitalization(.never)
                        Picker("Reasoning", selection: $draft.reasoning) {
                            Text("The bot's").tag("")
                            ForEach(["low", "medium", "high"], id: \.self) { Text($0.capitalized).tag($0) }
                        }
                    } header: { Text("Model") } footer: { Text("A cheaper model on the bot's provider suits routine runs.") }
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
            }
            .navigationTitle(automation.map { "Edit \($0.name)" } ?? "New \(kind.title.lowercased())")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button(automation == nil ? "Add" : "Save") { Task { await save() } }.disabled(busy || !ok) }
            }
            .onAppear {
                guard !loaded else { return }
                loaded = true
                if let automation { draft = BotAutomationDraft(automation) }
                else {
                    switch kind {
                    case .reminder: draft.schedule = .once(Date.now.addingTimeInterval(3600))
                    case .watcher:
                        draft.schedule = BotSchedule(type: "interval", days: BotSchedule.everyDay, every: 15, unit: "minutes", from: "00:00", to: "23:59", quiet: .init(from: "22:00", to: "07:00"))
                        draft.script = "# Print what changed; print nothing when nothing did.\n"
                    default: draft.schedule = .times(["08:00"])
                    }
                }
            }
        }
    }

    private func save() async {
        busy = true
        defer { busy = false }
        do {
            if let automation { try await app.client.updateBotAutomation(automation, draft, botId: botId) }
            else { try await app.client.createBotAutomation(kind, draft, botId: botId) }
            await saved()
            dismiss()
        } catch { self.error = BBClient.describe(error, server: app.client.baseURL) }
    }
}

/// The schedule editor: presets, repeat mode, day chips, times, interval and
/// window, quiet hours, end date, timezone, or a date for a reminder.
struct ScheduleFields: View {
    @Binding var schedule: BotSchedule
    var once = false
    private static let dayLetters = ["S", "M", "T", "W", "T", "F", "S"]
    private static let presets: [(String, BotSchedule)] = [
        ("Weekday mornings", .times(["08:00"])),
        ("Morning and evening", .times(["08:00", "18:00"], days: BotSchedule.everyDay)),
        ("Every 2 h while working", BotSchedule(type: "interval", days: BotSchedule.weekdays, every: 2, unit: "hours", from: "09:00", to: "17:00")),
        ("Mondays", .times(["09:00"], days: [1])),
    ]

    var body: some View {
        if once || schedule.type == "once" {
            Section("When") {
                DatePicker("At", selection: Binding(get: { Date(timeIntervalSince1970: (schedule.at ?? 0) / 1000) }, set: { schedule = .once($0) }), in: Date.now...)
                HStack {
                    chip("In 30 min") { schedule = .once(.now.addingTimeInterval(1800)) }
                    chip("In 2 h") { schedule = .once(.now.addingTimeInterval(7200)) }
                    chip("Tomorrow 9:00") { schedule = .once(Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: .now.addingTimeInterval(86400)) ?? .now) }
                }
            }
        } else {
            Section {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack { ForEach(Self.presets, id: \.0) { preset in chip(preset.0, on: schedule == preset.1) { schedule = preset.1 } } }
                }
                Picker("Repeat", selection: Binding(get: { schedule.type }, set: { mode($0) })) {
                    Text("At times").tag("times"); Text("Every").tag("interval"); Text("Cron").tag("cron")
                }.pickerStyle(.segmented)
                if schedule.type != "cron" {
                    HStack(spacing: 6) {
                        ForEach(0..<7, id: \.self) { day in
                            let on = (schedule.days ?? []).contains(day)
                            Button(Self.dayLetters[day]) {
                                var days = schedule.days ?? []
                                if on { days.removeAll { $0 == day } } else { days.append(day) }
                                schedule.days = days.sorted()
                            }
                            .buttonStyle(.bordered).tint(on ? .accentColor : .secondary).controlSize(.small)
                            .accessibilityLabel(Calendar.current.weekdaySymbols[day]).accessibilityAddTraits(on ? .isSelected : [])
                        }
                    }
                }
                if schedule.type == "times" {
                    ForEach(Array((schedule.times ?? []).enumerated()), id: \.offset) { index, time in
                        HStack {
                            DatePicker("Time \(index + 1)", selection: clock(time) { next in schedule.times?[index] = next }, displayedComponents: .hourAndMinute)
                            if (schedule.times ?? []).count > 1 {
                                Button { schedule.times?.remove(at: index) } label: { Image(systemName: "minus.circle.fill").foregroundStyle(.red) }.buttonStyle(.plain).accessibilityLabel("Remove time")
                            }
                        }
                    }
                    Button("Add time", systemImage: "plus") { schedule.times = (schedule.times ?? []) + ["12:00"] }
                } else if schedule.type == "interval" {
                    Stepper("Every \(schedule.every ?? 30) \(schedule.unit == "hours" ? "h" : "min")", value: Binding(get: { schedule.every ?? 30 }, set: { schedule.every = $0 }), in: 1...(schedule.unit == "hours" ? 24 : 720), step: schedule.unit == "hours" ? 1 : 5)
                    Picker("Unit", selection: Binding(get: { schedule.unit ?? "minutes" }, set: { schedule.unit = $0 })) { Text("Minutes").tag("minutes"); Text("Hours").tag("hours") }
                    DatePicker("From", selection: clock(schedule.from ?? "00:00") { schedule.from = $0 }, displayedComponents: .hourAndMinute)
                    DatePicker("To", selection: clock(schedule.to ?? "23:59") { schedule.to = $0 }, displayedComponents: .hourAndMinute)
                } else {
                    TextField("Cron (min hour day month weekday)", text: Binding(get: { schedule.cron ?? "" }, set: { schedule.cron = $0 })).font(.body.monospaced()).autocorrectionDisabled().textInputAutocapitalization(.never)
                }
            } header: { Text("Schedule") }
            Section {
                if schedule.type != "cron" {
                    Toggle("Quiet hours", isOn: Binding(get: { schedule.quiet != nil }, set: { schedule.quiet = $0 ? .init(from: "22:00", to: "07:00") : nil }))
                    if let quiet = schedule.quiet {
                        DatePicker("From", selection: clock(quiet.from) { schedule.quiet?.from = $0 }, displayedComponents: .hourAndMinute)
                        DatePicker("To", selection: clock(quiet.to) { schedule.quiet?.to = $0 }, displayedComponents: .hourAndMinute)
                    }
                }
                Toggle("End date", isOn: Binding(get: { schedule.until != nil }, set: { schedule.until = $0 ? Self.day(.now.addingTimeInterval(30 * 86400)) : nil }))
                if let until = schedule.until {
                    DatePicker("Last day", selection: Binding(get: { Self.date(until) }, set: { schedule.until = Self.day($0) }), in: Date.now..., displayedComponents: .date)
                }
                TextField("Timezone", text: Binding(get: { schedule.timezone ?? TimeZone.current.identifier }, set: { schedule.timezone = $0 })).autocorrectionDisabled().textInputAutocapitalization(.never)
            } footer: { Text("Studio turns this into BB schedules; it says what it means once saved.") }
        }
    }

    private func mode(_ type: String) {
        let days = schedule.days ?? BotSchedule.weekdays
        var next: BotSchedule = switch type {
        case "interval": BotSchedule(type: "interval", days: days, every: 30, unit: "minutes", from: "09:00", to: "18:00")
        case "cron": BotSchedule(type: "cron", cron: "0 9 * * 1-5")
        default: .times(["09:00"], days: days)
        }
        next.timezone = schedule.timezone
        next.until = schedule.until
        if type != "cron" { next.quiet = schedule.quiet }
        schedule = next
    }

    private func chip(_ title: String, on: Bool = false, action: @escaping () -> Void) -> some View {
        Button(title, action: action).buttonStyle(.bordered).controlSize(.small).tint(on ? .accentColor : .secondary)
    }

    private func clock(_ time: String, set: @escaping (String) -> Void) -> Binding<Date> {
        Binding(get: {
            let parts = time.split(separator: ":").compactMap { Int($0) }
            return Calendar.current.date(bySettingHour: parts.first ?? 9, minute: parts.count > 1 ? parts[1] : 0, second: 0, of: .now) ?? .now
        }, set: { date in
            let c = Calendar.current.dateComponents([.hour, .minute], from: date)
            set(String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0))
        })
    }

    static func day(_ date: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 2026, c.month ?? 1, c.day ?? 1)
    }
    static func date(_ day: String) -> Date {
        let p = day.split(separator: "-").compactMap { Int($0) }
        return Calendar.current.date(from: DateComponents(year: p.first, month: p.count > 1 ? p[1] : 1, day: p.count > 2 ? p[2] : 1)) ?? .now
    }
}
