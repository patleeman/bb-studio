import SwiftUI

/// A channel's scheduled bot prompts, from Bot Teams. Shown as a sheet off
/// the channel's ⋯ menu; response threads open in the main stack.
struct ChannelAutomationsSheet: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    let room: Room
    @State private var automations: [ChannelAutomation]?
    @State private var bots: [Bot] = []
    @State private var creating = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                if let error { Text(error).font(.footnote).foregroundStyle(.red) }
                ForEach(automations ?? []) { automation in
                    NavigationLink(value: automation) {
                        VStack(alignment: .leading, spacing: 3) {
                            HStack {
                                Text(automation.name).font(.headline)
                                if !automation.enabled {
                                    Text("Paused").font(.caption2.weight(.semibold)).foregroundStyle(.orange)
                                }
                            }
                            Text(automation.trigger.description).font(.caption).foregroundStyle(.secondary)
                            Text(botName(automation.botId)).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .overlay {
                if automations == nil, error == nil {
                    ProgressView()
                } else if automations?.isEmpty == true {
                    ContentUnavailableView(
                        "No Automations", systemImage: "clock.arrow.circlepath",
                        description: Text("Have a bot post to #\(room.name) on a schedule."))
                }
            }
            .refreshable { await load() }
            .navigationTitle("Automations")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: ChannelAutomation.self) { automation in
                ChannelAutomationDetail(
                    automation: automation, botName: botName(automation.botId), room: room, reload: { await load() },
                    openThread: { id in
                        dismiss()
                        app.push(.thread(id: id))
                    })
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .primaryAction) {
                    Button { creating = true } label: { Image(systemName: "plus") }
                        .accessibilityLabel("New Automation")
                        .disabled(members.isEmpty)
                }
            }
            .sheet(isPresented: $creating) {
                ChannelAutomationEditor(room: room, bots: members, automation: nil) { _ in await load() }
            }
            .task { await load() }
        }
    }

    /// Bots in the channel that can still work.
    private var members: [Bot] {
        bots.filter { room.memberIds.contains($0.id) && $0.retired != true }
    }

    private func botName(_ id: String) -> String {
        bots.first { $0.id == id }?.name ?? "Unknown bot"
    }

    private func load() async {
        do {
            async let list = app.client.channelAutomations(room.id)
            async let teams = app.client.botTeams()
            automations = try await list
            bots = (try? await teams)?.bots ?? bots
            error = nil
        } catch {
            self.error = (error as? BBError)?.message ?? error.localizedDescription
        }
    }
}

