import SwiftUI

struct AutomationEditor: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    let automation: Automation?
    let saved: (Automation) async -> Void

    @State private var projects: [Project] = []
    @State private var projectId = ""
    @State private var defaults: ExecutionChoice?
    @State private var options: ExecutionOptions?
    @State private var providerId = ""
    @State private var modelId = ""
    @State private var reasoning = "medium"
    @State private var permissionMode = "auto"
    @State private var name = ""
    @State private var prompt = ""
    @State private var repeatMode = "Weekdays"
    @State private var time = Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: .now) ?? .now
    @State private var runAt = Date.now.addingTimeInterval(3600)
    @State private var cron = "0 9 * * 1-5"
    @State private var timezone = TimeZone.current.identifier
    @State private var saving = false
    @State private var error: String?

    private let repeats = ["Weekdays", "Every day", "Every hour", "Once", "Custom cron"]

    var body: some View {
        NavigationStack {
            Form {
                if automation == nil {
                    Picker("Project", selection: $projectId) {
                        ForEach(projects) { Text($0.name).tag($0.id) }
                    }
                    Section("Agent") {
                        Picker("Provider", selection: $providerId) {
                            ForEach(options?.providers.filter { $0.available != false } ?? []) {
                                Text($0.displayName).tag($0.id)
                            }
                        }
                        Picker("Model", selection: $modelId) {
                            ForEach(options?.models ?? []) { Text($0.displayName).tag($0.id) }
                        }
                        Picker("Reasoning", selection: $reasoning) {
                            ForEach(["none", "low", "medium", "high", "xhigh", "max", "ultra"], id: \.self) { Text($0.capitalized).tag($0) }
                        }
                        Picker("Permissions", selection: $permissionMode) {
                            ForEach(PermissionMode.allowed(["accept-edits", "auto", "full"], ceiling: options?.permissionCeiling), id: \.self) {
                                Text(PermissionMode.label($0)).tag($0)
                            }
                        }
                    }
                }
                Section("Task") {
                    TextField("Name", text: $name).accessibilityIdentifier("workflowAutomationName")
                    if automation?.execution.mode != "script" {
                        TextField("What should the agent do?", text: $prompt, axis: .vertical)
                            .lineLimit(3...10).accessibilityIdentifier("workflowAutomationPrompt")
                    } else {
                        Text("Script source is managed in BB web.").font(.footnote).foregroundStyle(.secondary)
                    }
                }
                Section("Schedule") {
                    Picker("Repeat", selection: $repeatMode) {
                        ForEach(repeats, id: \.self) { Text($0).tag($0) }
                    }
                    if repeatMode == "Weekdays" || repeatMode == "Every day" {
                        DatePicker("Time", selection: $time, displayedComponents: .hourAndMinute)
                    } else if repeatMode == "Once" {
                        DatePicker("Run at", selection: $runAt, in: Date.now...)
                    } else if repeatMode == "Custom cron" {
                        TextField("Cron", text: $cron).textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }
                    if repeatMode != "Once" {
                        TextField("Timezone", text: $timezone).textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }
                }
                if let error { Text(error).font(.footnote).foregroundStyle(.red) }
            }
            .navigationTitle(automation == nil ? "New automation" : "Edit automation")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }.disabled(!valid || saving)
                        .accessibilityIdentifier("workflowAutomationSave")
                }
            }
            .task {
                projects = (try? await app.client.projects()) ?? []
                projectId = automation?.projectId ?? projects.first?.id ?? ""
                fill()
            }
            .task(id: projectId) {
                guard !projectId.isEmpty else { return }
                defaults = try? await app.client.projectDefaults(projectId)
                providerId = defaults?.providerId ?? ""
                modelId = defaults?.model ?? ""
                reasoning = defaults?.reasoningLevel ?? "medium"
                permissionMode = defaults?.permissionMode ?? "auto"
                options = try? await app.client.executionOptions(providerId: providerId.isEmpty ? nil : providerId)
                if providerId.isEmpty { providerId = options?.providers.first { $0.available != false }?.id ?? "" }
                if modelId.isEmpty { modelId = options?.models.first { $0.isDefault == true }?.id ?? options?.models.first?.id ?? "" }
            }
            .task(id: providerId) {
                guard !providerId.isEmpty else { return }
                options = try? await app.client.executionOptions(providerId: providerId)
                if options?.models.contains(where: { $0.id == modelId || $0.model == modelId }) != true {
                    modelId = options?.models.first { $0.isDefault == true }?.id ?? options?.models.first?.id ?? ""
                }
            }
        }
    }

    private var valid: Bool {
        !projectId.isEmpty && !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && (automation?.execution.mode == "script" || !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            && (repeatMode == "Once" || TimeZone(identifier: timezone) != nil)
            && (repeatMode != "Custom cron" || cron.split(whereSeparator: \.isWhitespace).count == 5)
            && (automation != nil || (!providerId.isEmpty && !modelId.isEmpty))
    }

    private var trigger: JSONValue {
        if repeatMode == "Once" {
            return ["triggerType": "once", "runAt": .number(runAt.timeIntervalSince1970 * 1000)]
        }
        let parts = Calendar.current.dateComponents([.hour, .minute], from: time)
        let at = "\(parts.minute ?? 0) \(parts.hour ?? 9)"
        let schedule: String
        switch repeatMode {
        case "Weekdays": schedule = "\(at) * * 1-5"
        case "Every day": schedule = "\(at) * * *"
        case "Every hour": schedule = "0 * * * *"
        default: schedule = cron.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return ["triggerType": "schedule", "cron": .string(schedule), "timezone": .string(timezone)]
    }

    private func fill() {
        guard let automation else { return }
        name = automation.name
        prompt = automation.execution.prompt ?? ""
        if automation.trigger.triggerType == "once" {
            repeatMode = "Once"
            runAt = Date(timeIntervalSince1970: (automation.trigger.runAt ?? 0) / 1000)
            return
        }
        cron = automation.trigger.cron ?? cron
        timezone = automation.trigger.timezone ?? timezone
        let parts = cron.split(separator: " ").map(String.init)
        if cron == "0 * * * *" { repeatMode = "Every hour" }
        else if parts.count == 5, let minute = Int(parts[0]), let hour = Int(parts[1]), parts[2] == "*", parts[3] == "*",
                ["*", "1-5"].contains(parts[4]) {
            repeatMode = parts[4] == "1-5" ? "Weekdays" : "Every day"
            time = Calendar.current.date(bySettingHour: hour, minute: minute, second: 0, of: .now) ?? time
        } else { repeatMode = "Custom cron" }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            let updated: Automation
            if let automation {
                updated = try await app.client.updateAutomation(automation, name: name, prompt: automation.execution.mode == "agent" ? prompt : nil, trigger: trigger)
            } else {
                updated = try await app.client.createAutomation(projectId: projectId, name: name, prompt: prompt,
                                                                trigger: trigger, execution: ExecutionChoice(
                                                                    providerId: providerId, model: modelId,
                                                                    reasoningLevel: reasoning, permissionMode: permissionMode))
            }
            await saved(updated)
            dismiss()
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }
}
