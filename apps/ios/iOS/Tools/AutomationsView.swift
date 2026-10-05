import SwiftUI

/// Every automation on the server, by project, with run-now and pause.
struct AutomationsView: View {
    @EnvironmentObject private var app: AppModel
    @State private var entries: [(automation: Automation, projectName: String)] = []
    @State private var loaded = false
    @State private var error: String?
    @State private var running: Automation?
    @State private var creating = false
    @State private var done = 0

    var body: some View {
        List {
            if let error {
                Section { ConnectionBanner(message: error) { await load() } }
            }
            ForEach(projects, id: \.self) { project in
                Section {
                    ForEach(entries.filter { $0.projectName == project }, id: \.automation.id) { entry in
                        NavigationLink(value: Route.automation(entry.automation)) {
                            AutomationRow(automation: entry.automation)
                        }
                        .swipeActions(edge: .leading) {
                            Button { running = entry.automation } label: { Label("Run now", systemImage: "play.fill") }
                                .tint(.green)
                        }
                        .swipeActions(edge: .trailing) {
                            let enabled = entry.automation.enabled
                            Button { Task { await setEnabled(entry.automation, !enabled) } } label: {
                                Label(enabled ? "Pause" : "Resume", systemImage: enabled ? "pause.fill" : "play.fill")
                            }
                            .tint(enabled ? .orange : .blue)
                        }
                    }
                } header: {
                    if projects.count > 1 { Text(project) }
                }
            }
        }
        .overlay {
            if !loaded {
                ProgressView()
            } else if entries.isEmpty, error == nil {
                ContentUnavailableView("No automations", systemImage: "clock.arrow.circlepath",
                    description: Text("Add one to run an agent on a schedule."))
            }
        }
        .navigationTitle("Automations")
        .toolbar {
            Button { creating = true } label: { Label("New automation", systemImage: "plus") }
                .accessibilityIdentifier("workflowNewAutomation")
        }
        .sheet(isPresented: $creating) {
            AutomationEditor(automation: nil) { _ in await load() }
        }
        .refreshable { await load() }
        .task { await load() }
        .sensoryFeedback(.success, trigger: done)
        .confirmationDialog(
            "Run \u{201C}\(running?.name ?? "")\u{201D} now?",
            isPresented: Binding(get: { running != nil }, set: { if !$0 { running = nil } }),
            titleVisibility: .visible
        ) {
            Button("Run now") {
                guard let automation = running else { return }
                Task { await run(automation) }
            }
        }
    }

    /// In the order they first appear.
    private var projects: [String] {
        var seen = Set<String>()
        return entries.map(\.projectName).filter { seen.insert($0).inserted }
    }

