import SwiftUI

struct NewThreadView: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @AppStorage(ServerScope.key("newThreadProjectId"), store: AppGroup.defaults) private var projectId = ""
    @State private var projects: [Project] = []
    @State private var environments: [ThreadEnvironment] = []
    @State private var workspace = "default"
    @State private var baseBranch = ""
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

    // A bot to work as. Picking one applies the bot's selection above, which
    // can still be changed; the thread works as it from the first message.
    @State private var bots: [Bot] = []
    @State private var profileBotId = ""
    /// A picked bot whose model waits for its provider's options to load.
    @State private var applyingProfile: Bot?

    init(text: String = "") {
        _text = State(initialValue: text)
    }

    var body: some View {
        NavigationStack {
            Form {
                Picker("Project", selection: $projectId) {
                    ForEach(projects) { Text($0.name).tag($0.id) }
                }
                Section("Workspace") {
                    Picker("Use", selection: $workspace) {
                        Text("Project default").tag("default")
                        if checkoutHostId != nil { Text("Project checkout").tag("checkout") }
                        if worktreeHostId != nil { Text("New worktree").tag("worktree") }
                        ForEach(environments.filter { $0.status == "ready" }) { environment in
                            Text(environment.label).tag(environment.id)
                        }
                    }
                    if workspace == "worktree" {
                        TextField("Base branch (project default)", text: $baseBranch)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }
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
                if !bots.isEmpty {
                    Section {
                        Picker("Work as", selection: $profileBotId) {
                            Text("None").tag("")
                            ForEach(bots) { Text("\($0.avatar ?? "🤖") \($0.name)").tag($0.id) }
                        }
                    } footer: {
                        if !profileBotId.isEmpty {
                            Text("Works in this project with the bot's mission and memory. Its model is a starting point.")
                        }
                    }
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
                bots = (try? await app.client.profiles()) ?? []
                projects = (try? await app.client.projects()) ?? []
                if !projects.contains(where: { $0.id == projectId }) { projectId = projects.first?.id ?? "" }
            }
            .task(id: projectId) {
                guard !projectId.isEmpty else { return }
                workspace = "default"
                environments = (try? await app.client.threadEnvironments(projectId: projectId)) ?? []
                defaults = (try? await app.client.projectDefaults(projectId)) ?? nil
                if providerId.isEmpty { await loadOptions() }
            }
            .task(id: providerId) {
                modelId = ""
                reasoning = ""
                if let bot = applyingProfile, (bot.providerId ?? "") == providerId {
                    applyingProfile = nil
                    modelId = bot.model ?? ""
                    reasoning = bot.reasoningLevel ?? ""
                }
                await loadOptions()
                matchModelOption()
            }
            .onChange(of: profileBotId) { _, id in
                guard let bot = bots.first(where: { $0.id == id }) else { return }
                if let mode = bot.permissionMode { permissionMode = mode }
                if (bot.providerId ?? "") == providerId {
                    modelId = bot.model ?? ""
                    reasoning = bot.reasoningLevel ?? ""
                    matchModelOption()
                } else {
                    applyingProfile = bot
                    providerId = bot.providerId ?? ""
                }
            }
        }
    }

    private func loadOptions() async {
        let provider = providerId.isEmpty ? defaults?.providerId : providerId
        options = try? await app.client.executionOptions(providerId: provider)
    }

    /// A bot names its model by model id; the picker tags options by option id.
    private func matchModelOption() {
        guard !modelId.isEmpty, let option = options?.models.first(where: { $0.id == modelId || $0.model == modelId })
        else { return }
        modelId = option.id
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
        let modes = options?.providers.first { $0.id == provider }?.capabilities?.permissionModes ?? []
        return PermissionMode.allowed(modes, ceiling: options?.permissionCeiling)
    }

    private func providerName(_ id: String) -> String? {
        options?.providers.first { $0.id == id }?.displayName ?? id
    }

    private func defaultLabel(_ value: String?) -> String {
        value.map { "Default (\($0))" } ?? "Default"
    }

    private func permissionLabel(_ mode: String) -> String { PermissionMode.label(mode) }

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
            // The server attaches the profile when this project's next new thread
            // dispatches its first message, then forgets it.
            if !profileBotId.isEmpty {
                try await app.client.pendingThreadProfile(projectId: projectId, botId: profileBotId)
            }
            let thread: ThreadEntry
            do {
                thread = try await app.client.createThread(
                    projectId: projectId, text: text.trimmingCharacters(in: .whitespacesAndNewlines), attachments: inputs,
                    options: choice, workspace: selectedWorkspace)
            } catch {
                if !profileBotId.isEmpty { try? await app.client.pendingThreadProfile(projectId: projectId, botId: nil) }
                throw error
            }
            dismiss()
            app.openThread(thread.id)
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }

    private var selectedWorkspace: NewThreadWorkspace {
        if workspace == "checkout", let hostId = checkoutHostId {
            return .projectCheckout(hostId: hostId)
        }
        if workspace == "worktree", let hostId = worktreeHostId {
            let branch = baseBranch.trimmingCharacters(in: .whitespacesAndNewlines)
            return .worktree(hostId: hostId, baseBranch: branch.isEmpty ? nil : branch)
        }
        if environments.contains(where: { $0.id == workspace }) { return .reuse(workspace) }
        return .projectDefault
    }

    private var checkoutHostId: String? {
        environments.first { $0.status == "ready" && $0.environmentProviderId == "project-checkout" }?.hostId
    }

    private var worktreeHostId: String? {
        environments.first { $0.status == "ready" && $0.isGitRepo == true && $0.environmentProviderId == "project-checkout" }?.hostId
    }
}
