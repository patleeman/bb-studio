import SwiftUI

struct TaskFieldsView: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    let id: String
    let projectId: String?
    let changed: () -> Void
    @State private var detail: Tasks.GetOutputTask?
    @State private var priority = "none"
    @State private var labels = ""
    @State private var recurrence = ""
    @State private var reminder = false
    @State private var reminderDate = Date()
    @State private var subtaskTitle = ""
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Picker("Priority", selection: $priority) {
                    ForEach(["none", "low", "medium", "high", "urgent"], id: \.self) { Text($0.capitalized).tag($0) }
                }
                TextField("Labels, separated by commas", text: $labels)
                Picker("Repeat", selection: $recurrence) {
                    Text("Never").tag("")
                    ForEach(["daily", "weekdays", "weekly", "monthly"], id: \.self) { Text($0.capitalized).tag($0) }
                }
                Toggle("Reminder", isOn: $reminder)
                if reminder { DatePicker("Remind me", selection: $reminderDate) }
                if let subtasks = detail?.subtasks, let total = subtasks.total, total > 0 {
                    LabeledContent("Subtasks", value: "\(Int(subtasks.done ?? 0)) of \(Int(total)) done")
                }
                HStack {
                    TextField("New subtask", text: $subtaskTitle)
                    Button("Add") { Task { await addSubtask() } }
                        .disabled(subtaskTitle.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                if let error { Text(error).font(.footnote).foregroundStyle(.red) }
            }
            .navigationTitle("Task details")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }.disabled(saving || detail == nil)
                }
            }
            .task { await load() }
        }
    }

    private func load() async {
        do {
            detail = try await app.client.taskGenerated(id).task
            if let detail {
                priority = detail.priority.map { String(describing: $0) } ?? "none"
                labels = (detail.labels ?? []).joined(separator: ", ")
                recurrence = detail.recurrence.map { String(describing: $0) } ?? ""
                reminder = detail.reminderAt != nil
                if let at = detail.reminderAt { reminderDate = Date(timeIntervalSince1970: at / 1000) }
            }
        } catch { self.error = BBClient.describe(error, server: app.client.baseURL) }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            try await app.client.updateTaskFields(id, priority: priority,
                labels: labels.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty },
                recurrence: recurrence.isEmpty ? nil : recurrence, reminderAt: reminder ? reminderDate : nil)
            changed()
            dismiss()
        } catch { self.error = BBClient.describe(error, server: app.client.baseURL) }
    }

    private func addSubtask() async {
        let title = subtaskTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { return }
        do {
            try await app.client.createSubtask(title, parentId: id, projectId: projectId)
            subtaskTitle = ""
            changed()
            await load()
        } catch { self.error = BBClient.describe(error, server: app.client.baseURL) }
    }
}
