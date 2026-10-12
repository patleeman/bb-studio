import SwiftUI

// MARK: Activity

/// What the Bot is doing: Needs you, Waiting, Running, Scheduled, Recent, only
/// the sections with something in them.
struct BotActivitySheet: View {
    let bot: BotInfo?
    var botId: String? = nil
    let activity: BotActivity?
    var open: (String) -> Void
    var refresh: () async -> Void
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    /// Its runners (`bot_runners`); external bots have none.
    @State private var runners: [BotRunner] = []
    @State private var runnerBusy: String?
    @State private var runnerError: String?

    private var name: String { bot?.name ?? BotInfo.defaultName }

    var body: some View {
        NavigationStack {
            let sections = BotActivitySection.sections(activity)
            List {
                ForEach(sections) { section in
                    Section {
                        ForEach(section.rows) { row in
                            switch row {
                            case .thread(let thread): threadRow(thread, in: section.kind)
                            case .scheduled(let item): scheduledRow(item)
                            }
                        }
                    } header: {
                        HStack(spacing: 6) {
                            Text(section.title)
                            if section.kind == .needsYou {
                                Text("\(section.rows.count)")
                                    .font(.caption2.weight(.bold))
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 6).padding(.vertical, 1)
                                    .background(.orange, in: .capsule)
                            }
                        }
                    }
                }
                if !runners.isEmpty {
                    Section {
                        ForEach(runners) { runnerRow($0) }
                    } header: { Text("Runners") } footer: {
                        if let runnerError { Text(runnerError).foregroundStyle(.red) }
                    }
                }
            }
            .overlay {
                if activity == nil {
                    ProgressView()
                } else if sections.isEmpty && runners.isEmpty {
                    ContentUnavailableView {
                        Label { Text("All quiet") } icon: { if let bot { BotAvatar(bot.look, size: 56) } }
                    } description: {
                        Text("Threads \(name) starts, check-ins and anything that needs you show here.")
                    }
                }
            }
            .refreshable { await refresh(); await loadRunners() }
            .task { await loadRunners() }
            .navigationTitle("Activity")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func threadRow(_ thread: BotActivity.Thread, in kind: BotActivitySection.Kind) -> some View {
        Button { open(thread.id) } label: {
            HStack(spacing: 12) {
                Image(systemName: icon(thread, kind))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(tint(kind))
                    .frame(width: 30, height: 30)
                    .background(tint(kind).opacity(0.14), in: .circle)
                VStack(alignment: .leading, spacing: 2) {
                    Text(thread.relation == "self" ? "Chat with \(name)" : thread.title).lineLimit(1)
                    Text(subtitle(thread, kind)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 0)
            }
        }
        .foregroundStyle(.primary)
        .accessibilityHint("Opens the thread")
    }

    private func runnerRow(_ runner: BotRunner) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: runner.paused ? "pause.fill" : "figure.run")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(runner.paused ? Color.secondary : Color.purple)
                .frame(width: 30, height: 30)
                .background((runner.paused ? Color.secondary : Color.purple).opacity(0.14), in: .circle)
            VStack(alignment: .leading, spacing: 2) {
                Text(runner.name).lineLimit(1)
                Text(runnerSubtitle(runner)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                if let report = runner.lastReport, !report.isEmpty {
                    Text(report).font(.caption).foregroundStyle(runner.urgent == true ? AnyShapeStyle(.orange) : AnyShapeStyle(.primary)).lineLimit(2)
                }
            }
            Spacer(minLength: 0)
            if runnerBusy == runner.id {
                ProgressView().frame(width: 30, height: 30)
            } else {
                Button { act(runner) { try await $0.runRunnerNow(runner.id, botId: botId) } } label: {
                    Image(systemName: "play.fill").frame(width: 30, height: 30)
                }
                .disabled(runner.paused)
                .accessibilityLabel("Run \(runner.name) now")
                Button { act(runner) { try await $0.setRunnerPaused(runner.id, paused: !runner.paused, botId: botId) } } label: {
                    Image(systemName: runner.paused ? "playpause.fill" : "pause").frame(width: 30, height: 30)
                }
                .accessibilityLabel(runner.paused ? "Resume \(runner.name)" : "Pause \(runner.name)")
            }
        }
        .buttonStyle(.borderless)
    }

    private func runnerSubtitle(_ runner: BotRunner) -> String {
        if runner.paused { return "Paused · \(runner.scheduleLabel)" }
        let last = (runner.lastReportAt ?? runner.lastRunAt).flatMap(BotChatEntry.date).map { "Last \($0.formatted(.relative(presentation: .named)))" }
        return [runner.scheduleLabel, last].compactMap { $0 }.joined(separator: " · ")
    }

    private func loadRunners() async {
        #if DEBUG
        if BotDemo.current != nil { runners = BotDemo.runners; return }
        #endif
        guard bot?.external != true, bot != nil else { runners = []; return }
        if let next = try? await app.client.botRunners(botId: botId) { runners = next }
    }

    private func act(_ runner: BotRunner, _ work: @escaping (BBClient) async throws -> Void) {
        runnerBusy = runner.id
        Task {
            defer { runnerBusy = nil }
            do {
                try await work(app.client)
                runnerError = nil
                await loadRunners()
            } catch {
                runnerError = BBClient.describe(error, server: app.client.baseURL)
            }
        }
    }

