import SwiftUI

/// The threads under a Bot, as on the desktop Bots sidebar: Needs you,
/// Running, Runners, Recurring, Recent and Earlier conversations, a thread
/// nested under the thread that started it, each with its status dot. A tap
/// opens the thread. It refreshes with the Bot tab's Activity (BB's thread
/// changes) and on pull; it adds no timers.
struct BotThreadsSheet: View {
    let bot: BotInfo?
    var botId: String? = nil
    let activity: BotActivity?
    var open: (String) -> Void
    var refresh: () async -> Void
    var embedded = false
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    /// Its runners (`bot_runners`); external bots have none.
    @State private var runners: [BotRunner] = []
    /// Its handoff chain with titles (`bot_chain`).
    @State private var chain = BotChainThreads()
    @State private var runnerBusy: String?
    @State private var runnerError: String?
    /// Collapsed groups, as on desktop; Earlier conversations starts closed.
    @AppStorage("bot.threads.closed") private var closedGroups = "earlier"

    private var name: String { bot?.name ?? BotInfo.defaultName }

    var body: some View {
        NavigationStack {
            let groups = BotThreadGroups(activity)
            let earlier = chain.earlier(current: bot?.lead.threadId)
            List {
                if embedded, let id = bot?.lead.threadId {
                    Section {
                        Button { open(id) } label: {
                            Label("Chat", systemImage: "bubble.left.and.bubble.right")
                                .frame(maxWidth: .infinity, alignment: .leading).contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .modifier(SidebarRowContent(enabled: embedded))
                    }
                }
                if !groups.needsYou.isEmpty {
                    group("needs", "Needs you", badge: groups.needsYou.count) {
                        ForEach(groups.needsYou) { threadRow($0, depth: 0) }
                    }
                }
                if !groups.running.isEmpty {
                    group("running", "Running") {
                        ForEach(BotThreadGroups.rows(groups.running)) { threadRow($0.thread, depth: $0.depth) }
                    }
                }
                if !runners.isEmpty {
                    group("runners", "Runners") {
                        ForEach(runners) { runnerRow($0) }
                        if let runnerError { Text(runnerError).font(.footnote).foregroundStyle(.red) }
                    }
                }
                if !groups.recurring.isEmpty {
                    group("recurring", "Recurring") {
                        ForEach(groups.recurring) { recurringRow($0) }
                    }
                }
                if !groups.recent.isEmpty {
                    group("recent", "Recent") {
                        ForEach(BotThreadGroups.rows(groups.recent)) { threadRow($0.thread, depth: $0.depth) }
                    }
                }
                if activity != nil, groups.isEmpty {
                    Text("Threads \(name) starts show up here.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                if !earlier.isEmpty {
                    group("earlier", "Earlier conversations") {
                        ForEach(earlier, id: \.self) { earlierRow($0) }
                    }
                }
            }
            .listStyle(.sidebar)
            .modifier(SidebarListMargins(enabled: embedded))
            .overlay { if activity == nil { ProgressView() } }
            .refreshable { await refresh(); await loadRunners(); await loadChain() }
            .task { await loadChain() }
            // Runners follow the Activity, which BB's thread changes refresh.
            .task(id: activity) { await loadRunners() }
            .navigationTitle(embedded ? name : "Activity")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { if !embedded { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } } }
            .toolbar(embedded ? .hidden : .automatic, for: .navigationBar)
            .safeAreaInset(edge: .top, spacing: 0) {
                if embedded {
                    DuoHeader { Text(name).font(.title2.bold()) } actions: { EmptyView() }
                        .ignoresSafeArea(.container, edges: .trailing)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    // MARK: Groups

    private func group<Content: View>(_ id: String, _ title: String, badge: Int = 0, @ViewBuilder content: () -> Content) -> some View {
        Section(isExpanded: expanded(id)) {
            content()
        } header: {
            HStack(spacing: 6) {
                Text(title)
                if badge > 0 {
                    Text("\(badge)")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6).padding(.vertical, 1)
                        .background(.orange, in: .capsule)
                }
            }
            .modifier(SidebarRowContent(enabled: embedded))
        }
    }

    private func expanded(_ id: String) -> Binding<Bool> {
        Binding {
            !closedGroups.split(separator: ",").contains(Substring(id))
        } set: { open in
            var closed = closedGroups.split(separator: ",").map(String.init).filter { $0 != id }
            if !open { closed.append(id) }
            closedGroups = closed.joined(separator: ",")
        }
    }

    // MARK: Rows

    private func threadRow(_ thread: BotActivity.Thread, depth: Int) -> some View {
        let tone = BotThreadTone(thread)
        let age = BotAge.label(thread.updatedAt)
        return Button { open(thread.id) } label: {
            HStack(spacing: 10) {
                if depth > 0 {
                    Image(systemName: "arrow.turn.down.right")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                BotStatusDot(tone: tone)
                Text(thread.title.isEmpty ? "Untitled" : thread.title)
                    .lineLimit(1)
                    .foregroundStyle(tone == .idle ? AnyShapeStyle(.secondary) : AnyShapeStyle(.primary))
                Spacer(minLength: 8)
                Text(age).font(.caption).monospacedDigit().foregroundStyle(.secondary)
            }
            .padding(.leading, CGFloat(max(depth - 1, 0)) * 16)
        }
        .modifier(SidebarRowContent(enabled: embedded))
        .foregroundStyle(.primary)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(thread.title), \(tone.label), \(age)")
        .accessibilityHint(depth > 0 ? "Started by the thread above. Opens the thread" : "Opens the thread")
        .accessibilityAddTraits(.isButton)
    }

    private func runnerRow(_ runner: BotRunner) -> some View {
        Button { openRunner(runner) } label: {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                BotStatusDot(color: runner.urgent == true ? .orange : runner.paused ? .secondary : .green, hollow: runner.paused && runner.urgent != true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(runner.name)
                        .lineLimit(1)
                        .foregroundStyle(runner.paused ? AnyShapeStyle(.secondary) : AnyShapeStyle(.primary))
                    Text(runner.subtitle()).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    if let report = runner.lastReport, !report.isEmpty {
                        Text(report)
                            .font(.caption)
                            .foregroundStyle(runner.urgent == true ? AnyShapeStyle(.orange) : AnyShapeStyle(.secondary))
                            .lineLimit(2)
                    }
                }
                Spacer(minLength: 0)
                if runnerBusy == runner.id { ProgressView() }
            }
        }
        .modifier(SidebarRowContent(enabled: embedded))
        .foregroundStyle(.primary)
        .disabled(runner.threadId == nil)
        .swipeActions(edge: .trailing) {
            Button { act(runner) { try await $0.setRunnerPaused(runner.id, paused: !runner.paused, botId: botId) } } label: {
                Label(runner.paused ? "Resume" : "Pause", systemImage: runner.paused ? "play" : "pause")
            }
            .tint(.orange)
            if !runner.paused {
                Button { act(runner) { try await $0.runRunnerNow(runner.id, botId: botId) } } label: {
                    Label("Run now", systemImage: "play.fill")
                }
                .tint(.green)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(runner.name), \(runner.urgent == true ? "Needs you" : runner.paused ? "Paused" : "Active"), \(runner.subtitle())")
        .accessibilityValue(runner.lastReport ?? "")
        .accessibilityAddTraits(.isButton)
        .accessibilityActions {
            Button(runner.paused ? "Resume" : "Pause") { act(runner) { try await $0.setRunnerPaused(runner.id, paused: !runner.paused, botId: botId) } }
            if !runner.paused { Button("Run now") { act(runner) { try await $0.runRunnerNow(runner.id, botId: botId) } } }
        }
    }

    private func recurringRow(_ item: BotActivity.Scheduled) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "repeat")
                .font(.caption)
                .foregroundStyle(item.enabled ? AnyShapeStyle(.secondary) : AnyShapeStyle(.tertiary))
            Text(item.name).lineLimit(1).foregroundStyle(item.enabled ? AnyShapeStyle(.primary) : AnyShapeStyle(.secondary))
            Spacer(minLength: 8)
            Text(item.enabled ? item.nextRunAt.map { BotRunner.when($0) } ?? "On" : "Off")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .modifier(SidebarRowContent(enabled: embedded))
        .accessibilityElement(children: .combine)
    }

    private func earlierRow(_ id: String) -> some View {
        Button { open(id) } label: {
            HStack(spacing: 10) {
                Image(systemName: "clock").font(.caption).foregroundStyle(.secondary)
                Text(chain.title(id)).lineLimit(1).foregroundStyle(.secondary)
                Spacer(minLength: 0)
            }
        }
        .modifier(SidebarRowContent(enabled: embedded))
        .foregroundStyle(.primary)
        .accessibilityHint("Opens an earlier conversation")
    }

    // MARK: Loading

    private func loadRunners() async {
        #if DEBUG
        if BotDemo.current != nil { runners = BotDemo.runners; return }
        #endif
        guard bot?.external != true, bot != nil else { runners = []; return }
        if let next = try? await app.client.botRunners(botId: botId), next != runners { runners = next }
    }

    private func loadChain() async {
        #if DEBUG
        if BotDemo.current != nil { return }
        #endif
        guard bot?.lead.threadId != nil else { return }
        if let next = try? await app.client.botChainThreads(botId: botId), next != chain { chain = next }
    }

    private func openRunner(_ runner: BotRunner) {
        guard let threadId = runner.threadId else { return }
        if runner.urgent == true {
            let client = app.client
            let botId = botId
            Task {
                try? await client.markRunnerSeen(runner.id, botId: botId)
                await refresh()
            }
        }
        open(threadId)
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
}

/// A small status dot: filled, or a ring for waiting and paused. No animation.
private struct BotStatusDot: View {
    var color: Color
    var hollow = false

    init(color: Color, hollow: Bool = false) {
        self.color = color
        self.hollow = hollow
    }

    init(tone: BotThreadTone) {
        switch tone {
        case .needs: self.init(color: .orange)
        case .running: self.init(color: .green)
        case .waiting: self.init(color: .secondary, hollow: true)
        case .failed: self.init(color: .red)
        case .idle: self.init(color: .secondary.opacity(0.5))
        }
    }

    var body: some View {
        Group {
            if hollow {
                Circle().strokeBorder(color, lineWidth: 1.2)
            } else {
                Circle().fill(color)
            }
        }
        .frame(width: 8, height: 8)
        .accessibilityHidden(true)
    }
}