private struct ChannelAutomationDetail: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @State var automation: ChannelAutomation
    let botName: String
    let room: Room
    let reload: () async -> Void
    let openThread: (String) -> Void
    @State private var runs: [ChannelAutomationRun]?
    @State private var nextCursor: String?
    @State private var busy = false
    @State private var editing = false
    @State private var confirmingDelete = false
    @State private var confirmingRun = false
    @State private var notice: String?
    @State private var error: String?

    var body: some View {
        List {
            Section {
                LabeledContent("Status", value: automation.enabled ? "Enabled" : "Paused")
                LabeledContent("Bot", value: botName)
                LabeledContent("Repeat", value: automation.trigger.description)
                if let next = automation.nextRunAt, automation.enabled {
                    LabeledContent("Next run", value: Self.time(next))
                }
                if let last = automation.lastRunAt {
                    LabeledContent("Last run", value: Self.time(last) + (automation.lastRunStatus.map { " · \($0.capitalized)" } ?? ""))
                }
                if let lastError = automation.lastError {
                    Text(lastError).font(.footnote).foregroundStyle(.red)
                }
            } footer: {
                if let notice { Text(notice) }
            }
            Section("Task") {
                Text(automation.prompt).textSelection(.enabled)
            }
            Section {
                Button {
                    Task { await act(automation.enabled ? "pause" : "resume") }
                } label: {
                    Label(automation.enabled ? "Pause" : "Resume", systemImage: automation.enabled ? "pause" : "play")
                }
                Button { confirmingRun = true } label: { Label("Run Now", systemImage: "bolt") }
                Button(role: .destructive) { confirmingDelete = true } label: { Label("Delete", systemImage: "trash") }
            }
            .disabled(busy)
            if let error {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
            Section("Runs") {
                if let runs {
                    if runs.isEmpty { Text("No runs yet").foregroundStyle(.secondary) }
                    ForEach(runs) { run in ChannelRunRow(run: run, openThread: openThread) }
                    if let nextCursor {
                        Button("Earlier Runs") { Task { await loadRuns(after: nextCursor) } }
                    }
                } else {
                    ProgressView()
                }
            }
        }
        .navigationTitle(automation.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) { Button("Edit") { editing = true } }
        }
        .sheet(isPresented: $editing) {
            ChannelAutomationEditor(room: room, bots: [], automation: automation) { updated in
                if let updated { automation = updated }
                await reload()
            }
        }
        .confirmationDialog("Run \u{201C}\(automation.name)\u{201D} now?", isPresented: $confirmingRun, titleVisibility: .visible) {
            Button("Run Now") { Task { await act("run") } }
        } message: {
            Text("\(botName) posts its response to #\(room.name).")
        }
        .confirmationDialog("Delete \u{201C}\(automation.name)\u{201D}?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { Task { await act("delete") } }
        }
        .task { await loadRuns(after: nil) }
    }

    private static func time(_ ms: Double) -> String {
        Date(timeIntervalSince1970: ms / 1000).formatted(date: .abbreviated, time: .shortened)
    }

    private func act(_ action: String) async {
        busy = true
        defer { busy = false }
        do {
            try await app.client.channelAutomationAction(automation, action)
            error = nil
            switch action {
            case "delete":
                await reload()
                dismiss()
                return
            case "pause":
                automation.enabled = false
                notice = "Paused. Any response already in progress continues."
            case "resume":
                automation.enabled = true
                notice = nil
            default:
                notice = "Started. The response shows up in #\(room.name)."
            }
            await reload()
            if let fresh = try? await app.client.channelAutomations(room.id).first(where: { $0.id == automation.id }) {
                automation = fresh
            }
            await loadRuns(after: nil)
        } catch {
            self.error = (error as? BBError)?.message ?? error.localizedDescription
        }
    }

    private func loadRuns(after cursor: String?) async {
        do {
            let page = try await app.client.channelAutomationRuns(automation, cursor: cursor)
            runs = cursor == nil ? page.runs : (runs ?? []) + page.runs
            nextCursor = page.next
        } catch {
            if runs == nil { runs = [] }
            self.error = (error as? BBError)?.message ?? error.localizedDescription
        }
    }
}

private struct ChannelRunRow: View {
    let run: ChannelAutomationRun
    let openThread: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(run.status.capitalized).font(.subheadline.weight(.semibold)).foregroundStyle(tint)
                Text(run.trigger == "manual" ? "Manual" : run.trigger.capitalized).font(.caption).foregroundStyle(.secondary)
                Spacer()
                Text(Date(timeIntervalSince1970: run.startedAt / 1000), format: .relative(presentation: .named))
                    .font(.caption).foregroundStyle(.secondary)
            }
            if let problem = run.error ?? run.responseError ?? run.skipReason {
                Text(problem).font(.caption).foregroundStyle(run.skipReason != nil && run.error == nil ? Color.secondary : .red)
            }
            if let output = run.output, !output.isEmpty {
                Text(output).font(.caption).foregroundStyle(.secondary).lineLimit(3)
            }
            if let thread = run.responseThreadId {
                Button { openThread(thread) } label: { Label("Open Response", systemImage: "arrow.up.right") }
                    .font(.caption)
                    .buttonStyle(.borderless)
            }
        }
    }

    private var tint: Color {
        switch run.status {
        case "succeeded", "completed", "success": .green
        case "failed", "error": .red
        case "running", "queued": .blue
        default: .secondary
        }
    }
}