    /// Enabled first, then by name; the server's order is creation time.
    private func load() async {
        do {
            entries = try await app.client.automations().sorted {
                ($0.automation.enabled ? 0 : 1, $0.automation.name.localizedLowercase)
                    < ($1.automation.enabled ? 0 : 1, $1.automation.name.localizedLowercase)
            }
            error = nil
        } catch where BBClient.isCancellation(error) {
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
        loaded = true
    }

    private func run(_ automation: Automation) async {
        do {
            try await app.client.runAutomation(automation)
            done += 1
            try? await Task.sleep(for: .seconds(1))
            await load()
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }

    private func setEnabled(_ automation: Automation, _ enabled: Bool) async {
        do {
            let updated = try await app.client.setAutomation(automation, enabled: enabled)
            if let index = entries.firstIndex(where: { $0.automation.id == updated.id }) {
                entries[index].automation = updated
            }
            done += 1
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }
}

struct AutomationRow: View {
    let automation: Automation

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: automation.execution.mode == "agent" ? "sparkles" : "terminal")
                .foregroundStyle(automation.enabled ? Color.accentColor : .secondary)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 3) {
                Text(automation.name)
                    .lineLimit(2)
                    .foregroundStyle(automation.enabled ? .primary : .secondary)
                HStack(spacing: 4) {
                    Text(automation.schedule)
                    if let next = nextRun {
                        Text("·")
                        Text(next, format: .relative(presentation: .named, unitsStyle: .abbreviated))
                    } else if !automation.enabled {
                        Text("· Paused")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
            Spacer(minLength: 0)
            if let status = automation.lastRunStatus {
                RunStatusIcon(status: status)
            }
        }
    }

    private var nextRun: Date? {
        guard automation.enabled, let next = automation.nextRunAt else { return nil }
        return Date(timeIntervalSince1970: next / 1000)
    }
}

struct RunStatusIcon: View {
    let status: String

    var body: some View {
        Group {
            switch status {
            case "succeeded": Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
            case "failed", "timed_out", "timedOut": Image(systemName: "xmark.octagon.fill").foregroundStyle(.red)
            case "skipped": Image(systemName: "forward.fill").foregroundStyle(.secondary)
            case "running", "queued", "pending": ProgressView().controlSize(.mini)
            default: Image(systemName: "circle.dashed").foregroundStyle(.secondary)
            }
        }
        .font(.caption)
        .accessibilityLabel(status.replacingOccurrences(of: "_", with: " "))
    }
}

/// One automation: what it does, when, and its recent runs.
struct AutomationView: View {
    @EnvironmentObject private var app: AppModel
    @State var automation: Automation
    @State private var runs: [AutomationRun] = []
    @State private var nextCursor: String?
    @State private var loaded = false
    @State private var error: String?
    @State private var confirmingRun = false
    @State private var editing = false
    @State private var output: AutomationRun?
    @State private var done = 0

    var body: some View {
        List {
            if let error {
                Section { Text(error).font(.footnote).foregroundStyle(.red) }
            }
            Section {
                LabeledContent("Schedule", value: automation.schedule)
                if let tz = automation.trigger.timezone, tz != TimeZone.current.identifier {
                    LabeledContent("Time zone", value: tz)
                }
                if automation.enabled, let next = automation.nextRunAt {
                    LabeledContent("Next run") { Text(date(next), format: .dateTime.weekday().hour().minute()) }
                }
                if let last = automation.lastRunAt {
                    LabeledContent("Last run") { Text(date(last), format: .relative(presentation: .named)) }
                }
                if let count = automation.runCount { LabeledContent("Runs", value: "\(count)") }
                Toggle("Enabled", isOn: Binding(get: { automation.enabled }, set: { enabled in
                    Task { await setEnabled(enabled) }
                }))
            }
            Section("Runs as") {
                if automation.execution.mode == "agent" {
                    LabeledContent("Agent", value: [automation.execution.model, automation.execution.reasoningLevel]
                        .compactMap { $0 }.joined(separator: " · "))
                    if let target = automation.execution.targetThreadId {
                        NavigationLink(value: Route.thread(id: target)) { Label("Posts in its thread", systemImage: Symbols.thread) }
                    }
                    if let prompt = automation.execution.prompt {
                        DisclosureGroup("Prompt") {
                            Text(prompt).font(.callout).textSelection(.enabled)
                        }
                    }
                } else {
                    LabeledContent("Script", value: [automation.execution.interpreter, automation.execution.scriptFile]
                        .compactMap { $0 }.joined(separator: " · "))
                }
            }
            if let lastError = automation.lastError, !lastError.isEmpty {
                Section("Last error") {
                    Text(lastError).font(.footnote.monospaced()).foregroundStyle(.red).textSelection(.enabled)
                }
            }
            Section("Recent runs") {
                if loaded, runs.isEmpty {
                    Text("No runs yet").foregroundStyle(.secondary)
                }
                ForEach(runs) { run in
                    if let thread = run.threadId {
                        NavigationLink(value: Route.thread(id: thread)) { RunRow(run: run) }
                    } else {
                        Button { output = run } label: { RunRow(run: run) }
                            .foregroundStyle(.primary)
                            .disabled((run.output ?? run.error ?? run.skipReason ?? "").isEmpty)
                    }
                }
                if nextCursor != nil {
                    Button("Load more") { Task { await loadRuns(more: true) } }
                }
            }
        }
        .navigationTitle(automation.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            Button { editing = true } label: { Label("Edit", systemImage: "pencil") }
            Button { confirmingRun = true } label: { Label("Run now", systemImage: "play.fill") }
        }
        .sheet(isPresented: $editing) {
            AutomationEditor(automation: automation) { updated in automation = updated }
        }
        .confirmationDialog("Run \u{201C}\(automation.name)\u{201D} now?", isPresented: $confirmingRun, titleVisibility: .visible) {
            Button("Run now") { Task { await run() } }
        }
        .sheet(item: $output) { run in
            NavigationStack {
                ScrollView {
                    Text([run.error, run.skipReason, run.output].compactMap { $0 }.joined(separator: "\n\n"))
                        .font(.footnote.monospaced())
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding()
                }
                .navigationTitle("Run output")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { Button("Done") { output = nil } }
            }
            .presentationDetents([.medium, .large])
        }
        .refreshable { await loadRuns() }
        .task { await loadRuns() }
        .sensoryFeedback(.success, trigger: done)
    }

    private func date(_ ms: Double) -> Date { Date(timeIntervalSince1970: ms / 1000) }

    private func loadRuns(more: Bool = false) async {
        do {
            let page = try await app.client.automationRuns(automation, cursor: more ? nextCursor : nil)
            runs = more ? runs + page.runs : page.runs
            nextCursor = page.next
            error = nil
        } catch where BBClient.isCancellation(error) {
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
        loaded = true
    }

    private func run() async {
        do {
            try await app.client.runAutomation(automation)
            done += 1
            try? await Task.sleep(for: .seconds(1))
            await loadRuns()
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }

    private func setEnabled(_ enabled: Bool) async {
        do {
            automation = try await app.client.setAutomation(automation, enabled: enabled)
            done += 1
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }
}

struct RunRow: View {
    let run: AutomationRun

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            RunStatusIcon(status: run.status)
            VStack(alignment: .leading, spacing: 2) {
                if let started = run.startedAt ?? run.scheduledFor {
                    Text(Date(timeIntervalSince1970: started / 1000), format: .dateTime.month(.abbreviated).day().hour().minute())
                }
                Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
        }
    }

    private var detail: String {
        var parts = [run.status.replacingOccurrences(of: "_", with: " ").capitalized]
        if run.trigger == "manual" { parts.append("run by hand") }
        if let duration = run.duration {
            parts.append(Duration.seconds(duration).formatted(.units(allowed: [.minutes, .seconds], width: .narrow)))
        }
        if let reason = run.skipReason ?? run.error { parts.append(reason) }
        return parts.joined(separator: " · ")
    }
}
