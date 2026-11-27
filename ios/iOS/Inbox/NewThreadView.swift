import SwiftUI

/// New thread, and a Bot's New conversation: one composer. Who it's with
/// (any Bot, or no Bot: a plain thread in a project), the project, the
/// workspace and the model are chips above the field, as on the desktop's
/// composer. A Bot's conversation starts on the Bot's default model (Auto
/// when that is its default) in its Main's project; a plain thread on the
/// project's defaults.
struct NewThreadView: View {
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }
    @Environment(\.dismiss) private var dismiss
    /// The project a plain thread last started in; a Bot's conversation starts in its Main's project.
    @AppStorage(ServerScope.key("newThreadProjectId"), store: AppGroup.defaults) private var savedProjectId = ""
    @ObservedObject private var spaces = BotSpacesStore.shared
    @State private var projectId = ""
    @State private var projects: [Project] = []
    /// The Bot the conversation is with; empty for a plain thread.
    @State private var botId: String
    @State private var botPreset: ExecutionChoice?
    @State private var projectDefaults: ExecutionChoice?
    @State private var environments: [ThreadEnvironment] = []
    @State private var workspace = "default"
    @State private var baseBranch = ""
    @State private var text: String
    @State private var attachments: [PendingAttachment] = []
    @StateObject private var dictation = DictationGate()
    /// The mic: tap to dictate into the message, inline; hold to talk it in.
    @StateObject private var talk = HoldToTalk(threadId: nil)
    @State private var talkTyped: String?
    @State private var focused = false
    @State private var creating = false
    @State private var error: String?
    /// A Bot's conversation from its list: the room opens it there. Else the app opens what started.
    private let started: ((String, String?) -> Void)?

    // Execution options. Empty means the default (the Bot's, else the project's).
    @State private var options: ExecutionOptions?
    @State private var providerId = ""
    @State private var modelId = ""
    @State private var reasoning = ""
    @State private var permissionMode = ""

    init(text: String = "", botId: String? = nil, started: ((String, String?) -> Void)? = nil) {
        _text = State(initialValue: text)
        _botId = State(initialValue: botId ?? "")
        self.started = started
    }

    private var bots: [BotSpace] { spaces.spaces?.bots ?? [] }
    private var bot: BotSpace? { botId.isEmpty ? nil : bots.first { $0.id == botId } }
    private var defaults: ExecutionChoice? {
        NewConversationChoice.defaults(bot: botId.isEmpty ? nil : botPreset, project: projectDefaults)
    }

    /// A chat, not a form: an empty conversation with the composer at the
    /// bottom, saying who it's with. The chips are set to the defaults, so
    /// most conversations need only a message.
    var body: some View {
        NavigationStack {
            NewConversationGreeting(bot: bot)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 32)
            .contentShape(.rect)
            .onTapGesture { focused = false }
            .safeAreaInset(edge: .bottom) { composer }
            .navigationTitle(bot == nil ? "New thread" : "New conversation")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { operation.complete(on: app) { dismiss() } } }
            }
            .onAppear {
                focused = true
                // There's no thread to send to yet: what you say goes in the message.
                let insert: (String) -> Void = { spoken in text = TalkDraft.finished(spoken, typed: &talkTyped, draft: text) }
                talk.insert = insert
                talk.send = insert
            }
            .modifier(TalkDraft(talk: talk, draft: $text, typed: $talkTyped))
            .modifier(TalkLifecycle(talk: talk))
            .onChange(of: talk.error) { _, error in if let error { self.error = error } }
            // Its loads, one level of the view's type (`NewThreadLoads`).
            .modifier(NewThreadLoads(botId: botId, projectId: projectId, defaultsProvider: defaults?.providerId ?? "", providerId: providerId,
                start: {
                    // Like desktop, a thread needs no project: it starts in the personal one.
                    if botId.isEmpty, projectId.isEmpty { projectId = NewThreadProject.resolve(saved: savedProjectId, projects: []) }
                    guard let loaded = try? await client.projects() else { return }
                    projects = loaded
                    if botId.isEmpty { projectId = NewThreadProject.resolve(saved: projectId, projects: loaded) }
                },
                bot: { await choseBot() },
                project: {
                    guard !projectId.isEmpty else { return }
                    workspace = "default"
                    environments = (try? await client.threadEnvironments(projectId: projectId)) ?? []
                    projectDefaults = (try? await client.projectDefaults(projectId)) ?? nil
                },
                defaults: { if providerId.isEmpty { await loadOptions() } },
                provider: {
                    modelId = ""
                    reasoning = ""
                    await loadOptions()
                    matchModelOption()
                }))
        }
    }

    /// A Bot: its default model and its Main's project, as the desktop's New conversation seeds its composer. No Bot: the project last used.
    private func choseBot() async {
        providerId = ""
        modelId = ""
        reasoning = ""
        permissionMode = ""
        guard let bot else {
            botPreset = nil
            projectId = NewThreadProject.resolve(saved: savedProjectId, projects: projects)
            return
        }
        let id = bot.id
        if let project = await botProject(bot), botId == id { projectId = project }
        let preset = try? await client.botDefaultModel(botId: id)
        if botId == id { botPreset = preset ?? nil }
    }

    private func botProject(_ bot: BotSpace) async -> String? {
        if let project = spaces.view(for: bot.id)?.main?.projectId { return project }
        guard let main = bot.mainThreadId else { return NewThreadProject.personalId }
        return (try? await client.thread(main).projectId) ?? NewThreadProject.personalId
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let error { Text(error).font(.footnote).foregroundStyle(.red) }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    if !bots.isEmpty { withChip }
                    projectChip
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
            TalkStatusBar(talk: talk)
            ComposerBar(
                text: $text, focused: $focused, attachments: $attachments,
                placeholder: bot.map { "Message \($0.name)" } ?? "What should the agent do?", maxLines: 10,
                dictate: { talk.startDictation() }, talk: talk, dictation: dictation
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
                .accessibilityIdentifier("newConversationStart")
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(.bar)
    }

    private var canStart: Bool {
        (!text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty) && !projectId.isEmpty && !creating
            && !dictation.blocksSend
    }

    /// Who the conversation is with: any of the Bots, or none (a plain thread in a project).
    private var withChip: some View {
        Menu {
            Picker("With", selection: $botId) {
                ForEach(bots) { each in Text(each.name).tag(each.id) }
                Text("No Bot: a thread in a project").tag("")
            }
            .pickerStyle(.inline)
        } label: {
            HStack(spacing: 5) {
                if let bot {
                    BotAvatar(BotLook(shape: bot.shape, color: bot.color, emoji: bot.avatar), size: 18)
                } else {
                    Image(systemName: "bubble.left").font(.caption)
                }
                Text(bot?.name ?? "No Bot").lineLimit(1)
                Image(systemName: "chevron.up.chevron.down").font(.caption2).foregroundStyle(.secondary)
            }
            .font(.subheadline)
            .foregroundStyle(.primary)
            .padding(.horizontal, 12)
            .frame(height: 32)
            .background(.fill.tertiary, in: .capsule)
        }
        .accessibilityLabel("With \(bot?.name ?? "no Bot")")
        .accessibilityIdentifier("newConversationBot")
    }

    private var projectChip: some View {
        Menu {
            Picker("Project", selection: $projectId) {
                Text(NewThreadProject.personalLabel).tag(NewThreadProject.personalId)
                ForEach(projects) { Text($0.name).tag($0.id) }
            }
            .pickerStyle(.inline)
        } label: {
            chip(NewThreadProject.label(projectId, projects: projects), systemImage: "folder")
        }
        .accessibilityIdentifier("newThreadProject")
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
        guard !dictation.blocksSend else { return }
        creating = true
        defer { creating = false }
        let botId = bot?.id
        if botId == nil { savedProjectId = projectId }
        do {
            try await operation.run(currentServer: { app.serverURL }, work: { client in
                let projectId = self.projectId
                let text = self.text.trimmingCharacters(in: .whitespacesAndNewlines)
                let attachments = self.attachments
                let selectedWorkspace = self.selectedWorkspace
                let inputs = try await PendingAttachment.upload(attachments, projectId: projectId, client: client)
                if let botId {
                    let choice = NewConversationChoice.resolve(
                        provider: providerId, model: modelId, reasoning: reasoning, permission: permissionMode, defaults: defaults,
                        shownProvider: options?.providers.first { $0.available != false }?.id, shownModel: selectedModel?.model)
                    return try await client.startConversation(botId: botId, projectId: projectId, text: text, choice: choice,
                                                              attachments: inputs, workspace: selectedWorkspace)
                }
                let choice = ExecutionChoice(
                    providerId: providerId.isEmpty ? nil : providerId,
                    model: modelId.isEmpty ? nil : modelId,
                    reasoningLevel: reasoning.isEmpty ? nil : reasoning,
                    permissionMode: permissionMode.isEmpty ? nil : permissionMode)
                return try await client.createThread(
                    projectId: projectId, text: text, attachments: inputs, options: choice, workspace: selectedWorkspace).id
            }, completion: { threadId in
                dismiss()
                if let started { started(threadId, botId) } else { app.open(.conversation(threadId)) }
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

/// Who the new conversation is with: the Bot's avatar and name, or the open question.
private struct NewConversationGreeting: View {
    let bot: BotSpace?

    var body: some View {
        VStack(spacing: 8) {
            Spacer()
            if let bot {
                BotAvatar(BotLook(shape: bot.shape, color: bot.color, emoji: bot.avatar), size: 44)
                Text("New conversation with \(bot.name)")
                    .font(.title2.weight(.semibold))
                    .multilineTextAlignment(.center)
                    .accessibilityIdentifier("newConversationWith")
            } else {
                Text("What should we work on?")
                    .font(.title2.weight(.semibold))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("newConversationWith")
            }
            Spacer()
        }
    }
}

/// New thread's loads, each keyed as before: the projects, the Bot, the
/// project's environments, the provider's options.
private struct NewThreadLoads: ViewModifier {
    let botId: String
    let projectId: String
    let defaultsProvider: String
    let providerId: String
    let start: @MainActor () async -> Void
    let bot: @MainActor () async -> Void
    let project: @MainActor () async -> Void
    let defaults: @MainActor () async -> Void
    let provider: @MainActor () async -> Void

    func body(content: Content) -> some View {
        content
            .task { await start() }
            .task(id: botId) { await bot() }
            .task(id: projectId) { await project() }
            .task(id: defaultsProvider) { await defaults() }
            .task(id: providerId) { await provider() }
    }
}