    private func scheduledRow(_ item: BotActivity.Scheduled) -> some View {
        HStack(spacing: 12) {
            Image(systemName: item.kind == "heartbeat" ? "alarm" : "clock.arrow.circlepath")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.blue)
                .frame(width: 30, height: 30)
                .background(Color.blue.opacity(0.14), in: .circle)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.kind == "heartbeat" ? "Check-in" : item.name).lineLimit(1)
                Text(item.nextRunAt.map { "Next \(BotChatEntry.date($0)!.formatted(.relative(presentation: .named)))" } ?? "On")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func icon(_ thread: BotActivity.Thread, _ kind: BotActivitySection.Kind) -> String {
        switch kind {
        case .needsYou: "hand.raised.fill"
        case .waiting: "hourglass"
        case .running: "bolt.fill"
        default: thread.status == "error" ? "exclamationmark.triangle.fill" : "checkmark"
        }
    }

    private func tint(_ kind: BotActivitySection.Kind) -> Color {
        switch kind {
        case .needsYou: .orange
        case .waiting: .secondary
        case .running: .green
        case .scheduled: .blue
        case .recent: .secondary
        }
    }

    private func subtitle(_ thread: BotActivity.Thread, _ kind: BotActivitySection.Kind) -> String {
        let when = BotChatEntry.date(thread.updatedAt)?.formatted(.relative(presentation: .named)) ?? ""
        switch kind {
        case .needsYou: return "Waiting for you · \(when)"
        case .waiting: return "Queued · \(when)"
        case .running: return "Running · \(when)"
        default: return thread.status == "error" ? "Failed · \(when)" : "Finished \(when)"
        }
    }
}

// MARK: Edit profile

/// Who the Bot is: its avatar, name, role and check-ins. Makes the Bot when
/// there is none.
struct BotProfileSheet: View {
    let bot: BotInfo?
    /// The bot being edited; nil for the primary.
    var botId: String? = nil
    /// Making another bot (the Bots list's +): asks for its first message.
    var adding = false
    var saved: (BotInfo?) -> Void
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var role = ""
    @State private var prompt = ""
    @State private var shape: BotShape = .default
    @State private var color = BotPalette.hexes[0]
    /// The color follows the name until one is picked.
    @State private var matchName = true
    @State private var checkIn = CheckIn.unchanged
    @State private var busy = false
    @State private var error: String?

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
                if adding {
                    Section {
                        TextField("What should it start on?", text: $prompt, axis: .vertical)
                            .lineLimit(2...6)
                    } header: { Text("First message") } footer: {
                        Text("Bots that run on another provider can't be added here yet. Import them on desktop.")
                    }
                }
                Section {
                    TextField("You are my chief of staff. Keep me on top of…", text: $role, axis: .vertical)
                        .lineLimit(2...5)
                } header: { Text("Role") } footer: { Text("A sentence or two on what \(trimmedName.isEmpty ? "it" : trimmedName) does for you.") }
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
            .navigationTitle(adding ? "New bot" : bot == nil ? "Make your Bot" : "Edit profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(bot == nil ? "Create" : "Save") { Task { await save() } }
                        .disabled(busy || trimmedName.isEmpty)
                }
            }
            .onChange(of: name) { _, value in if matchName { color = BotPalette.hex(forName: value) } }
            .onChange(of: matchName) { _, on in if on { color = BotPalette.hex(forName: name) } }
            .onAppear {
                name = bot?.name ?? (adding ? "" : BotInfo.defaultName)
                role = bot?.role ?? ""
                shape = bot?.shape.flatMap(BotShape.init(rawValue:)) ?? .default
                color = bot?.color ?? BotPalette.hex(forName: name)
                matchName = bot?.color == nil || bot?.color == BotPalette.hex(forName: name)
                checkIn = bot == nil ? .preset(.morning) : CheckIn.of(bot?.lead)
            }
        }
    }

    private func save() async {
        busy = true
        defer { busy = false }
        let client = app.client
        do {
            var next: BotInfo?
            var target = botId
            if bot == nil {
                let first = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
                next = try await client.createBot(name: trimmedName, shape: shape, color: color, prompt: first.isEmpty ? nil : first)
                if next?.primary == false { target = next?.id }
                if !role.trimmingCharacters(in: .whitespaces).isEmpty {
                    next = try await client.setBotProfile(name: trimmedName, shape: shape, color: color, role: role, botId: target) ?? next
                }
            } else {
                next = try await client.setBotProfile(name: trimmedName, shape: shape, color: color, role: role, botId: target)
            }
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

/// The procedures the Bot saved for itself.
struct BotSkillsSheet: View {
    let name: String
    var botId: String? = nil
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var skills: [BotSkill]?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                ForEach(skills ?? []) { skill in
                    VStack(alignment: .leading, spacing: 3) {
                        Text(skill.name).font(.body.monospaced().weight(.medium))
                        Text(skill.description).font(.subheadline).foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 2)
                }
            }
            .overlay {
                if let error {
                    ContentUnavailableView("Couldn't load skills", systemImage: "exclamationmark.triangle", description: Text(error))
                } else if skills == nil {
                    ProgressView()
                } else if skills?.isEmpty == true {
                    ContentUnavailableView("No skills yet", systemImage: "wand.and.stars",
                                           description: Text("When \(name) works out how to do something, it saves the steps here and reuses them."))
                }
            }
            .navigationTitle("Skills")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task {
                do { skills = try await app.client.botSkills(botId: botId) } catch { self.error = BBClient.describe(error, server: app.client.baseURL) }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
