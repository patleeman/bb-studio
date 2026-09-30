import SwiftUI

/// The model and reasoning level for a thread's next turns. BB keeps them as a
/// thread override; another provider needs a new thread.
struct ExecutionSheet: View {
    let threadId: String
    let providerId: String?
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var models: [ExecutionOptions.Model] = []
    @State private var model = ""
    @State private var reasoning = ""
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
                    } footer: {
                        Text("Applies from the next message.")
                    }
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Model")
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
    private var changed: Bool {
        !model.isEmpty && (model != original?.model || (!reasoning.isEmpty && reasoning != original?.reasoningLevel))
    }

    private func load() async {
        do {
            async let current = app.client.execution(threadId)
            models = try await app.client.executionOptions(providerId: providerId).models
            original = try await current
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
            try await app.client.setExecution(threadId, model: model, reasoningLevel: reasoning.isEmpty ? nil : reasoning)
            dismiss()
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }
}