/// Create or edit. The bot is only chosen on create, as on the web.
private struct ChannelAutomationEditor: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    let room: Room
    let bots: [Bot]
    let automation: ChannelAutomation?
    let saved: (ChannelAutomation?) async -> Void

    enum Repeat: String, CaseIterable, Identifiable {
        case weekdays = "Weekdays", daily = "Every day", hourly = "Every hour", once = "Once", custom = "Custom cron"
        var id: String { rawValue }
    }

    @State private var name = ""
    @State private var botId = ""
    @State private var prompt = ""
    @State private var repeatMode = Repeat.weekdays
    @State private var time = Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: .now) ?? .now
    @State private var runAt = Date.now.addingTimeInterval(3600)
    @State private var cron = "0 9 * * 1-5"
    @State private var timezone = TimeZone.current.identifier
    @State private var enabled = true
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name).accessibilityIdentifier("automationName")
                    if automation == nil {
                        Picker("Bot", selection: $botId) {
                            ForEach(bots) { Text($0.name).tag($0.id) }
                        }
                    }
                }
                Section("Task") {
                    TextField("What should the bot do?", text: $prompt, axis: .vertical)
                        .lineLimit(3...12)
                        .accessibilityIdentifier("automationPrompt")
                }
                Section {
                    Picker("Repeat", selection: $repeatMode) {
                        ForEach(Repeat.allCases) { Text($0.rawValue).tag($0) }
                    }
                    switch repeatMode {
                    case .weekdays, .daily:
                        DatePicker("Time", selection: $time, displayedComponents: .hourAndMinute)
                    case .once:
                        DatePicker("Run at", selection: $runAt, in: Date.now...)
                    case .custom:
                        TextField("Cron", text: $cron)
                            .font(.body.monospaced())
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    case .hourly:
                        EmptyView()
                    }
                    if repeatMode != .once {
                        TextField("Timezone", text: $timezone)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }
                } footer: {
                    if repeatMode == .custom { Text("Minute, hour, day of month, month, day of week.") }
                }
                if automation == nil {
                    Toggle("Start enabled", isOn: $enabled)
                }
                if let error {
                    Text(error).font(.footnote).foregroundStyle(.red)
                }
            }
            .navigationTitle(automation == nil ? "New Automation" : "Edit Automation")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }.disabled(!valid || saving)
                }
            }
            .onAppear(perform: fill)
        }
    }

    private var valid: Bool {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedPrompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        return !trimmedName.isEmpty && trimmedName.count <= 120 && !trimmedPrompt.isEmpty && trimmedPrompt.count <= 8000
            && (automation != nil || !botId.isEmpty)
            && (repeatMode == .once || TimeZone(identifier: timezone) != nil)
            && (repeatMode != .custom || cron.split(whereSeparator: \.isWhitespace).count == 5)
    }

    private var trigger: ChannelAutomation.Trigger {
        let parts = Calendar.current.dateComponents([.hour, .minute], from: time)
        let at = "\(parts.minute ?? 0) \(parts.hour ?? 9)"
        switch repeatMode {
        case .weekdays: return .schedule("\(at) * * 1-5", timezone: timezone)
        case .daily: return .schedule("\(at) * * *", timezone: timezone)
        case .hourly: return .schedule("0 * * * *", timezone: timezone)
        case .once: return .once(runAt)
        case .custom: return .schedule(cron.trimmingCharacters(in: .whitespaces), timezone: timezone)
        }
    }

    private func fill() {
        guard name.isEmpty, prompt.isEmpty else { return }
        botId = bots.first?.id ?? ""
        guard let automation else { return }
        name = automation.name
        prompt = automation.prompt
        let trigger = automation.trigger
        if trigger.triggerType == "once" {
            repeatMode = .once
            runAt = Date(timeIntervalSince1970: (trigger.runAt ?? 0) / 1000)
            return
        }
        timezone = trigger.timezone ?? timezone
        cron = trigger.cron ?? cron
        let parts = cron.split(whereSeparator: \.isWhitespace).map(String.init)
        if cron == "0 * * * *" {
            repeatMode = .hourly
        } else if parts.count == 5, let minute = Int(parts[0]), let hour = Int(parts[1]), parts[2] == "*", parts[3] == "*",
            ["*", "1-5"].contains(parts[4])
        {
            repeatMode = parts[4] == "1-5" ? .weekdays : .daily
            time = Calendar.current.date(bySettingHour: hour, minute: minute, second: 0, of: .now) ?? time
        } else {
            repeatMode = .custom
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedPrompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let result: ChannelAutomation
            if let automation {
                result = try await app.client.updateChannelAutomation(automation, name: trimmedName, prompt: trimmedPrompt, trigger: trigger)
            } else {
                result = try await app.client.createChannelAutomation(
                    room.id, botId: botId, name: trimmedName, prompt: trimmedPrompt, trigger: trigger, enabled: enabled)
            }
            await saved(result)
            dismiss()
        } catch {
            self.error = (error as? BBError)?.message ?? error.localizedDescription
        }
    }
}
