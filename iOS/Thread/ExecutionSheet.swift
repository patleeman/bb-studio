import SwiftUI

/// The model, reasoning level and permissions for a thread's next turns. BB
/// keeps model and reasoning as a thread override; permissions go with the next
/// message. Another provider needs a new thread.
struct ExecutionSheet: View {
    let threadId: String
    let providerId: String?
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var models: [ExecutionOptions.Model] = []
    @State private var model = ""
    @State private var reasoning = ""
    @State private var permissionModes: [String] = []
    @State private var permission = ""
    /// What the thread runs with now, or what this phone will send next.
    @State private var currentPermission = ""
    @State private var original: ThreadExecution?
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                if models.isEmpty, error == nil {
                    ProgressView().frame(maxWidth: .infinity)
                } else {
                    Section {
                        Picker("Model", selection: $model) {
                            ForEach(models) { Text($0.displayName).tag($0.id) }
                        }
                        if !efforts.isEmpty {
                            Picker("Reasoning", selection: $reasoning) {
                                ForEach(efforts, id: \.self) { Text($0.capitalized).tag($0) }
                            }
                        }
                    }
                    if !permissionModes.isEmpty {
                        Section {
                            Picker("Permissions", selection: $permission) {
                                ForEach(permissionModes, id: \.self) { Text(PermissionMode.label($0)).tag($0) }
                            }
                            .accessibilityIdentifier("permissionPicker")
                        } footer: {
                            Text(permission == "full"
                                ? "Full access lets the agent run anything on the machine without asking. Applies from your next message."
                                : "Applies from your next message.")
                        }
                    }
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Model & Permissions")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if saving {
                        ProgressView()
                    } else {
                        Button("Save") { Task { await save() } }.disabled(!changed)
                    }
                }
            }
            .onChange(of: model) { _, _ in
                if !efforts.contains(reasoning) {
                    reasoning = selected?.defaultReasoningEffort ?? efforts.last ?? ""
                }
            }
            .task { await load() }
        }
        .presentationDetents([.medium])
    }

    private var selected: ExecutionOptions.Model? { models.first { $0.id == model } }
    private var efforts: [String] { selected?.supportedReasoningEfforts?.map(\.reasoningEffort) ?? [] }
    private var modelChanged: Bool {
        !model.isEmpty && (model != original?.model || (!reasoning.isEmpty && reasoning != original?.reasoningLevel))
    }
    private var permissionChanged: Bool { !permission.isEmpty && permission != currentPermission }
    private var changed: Bool { modelChanged || permissionChanged }

    private func load() async {
        do {
            async let current = app.client.execution(threadId)
            let options = try await app.client.executionOptions(providerId: providerId)
            models = options.models
            original = try await current
            let modes = options.providers.first { $0.id == providerId }?.capabilities?.permissionModes ?? []
            permissionModes = PermissionMode.allowed(modes, ceiling: options.permissionCeiling)
            currentPermission = PermissionMode.pending(threadId) ?? original?.permissionMode ?? ""
            permission = currentPermission
            // The override may name a model by its `model` rather than its `id`.
            let name = original?.model ?? ""
            model = models.first { $0.id == name || $0.model == name }?.id ?? models.first { $0.isDefault == true }?.id
                ?? models.first?.id ?? ""
            reasoning = original?.reasoningLevel ?? selected?.defaultReasoningEffort ?? ""
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            if modelChanged {
                try await app.client.setExecution(threadId, model: model, reasoningLevel: reasoning.isEmpty ? nil : reasoning)
            }
            if permissionChanged {
                // Back to what the thread already has: nothing to send.
                PermissionMode.setPending(permission == original?.permissionMode ? nil : permission, for: threadId)
            }
            dismiss()
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }
}
