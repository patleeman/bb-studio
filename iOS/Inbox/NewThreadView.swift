import SwiftUI

struct NewThreadView: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @AppStorage("newThreadProjectId", store: AppGroup.defaults) private var projectId = ""
    @State private var projects: [Project] = []
    @State private var text: String
    @State private var attachments: [PendingAttachment] = []
    @State private var dictating = false
    @State private var creating = false
    @State private var error: String?

    // Execution options. Empty means the project default.
    @State private var defaults: ExecutionChoice?
    @State private var options: ExecutionOptions?
    @State private var providerId = ""
    @State private var modelId = ""
    @State private var reasoning = ""
    @State private var permissionMode = ""

    init(text: String = "") {
        _text = State(initialValue: text)
    }

    var body: some View {
        NavigationStack {
            Form {
                Picker("Project", selection: $projectId) {
                    ForEach(projects) { Text($0.name).tag($0.id) }
                }
                Section {
                    TextField("What should the agent do?", text: $text, axis: .vertical)
                        .lineLimit(4...12)
                    AttachmentStrip(items: $attachments)
                    HStack {
                        Button { dictating = true } label: { Label("Dictate", systemImage: "mic") }
                        Spacer()
                        AttachmentMenu(items: $attachments)
                    }
                    .buttonStyle(.borderless)
                }
                Section("Agent") {
                    Picker("Provider", selection: $providerId) {
                        Text(defaultLabel(defaults?.providerId.flatMap(providerName))).tag("")
                        ForEach(options?.providers.filter { $0.available != false } ?? []) {
                            Text($0.displayName).tag($0.id)
                        }
                    }
                    Picker("Model", selection: $modelId) {
                        Text(defaultLabel(defaultModelName)).tag("")
                        ForEach(options?.models ?? []) { Text($0.displayName).tag($0.id) }
                    }
                    Picker("Reasoning", selection: $reasoning) {
                        Text(defaultLabel(defaults?.reasoningLevel)).tag("")
                        ForEach(reasoningLevels, id: \.self) { Text($0).tag($0) }
                    }
                    Picker("Permissions", selection: $permissionMode) {
                        Text(defaultLabel(defaults?.permissionMode.map(permissionLabel))).tag("")
                        ForEach(permissionModes, id: \.self) { Text(permissionLabel($0)).tag($0) }
                    }
                }
                if let error { Text(error).foregroundStyle(.red).font(.footnote) }
            }
            .navigationTitle("New thread")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Start") { Task { await create() } }
                        .disabled(
                            (text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && attachments.isEmpty)
                                || projectId.isEmpty || creating)
                }
            }
            .sheet(isPresented: $dictating) {
                DictationView(threadId: nil, autoStart: true) { text += (text.isEmpty ? "" : " ") + $0 }
            }
            .task {
                projects = (try? await app.client.projects()) ?? []
                if !projects.contains(where: { $0.id == projectId }) { projectId = projects.first?.id ?? "" }
            }
            .task(id: projectId) {
                guard !projectId.isEmpty else { return }
                defaults = (try? await app.client.projectDefaults(projectId)) ?? nil
                if providerId.isEmpty { await loadOptions() }
            }
            .task(id: providerId) {
                modelId = ""
                reasoning = ""
                await loadOptions()
            }
        }
    }

    private func loadOptions() async {
        let provider = providerId.isEmpty ? defaults?.providerId : providerId
        options = try? await app.client.executionOptions(providerId: provider)
    }

    private var selectedModel: ExecutionOptions.Model? {
        let id = modelId.isEmpty ? defaults?.model : modelId
        return options?.models.first { $0.id == id || $0.model == id } ?? options?.models.first { $0.isDefault == true }
    }

    private var defaultModelName: String? {
        guard providerId.isEmpty || providerId == defaults?.providerId else {
            return options?.models.first { $0.isDefault == true }?.displayName
        }
        return defaults?.model.map { id in options?.models.first { $0.id == id || $0.model == id }?.displayName ?? id }
    }

    private var reasoningLevels: [String] {
        selectedModel?.supportedReasoningEfforts?.map(\.reasoningEffort) ?? []
    }

    private var permissionModes: [String] {
        let provider = providerId.isEmpty ? defaults?.providerId : providerId
        return options?.providers.first { $0.id == provider }?.capabilities?.permissionModes ?? []
    }

    private func providerName(_ id: String) -> String? {
        options?.providers.first { $0.id == id }?.displayName ?? id
    }

    private func defaultLabel(_ value: String?) -> String {
        value.map { "Default (\($0))" } ?? "Default"
    }

    private func permissionLabel(_ mode: String) -> String {
        switch mode {
        case "accept-edits": "Accept edits"
        case "auto": "Auto"
        case "full": "Full access"
        default: mode
        }
    }

    private func create() async {
        creating = true
        defer { creating = false }
        do {
            let inputs = try await PendingAttachment.upload(attachments, projectId: projectId, client: app.client)
            let choice = ExecutionChoice(
                providerId: providerId.isEmpty ? nil : providerId,
                model: modelId.isEmpty ? nil : modelId,
                reasoningLevel: reasoning.isEmpty ? nil : reasoning,
                permissionMode: permissionMode.isEmpty ? nil : permissionMode)
            let thread = try await app.client.createThread(
                projectId: projectId, text: text.trimmingCharacters(in: .whitespacesAndNewlines), attachments: inputs,
                options: choice)
            dismiss()
            app.openThread(thread.id)
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }
}
