import SwiftUI

/// The model, reasoning level and permissions for a thread's next turns. BB
/// keeps model and reasoning as a thread override; permissions go with the next
/// message. Another provider hands off to a new thread, which `handoff` runs
/// after the sheet closes.
struct ExecutionSheet: View {
    let threadId: String
    let providerId: String?
    /// Runs a handoff to another provider: provider, its name, model, its name, reasoning.
    var handoff: ((_ providerId: String, _ providerName: String, _ model: String, _ modelName: String, _ reasoning: String?) -> Void)? = nil
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }
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
    @State private var providers: [ExecutionOptions.Provider] = []
    /// The provider picked here; the thread's own unless handing off.
    @State private var chosenProvider = ""

    var body: some View {
        NavigationStack {
            Form {
                if models.isEmpty, error == nil {
                    ProgressView().frame(maxWidth: .infinity)
                } else {
                    if handoff != nil, providers.count > 1 {
                        Section {
                            Picker("Provider", selection: $chosenProvider) {
                                ForEach(providers) { Text($0.displayName).tag($0.id) }
                            }
                            .accessibilityIdentifier("providerPicker")
                        } footer: {
                            if handingOff { Text(ModelHandoffPlan.handoffFooter(providerName: chosenName)) }
                        }
                    }
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
                    if !permissionModes.isEmpty, !handingOff {
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
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { operation.complete(on: app) { dismiss() } } }
                ToolbarItem(placement: .confirmationAction) {
                    if saving {
                        ProgressView()
                    } else {
                        Button(ModelHandoffPlan.saveTitle(handoff: handingOff)) { Task { await save() } }
                            .disabled(!changed || models.isEmpty)
                    }
                }
            }
            .onChange(of: model) { _, _ in
                if !efforts.contains(reasoning) {
                    reasoning = selected?.defaultReasoningEffort ?? efforts.last ?? ""
                }
            }
            .task { await load() }
            .onChange(of: chosenProvider) { old, _ in if !old.isEmpty { Task { await loadModels() } } }
        }
        .presentationDetents([.medium])
    }

    private var selected: ExecutionOptions.Model? { models.first { $0.id == model } }
    private var efforts: [String] { selected?.supportedReasoningEfforts?.map(\.reasoningEffort) ?? [] }
    private var modelChanged: Bool {
        !model.isEmpty && (model != original?.model || (!reasoning.isEmpty && reasoning != original?.reasoningLevel))
    }
    private var permissionChanged: Bool { !permission.isEmpty && permission != currentPermission }
    private var changed: Bool { handingOff || modelChanged || permissionChanged }
    private var handingOff: Bool { ModelHandoffPlan.isHandoff(current: providerId, chosen: chosenProvider) }
    private var chosenName: String { providers.first { $0.id == chosenProvider }?.displayName ?? chosenProvider }

    /// Another provider's models, or the thread's own again.
    private func loadModels() async {
        do {
            let options = try await client.executionOptions(providerId: chosenProvider)
            models = options.models
            let name = handingOff ? nil : original?.model
            model = models.first { name != nil && ($0.id == name || $0.model == name) }?.id
                ?? models.first { $0.isDefault == true }?.id ?? models.first?.id ?? ""
            reasoning = !handingOff ? original?.reasoningLevel ?? selected?.defaultReasoningEffort ?? "" : selected?.defaultReasoningEffort ?? ""
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
    }

    private func load() async {
        do {
            async let current = client.execution(threadId)
            let options = try await client.executionOptions(providerId: providerId)
            models = options.models
            original = try await current
            let modes = options.providers.first { $0.id == providerId }?.capabilities?.permissionModes ?? []
            permissionModes = PermissionMode.allowed(modes, ceiling: options.permissionCeiling)
            providers = ModelHandoffPlan.providers(options.providers, current: providerId)
            chosenProvider = providerId ?? ""

            currentPermission = PermissionMode.pending(threadId, serverURL: client.baseURL) ?? original?.permissionMode ?? ""
            permission = currentPermission
            // The override may name a model by its `model` rather than its `id`.
            let name = original?.model ?? ""
            model = models.first { $0.id == name || $0.model == name }?.id ?? models.first { $0.isDefault == true }?.id
                ?? models.first?.id ?? ""
            reasoning = original?.reasoningLevel ?? selected?.defaultReasoningEffort ?? ""
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            if handingOff, let handoff, let selected {
                handoff(chosenProvider, chosenName, selected.model, selected.displayName, reasoning.isEmpty ? nil : reasoning)
                operation.complete(on: app) { dismiss() }
                return
            }
            if modelChanged {
                try await client.setExecution(threadId, model: model, reasoningLevel: reasoning.isEmpty ? nil : reasoning)
            }
            if permissionChanged {
                // Back to what the thread already has: nothing to send.
                PermissionMode.setPending(permission == original?.permissionMode ? nil : permission, for: threadId, serverURL: client.baseURL)
            }
            operation.complete(on: app) { dismiss() }
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
    }
}
