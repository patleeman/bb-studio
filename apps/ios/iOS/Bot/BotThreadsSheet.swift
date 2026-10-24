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
                    DuoHeader(sidebar: true) { Text(name).font(.title2.bold()) } actions: { EmptyView() }
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
        let state = BotRowState(tone, since: thread.runningSince)
        let age = BotAge.label(thread.updatedAt)
        return Button { open(thread.id) } label: {
            HStack(spacing: 10) {
                if depth > 0 {
                    Image(systemName: "arrow.turn.down.right")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                BotRowMark(state: state, providerId: thread.providerId)
                Text(thread.title.isEmpty ? "Untitled" : thread.title)
                    .lineLimit(1)
                    .foregroundStyle(tone == .idle ? AnyShapeStyle(.secondary) : AnyShapeStyle(.primary))
                Spacer(minLength: 8)
                BotRowTrailing(state: state, fallback: age)
            }
            .padding(.leading, CGFloat(max(depth - 1, 0)) * 16)
        }
        .modifier(SidebarRowContent(enabled: embedded))
        .foregroundStyle(.primary)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(thread.title), \(BotRowTrailing.spoken(state, tone: tone)), \(age)")
        .accessibilityHint(depth > 0 ? "Started by the thread above. Opens the thread" : "Opens the thread")
        .accessibilityAddTraits(.isButton)
    }

    private func runnerRow(_ runner: BotRunner) -> some View {
        Button { openRunner(runner) } label: {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                BotRowMark(state: runner.rowState, providerId: runner.providerId, dimmed: runner.rowState == .idle || runner.rowState == .paused)
                    .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 4 }
                VStack(alignment: .leading, spacing: 2) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(runner.name)
                            .lineLimit(1)
                            .foregroundStyle(runner.paused ? AnyShapeStyle(.secondary) : AnyShapeStyle(.primary))
                        Spacer(minLength: 0)
                        if runnerBusy != runner.id { BotRunnerTrailing(runner: runner) }
                    }
                    Text(runner.plainSchedule).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    if let report = runner.lastReport, !report.isEmpty {
                        Text(report)
                            .font(.caption)
                            .foregroundStyle(runner.urgent == true ? AnyShapeStyle(.orange) : AnyShapeStyle(.secondary))
                            .lineLimit(2)
                    }
                }
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
        .accessibilityLabel("\(runner.name), \(runner.spokenStatus()), \(runner.plainSchedule)")
        .accessibilityValue(runner.lastReport ?? "")
        .accessibilityAddTraits(.isButton)
        .accessibilityActions {
            Button(runner.paused ? "Resume" : "Pause") { act(runner) { try await $0.setRunnerPaused(runner.id, paused: !runner.paused, botId: botId) } }
            if !runner.paused { Button("Run now") { act(runner) { try await $0.runRunnerNow(runner.id, botId: botId) } } }
        }
    }

    private func recurringRow(_ item: BotActivity.Scheduled) -> some View {
        HStack(spacing: 10) {
            BotRowMark(state: item.enabled ? .idle : .paused, symbol: "repeat", dimmed: true)
            Text(item.name).lineLimit(1).foregroundStyle(item.enabled ? AnyShapeStyle(.primary) : AnyShapeStyle(.secondary))
            Spacer(minLength: 8)
            Text(item.enabled ? item.nextRunAt.map { "next \(BotRowTime.at($0))" } ?? "on" : "paused")
                .font(.caption)
                .monospacedDigit()
                .foregroundStyle(.secondary)
        }
        .modifier(SidebarRowContent(enabled: embedded))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(item.name), \(item.enabled ? item.nextRunAt.map { "Next run \(BotRowTime.at($0))" } ?? "On" : "Paused")")
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

/// A row's mark, the same as desktop's provider mark: a 16 pt box with an
/// 11 pt logo and a 1.5 pt ring for its state. Only a running row moves: a
/// 2 pt quarter arc turning every 1.6 s. Under Reduce Motion it stands still
/// as a full ring with a 6 pt live dot. Idle and paused runners are dimmed.
struct BotRowMark: View {
    var state: BotRowState
    /// Stands in for the provider's logo, which iOS doesn't have yet.
    /// Draws its provider's logo; unknown providers get `symbol`.
    var providerId: String? = nil
    var symbol = "sparkle"
    var dimmed = false
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion

    private static let running = Color.green
    private var reduceMotion: Bool {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-qaReduceMotion") { return true }
        #endif
        return systemReduceMotion
    }

    var body: some View {
        ZStack {
            if let logo = ProviderLogo(providerId) {
                logo.frame(width: 11, height: 11)
            } else {
                Image(systemName: symbol)
                    .font(.system(size: 9, weight: .semibold))
                    .frame(width: 11, height: 11)
            }
            ring
        }
        .frame(width: 16, height: 16)
        .opacity(dimmed ? 0.45 : 1)
        .grayscale(dimmed ? 1 : 0)
        .accessibilityHidden(true)
    }

    @ViewBuilder private var ring: some View {
        switch state {
        case .running:
            if reduceMotion {
                Circle().stroke(Self.running, lineWidth: 1.5).frame(width: 14.5, height: 14.5)
                Circle().fill(Self.running).frame(width: 6, height: 6)
                    .overlay(Circle().stroke(Color(uiColor: .systemBackground), lineWidth: 1))
                    .offset(x: 5.5, y: 5.5)
            } else {
                Circle().stroke(Self.running.opacity(0.25), lineWidth: 1.5).frame(width: 14.5, height: 14.5)
                TimelineView(.animation) { context in
                    let turn = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.6) / 1.6
                    Circle().trim(from: 0, to: 0.25)
                        .stroke(Self.running, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                        .frame(width: 14, height: 14)
                        .rotationEffect(.degrees(turn * 360))
                }
            }
        case .waiting:
            Circle().stroke(Color.orange, lineWidth: 1.5).frame(width: 14.5, height: 14.5)
        case .failed:
            Circle().stroke(Color.red, lineWidth: 1.5).frame(width: 14.5, height: 14.5)
        case .idle, .paused:
            Circle().stroke(Color.secondary.opacity(0.3), lineWidth: 1.5).frame(width: 14.5, height: 14.5)
        }
    }
}

/// An agent provider's logo: BB's own artwork (`/api/v1/system/providers/<id>/logo`),
/// bundled because it is SVG, drawn as a mask in the provider's `iconTint`, or
/// in the text colour when it has none, as desktop's `ProviderIcon` does.
struct ProviderLogo: View {
    private let asset: String
    private let tint: Color?

    /// Nil for a provider the app has no logo for.
    init?(_ providerId: String?) {
        guard let providerId, let tint = Self.known[providerId] else { return nil }
        asset = "ProviderLogos/\(providerId)"
        self.tint = tint
    }

    /// The providers with bundled artwork and their `strings.iconTint`.
    static let known: [String: Color?] = [
        "codex": nil,
        "claude-code": Color(red: 0xD9 / 255, green: 0x77 / 255, blue: 0x57 / 255),
        "pi": Color(red: 0x6D / 255, green: 0x5D / 255, blue: 0xFB / 255),
        "acp-opencode": Color(red: 0x25 / 255, green: 0x63 / 255, blue: 0xEB / 255),
    ]

    var body: some View {
        Image(asset)
            .renderingMode(.template)
            .resizable()
            .scaledToFit()
            .foregroundStyle(tint.map { AnyShapeStyle($0) } ?? AnyShapeStyle(.primary))
    }
}

/// A thread row's right-hand text: the elapsed time while it runs, "failed", or its age.
struct BotRowTrailing: View {
    var state: BotRowState
    var fallback: String

    var body: some View {
        Group {
            switch state {
            case .running(let since?):
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Text(BotRowTime.elapsed(since: since, now: context.date))
                }
            case .failed:
                Text("failed").foregroundStyle(.red)
            default:
                Text(fallback)
            }
        }
        .font(.caption)
        .monospacedDigit()
        .foregroundStyle(.secondary)
        .fixedSize()
    }

    static func spoken(_ state: BotRowState, tone: BotThreadTone) -> String {
        if case .running(let since?) = state { return BotRowTime.spokenElapsed(since: since) }
        return tone.label
    }
}

/// A runner row's right-hand text: elapsed while it runs, "paused", or
/// "next 5:15 PM · quiet" with a failed last run in red.
struct BotRunnerTrailing: View {
    var runner: BotRunner

    var body: some View {
        Group {
            if runner.urgent == true {
                Text(BotAge.label(runner.lastReportAt ?? runner.lastRunAt ?? Date().timeIntervalSince1970 * 1000))
            } else if runner.isRunning {
                if let since = runner.runningSince {
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        Text(BotRowTime.elapsed(since: since, now: context.date))
                    }
                } else {
                    Text("running")
                }
            } else {
                let status = runner.rowStatus()
                HStack(spacing: 0) {
                    if let next = status.next { Text(next) }
                    if let outcome = status.outcome {
                        Text(status.next == nil ? outcome : " · \(outcome)")
                            .foregroundStyle(outcome == "failed" ? AnyShapeStyle(.red) : AnyShapeStyle(.tertiary))
                    }
                }
            }
        }
        .font(.caption)
        .monospacedDigit()
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .fixedSize()
    }
}
