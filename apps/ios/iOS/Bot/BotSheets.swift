import SwiftUI

// MARK: Edit profile

/// Who the Bot is: its avatar, name, role and check-ins. A new Bot is made
/// by the welcome (BotOnboarding.swift), not here.
struct BotProfileSheet: View {
    let bot: BotInfo?
    /// The bot being edited; nil for the primary.
    var botId: String? = nil
    var saved: (BotInfo?) -> Void
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var role = ""
    @State private var shape: BotShape = .default
    @State private var color = BotPalette.hexes[0]
    /// The color follows the name until one is picked.
    @State private var matchName = true
    @State private var checkIn = CheckIn.unchanged
    @State private var busy = false
    @State private var error: String?
    /// What the Bot changed about itself, each with Revert.
    @State private var changes: [BotProfileChange] = []

    /// Check-ins as Studio's presets (`bot_checkin_preset`); `unchanged` keeps a hand-made schedule.
    enum CheckIn: Hashable, Identifiable {
        case unchanged
        case preset(BotCheckinPreset)
        var id: String { if case .preset(let preset) = self { preset.rawValue } else { "unchanged" } }
        static var allCases: [CheckIn] { [.unchanged] + BotCheckinPreset.allCases.map(CheckIn.preset) }
        var title: String { if case .preset(let preset) = self { preset.title } else { "Keep current" } }
        var detail: String { if case .preset(let preset) = self { preset.detail } else { "" } }
        var icon: String { if case .preset(let preset) = self { preset.symbol } else { "circle" } }
        static func of(_ lead: ThreadLead?) -> CheckIn { BotCheckinPreset.of(lead).map(CheckIn.preset) ?? .unchanged }
    }

    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var look: BotLook { BotLook(shape: shape.rawValue, color: color, emoji: bot?.avatar ?? BotInfo.defaultAvatar) }
    private var tint: Color { BotPalette.color(color) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(spacing: 14) {
                        BotAvatar(look, size: 96)
                            .shadow(color: tint.opacity(0.4), radius: 20, y: 10)
                            .animation(.bouncy, value: shape)
                            .animation(.smooth, value: color)
                            .padding(.top, 8)
                        TextField("Name", text: $name)
                            .font(.title2.weight(.semibold))
                            .multilineTextAlignment(.center)
                            .textInputAutocapitalization(.words)
                            .submitLabel(.done)
                            .padding(.vertical, 10)
                            .background(.fill.tertiary, in: .rect(cornerRadius: 14))
                            .accessibilityLabel("Name")
                    }
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
                }
                Section("Shape") {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 5), spacing: 10) {
                        ForEach(BotShape.allCases) { option in
                            Button { shape = option } label: {
                                BotAvatar(BotLook(shape: option.rawValue, color: color, emoji: ""), size: 40)
                                    .frame(width: 54, height: 54)
                                    .background(option == shape ? tint.opacity(0.16) : Color.clear, in: .rect(cornerRadius: 14))
                                    .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(option == shape ? tint : .clear, lineWidth: 2))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(option.label)
                            .accessibilityAddTraits(option == shape ? .isSelected : [])
                        }
                    }
                    .padding(.vertical, 4)
                    .sensoryFeedback(.selection, trigger: shape)
                }
                Section {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 6), spacing: 12) {
                        ForEach(BotPalette.hexes, id: \.self) { hex in
                            Button {
                                matchName = false
                                color = hex
                            } label: {
                                Circle().fill(BotPalette.color(hex))
                                    .frame(width: 34, height: 34)
                                    .padding(3)
                                    .overlay(Circle().strokeBorder(hex == color ? BotPalette.color(hex) : .clear, lineWidth: 2.5))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Color \(BotPalette.hexes.firstIndex(of: hex)! + 1)")
                            .accessibilityAddTraits(hex == color ? .isSelected : [])
                        }
                    }
                    .padding(.vertical, 4)
                    .sensoryFeedback(.selection, trigger: color)
                    Toggle("Match the name", isOn: $matchName)
                } header: { Text("Color") }
                Section {
                    TextField("You are my chief of staff. Keep me on top of…", text: $role, axis: .vertical)
                        .lineLimit(2...5)
                } header: { Text("Role") } footer: { Text("A sentence or two on what \(trimmedName.isEmpty ? "it" : trimmedName) does for you.") }
                if !changes.isEmpty {
                    Section {
                        ForEach(changes.prefix(5)) { change in
                            HStack(spacing: 8) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(change.byLine).font(.caption).foregroundStyle(.secondary)
                                    Text(change.summary).font(.subheadline).lineLimit(2)
                                }
                                Spacer()
                                if change.canRevert {
                                    Button("Revert") { Task { await revert(change) } }.buttonStyle(.borderless).disabled(busy)
                                } else if change.revertedAt != nil {
                                    Text("Reverted").font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    } header: { Text("Profile changes") } footer: { Text("Changes \(bot?.name ?? "it") made to itself. Revert puts back what it replaced.") }
                }
                Section {
                    ForEach(CheckIn.allCases.filter { $0 != .unchanged || checkIn == .unchanged }) { option in
                        Button { checkIn = option } label: {
                            HStack(spacing: 12) {
                                Image(systemName: option.icon).foregroundStyle(tint).frame(width: 24)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(option.title).foregroundStyle(.primary)
                                    if !option.detail.isEmpty { Text(option.detail).font(.caption).foregroundStyle(.secondary) }
                                }
                                Spacer()
                                if option == checkIn { Image(systemName: "checkmark").fontWeight(.semibold).foregroundStyle(tint) }
                            }
                        }
                        .accessibilityAddTraits(option == checkIn ? .isSelected : [])
                    }
                } header: { Text("Check-ins") } footer: {
                    Text(bot?.state == .active || bot == nil ? "When \(trimmedName.isEmpty ? "it" : trimmedName) wakes on its own to look around." : "Resume it to change its check-ins.")
                }
                .disabled(bot != nil && bot?.state != .active)
                if let error { Section { Text(error).foregroundStyle(.red) } }
            }
            .tint(tint)
            .navigationTitle("Edit profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(busy || trimmedName.isEmpty)
                }
            }
            .onChange(of: name) { _, value in if matchName { color = BotPalette.hex(forName: value) } }
            .onChange(of: matchName) { _, on in if on { color = BotPalette.hex(forName: name) } }
            .onAppear {
                name = bot?.name ?? BotInfo.defaultName
                role = bot?.role ?? ""
                shape = bot?.shape.flatMap(BotShape.init(rawValue:)) ?? .default
                color = bot?.color ?? BotPalette.hex(forName: name)
                matchName = bot?.color == nil || bot?.color == BotPalette.hex(forName: name)
                checkIn = CheckIn.of(bot?.lead)
            }
            .task { await loadChanges() }
        }
    }

    private func loadChanges() async {
        guard bot != nil else { return }
        // An older Studio has no change log; the sheet works without it.
        changes = (try? await app.client.botProfileChanges(botId: botId)) ?? []
    }

    private func revert(_ change: BotProfileChange) async {
        busy = true
        defer { busy = false }
        do {
            if let next = try await app.client.revertBotProfileChange(change.id, botId: botId) {
                name = next.name
                role = next.role ?? ""
                shape = next.shape.flatMap(BotShape.init(rawValue:)) ?? shape
                color = next.color ?? color
                saved(next)
            }
            await loadChanges()
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }

    private func save() async {
        busy = true
        defer { busy = false }
        let client = app.client
        do {
            let target = botId
            var next = try await client.setBotProfile(name: trimmedName, shape: shape, color: color, role: role, botId: target)
            if case .preset(let preset) = checkIn, next?.state == .active, preset != BotCheckinPreset.of(next?.lead) {
                next = try await client.setBotCheckinPreset(preset, botId: target) ?? next
            }
            saved(next)
            dismiss()
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
    }
}

// MARK: Skills

/// The procedures the Bot saved for itself, how it learns them, and changes waiting for approval.
struct BotSkillsSheet: View {
    let name: String
    var botId: String? = nil
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var skills: [BotSkill]?
    @State private var learning: BotLearning?
    @State private var error: String?

    private var current: [BotSkill] { (skills ?? []).filter { !$0.isArchived } }
    private var archived: [BotSkill] { (skills ?? []).filter(\.isArchived) }

    var body: some View {
        NavigationStack {
            List {
                if let learning {
                    Section {
                        Toggle("Learn from work", isOn: Binding(get: { learning.enabled }, set: { on in act { _ = try await app.client.setBotLearning(enabled: on, botId: botId) } }))
                    } footer: {
                        Text([learning.enabled ? "Reviews its work every \(learning.interval) turns and saves what's worth keeping." : "Off: it saves skills only when it decides to.", learning.status()].compactMap { $0 }.joined(separator: " "))
                    }
                    if !learning.pending.isEmpty {
                        Section("Waiting for your approval") {
                            ForEach(learning.pending) { change in
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(change.action == "delete" ? "Delete \(change.name)" : change.name).font(.body.monospaced().weight(.medium))
                                    Text(change.diff).font(.caption.monospaced()).foregroundStyle(.secondary).lineLimit(8)
                                    HStack {
                                        Button("Approve") { act { try await app.client.resolveBotSkillChange(change.id, approve: true, botId: botId) } }
                                        Button("Reject", role: .destructive) { act { try await app.client.resolveBotSkillChange(change.id, approve: false, botId: botId) } }
                                    }
                                    .buttonStyle(.borderless)
                                }
                            }
                        }
                    }
                }
                Section {
                    ForEach(current) { skill in
                        VStack(alignment: .leading, spacing: 3) {
                            HStack(spacing: 6) {
                                Text(skill.name).font(.body.monospaced().weight(.medium))
                                if skill.pinned == true { Image(systemName: "pin.fill").font(.caption).foregroundStyle(.secondary).accessibilityLabel("Pinned") }
                                if skill.state == "stale" { Text("stale").font(.caption).foregroundStyle(.secondary) }
                            }
                            Text(skill.description).font(.subheadline).foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 2)
                        .swipeActions {
                            Button(skill.pinned == true ? "Unpin" : "Pin") { act { try await app.client.pinBotSkill(skill.name, pinned: skill.pinned != true, botId: botId) } }
                                .tint(.orange)
                        }
                    }
                }
                if !archived.isEmpty {
                    Section {
                        DisclosureGroup("Archived (\(archived.count))") {
                            ForEach(archived) { skill in
                                HStack {
                                    Text(skill.name).font(.body.monospaced()).foregroundStyle(.secondary)
                                    Spacer()
                                    Button("Restore") { act { try await app.client.restoreBotSkill(skill.name, botId: botId) } }.buttonStyle(.borderless)
                                }
                            }
                        }
                    }
                }
            }
            .overlay {
                if let error {
                    ContentUnavailableView("Couldn't load skills", systemImage: "exclamationmark.triangle", description: Text(error))
                } else if skills == nil {
                    ProgressView()
                } else if current.isEmpty && archived.isEmpty && learning == nil {
                    ContentUnavailableView("No skills yet", systemImage: "wand.and.stars",
                                           description: Text("When \(name) works out how to do something, it saves the steps here and reuses them."))
                }
            }
            .navigationTitle("Skills")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { await load() }
        }
        .presentationDetents([.medium, .large])
    }

    private func load() async {
        do {
            skills = try await app.client.botSkills(botId: botId)
            // An older Studio has no learning; the list still shows.
            learning = try? await app.client.botLearning(botId: botId)
        } catch { self.error = BBClient.describe(error, server: app.client.baseURL) }
    }

    private func act(_ work: @escaping () async throws -> Void) {
        Task {
            do { try await work(); await load() } catch { self.error = BBClient.describe(error, server: app.client.baseURL) }
        }
    }
}
