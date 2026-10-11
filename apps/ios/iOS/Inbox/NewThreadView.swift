import SwiftUI

struct NewThreadView: View {
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }
    @Environment(\.dismiss) private var dismiss
    @AppStorage(ServerScope.key("newThreadProjectId"), store: AppGroup.defaults) private var projectId = ""
    @State private var projects: [Project] = []
    @State private var environments: [ThreadEnvironment] = []
    @State private var workspace = "default"
    @State private var baseBranch = ""
    @State private var text: String
    @State private var attachments: [PendingAttachment] = []
    @State private var dictating = false
    @State private var focused = false
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

    /// A chat, not a form: an empty conversation with the composer at the
    /// bottom. Where it runs and which agent are chips above the field, set to
    /// the project's defaults, so most threads need only a message.
    var body: some View {
        NavigationStack {
            VStack {
                Spacer()
                Text("What should we work on?")
                    .font(.title2.weight(.semibold))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                Spacer()
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 32)
            .contentShape(.rect)
            .onTapGesture { focused = false }
            .safeAreaInset(edge: .bottom) { composer }
            .navigationTitle("New thread")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { operation.complete(on: app) { dismiss() } } }
            }
            .onAppear { focused = true }
            .sheet(isPresented: $dictating) {
                DictationView(threadId: nil, autoStart: true) { text += (text.isEmpty ? "" : " ") + $0 }
            }
            .task {
                projects = (try? await client.projects()) ?? []
                if !projects.contains(where: { $0.id == projectId }) { projectId = projects.first?.id ?? "" }
            }
            .task(id: projectId) {
                guard !projectId.isEmpty else { return }
                workspace = "default"
                environments = (try? await client.threadEnvironments(projectId: projectId)) ?? []
                defaults = (try? await client.projectDefaults(projectId)) ?? nil
                if providerId.isEmpty { await loadOptions() }
            }
            .task(id: providerId) {
                modelId = ""
                reasoning = ""
                await loadOptions()
                matchModelOption()
            }
        }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let error { Text(error).font(.footnote).foregroundStyle(.red) }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    placeChip
                    workspaceChip
                }
            }
            .scrollClipDisabled()
            if workspace == "worktree" {
                TextField("Base branch (project default)", text: $baseBranch)
                    .font(.subheadline)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(.horizontal, 12)
                    .frame(height: 32)
                    .background(.fill.tertiary, in: .capsule)
            }
            ComposerBar(
                text: $text, focused: $focused, attachments: $attachments, placeholder: "What should the agent do?", maxLines: 10,
                dictate: { dictating = true }
            ) {
                agentMenu
            } send: {
                Button { Task { await create() } } label: {
                    Group {
                        if creating { ProgressView() } else { Image(systemName: "arrow.up.circle.fill").font(.title) }
                    }
                    .frame(width: 36, height: 36)
                }
                .disabled(!canStart)
                .keyboardShortcut(.return, modifiers: .command)
                .accessibilityLabel("Start")
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(.bar)
    }

    private var canStart: Bool {
        (!text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty) && !projectId.isEmpty && !creating
    }

    /// The project the thread starts in.
    private var placeChip: some View {
        Menu {
            Section("Project") {
                Picker("Project", selection: $projectId) {
                    ForEach(projects) { Text($0.name).tag($0.id) }
                }
                .pickerStyle(.inline)
            }
        } label: {
            chip(placeLabel, systemImage: "folder")
        }
        .accessibilityIdentifier("newThreadProject")
    }

    private var placeLabel: String {
        projects.first { $0.id == projectId }?.name ?? "Project"
    }

    private var workspaceChip: some View {
        Menu {
            Picker("Workspace", selection: $workspace) {
                Text("Project default").tag("default")
                if checkoutHostId != nil { Text("Project checkout").tag("checkout") }
                if worktreeHostId != nil { Text("New worktree").tag("worktree") }
                ForEach(environments.filter { $0.status == "ready" }) { environment in
                    Text(environment.label).tag(environment.id)
                }
            }
            .pickerStyle(.inline)
        } label: {
            chip(workspaceLabel, systemImage: workspace == "worktree" ? "arrow.triangle.branch" : "desktopcomputer")
        }
        .accessibilityIdentifier("newThreadWorkspace")
    }

    private var workspaceLabel: String {
        switch workspace {
        case "default": "Default workspace"
        case "checkout": "Project checkout"
        case "worktree": "New worktree"
        default: environments.first { $0.id == workspace }?.label ?? "Workspace"
        }
    }

    /// Provider, model, reasoning and permissions, each defaulting to the project's.
    private var agentMenu: some View {
        Menu {
            Picker(selection: $providerId) {
                Text(defaultLabel(defaults?.providerId.flatMap(providerName))).tag("")
                ForEach(options?.providers.filter { $0.available != false } ?? []) {
                    Text($0.displayName).tag($0.id)
                }
            } label: { Label("Provider", systemImage: "server.rack") }
            .pickerStyle(.menu)
            Picker(selection: $modelId) {
                Text(defaultLabel(defaultModelName)).tag("")
                ForEach(options?.models ?? []) { Text($0.displayName).tag($0.id) }
            } label: { Label("Model", systemImage: "cpu") }
            .pickerStyle(.menu)
            if !reasoningLevels.isEmpty {
                Picker(selection: $reasoning) {
                    Text(defaultLabel(defaults?.reasoningLevel)).tag("")
                    ForEach(reasoningLevels, id: \.self) { Text($0).tag($0) }
                } label: { Label("Reasoning", systemImage: "brain") }
                .pickerStyle(.menu)
            }
            Picker(selection: $permissionMode) {
                Text(defaultLabel(defaults?.permissionMode.map(permissionLabel))).tag("")
                ForEach(permissionModes, id: \.self) { Text(permissionLabel($0)).tag($0) }
            } label: { Label("Permissions", systemImage: "lock.shield") }
            .pickerStyle(.menu)
        } label: {
            ComposerSettingsLabel(title: [selectedModel?.displayName ?? defaultModelName, reasoning.isEmpty ? defaults?.reasoningLevel : reasoning]
                .compactMap { $0 }.joined(separator: " · "))
        }
        .accessibilityIdentifier("newThreadAgent")
    }

    private func chip(_ title: String, systemImage: String) -> some View {
        HStack(spacing: 5) {
            Image(systemName: systemImage).font(.caption)
            Text(title).lineLimit(1)
            Image(systemName: "chevron.up.chevron.down").font(.caption2).foregroundStyle(.secondary)
        }
        .font(.subheadline)
        .foregroundStyle(.primary)
        .padding(.horizontal, 12)
        .frame(height: 32)
        .background(.fill.tertiary, in: .capsule)
    }

    private func loadOptions() async {
        let provider = providerId.isEmpty ? defaults?.providerId : providerId
        options = try? await client.executionOptions(providerId: provider)
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
            try await operation.run(currentServer: { app.serverURL }, work: { client in
                let projectId = self.projectId
                let text = self.text
                let attachments = self.attachments
                let selectedWorkspace = self.selectedWorkspace
                let choice = ExecutionChoice(
                    providerId: providerId.isEmpty ? nil : providerId,
                    model: modelId.isEmpty ? nil : modelId,
                    reasoningLevel: reasoning.isEmpty ? nil : reasoning,
                    permissionMode: permissionMode.isEmpty ? nil : permissionMode)
                let inputs = try await PendingAttachment.upload(attachments, projectId: projectId, client: client)
                let thread = try await client.createThread(
                    projectId: projectId, text: text.trimmingCharacters(in: .whitespacesAndNewlines), attachments: inputs,
                    options: choice, workspace: selectedWorkspace)
                return thread
            }, completion: { created in
                dismiss()
                app.openThread(created.id)
            })
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
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
