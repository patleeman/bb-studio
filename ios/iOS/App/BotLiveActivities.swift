import ActivityKit
import Combine
import Foundation
import UIKit
import WidgetKit

/// Each Bot's Live Activity, from the app's side. While the app is open it
/// starts, updates and ends them from `bot_spaces` and `bot_threads_view`.
/// It registers the push-to-start token and each activity's update token with
/// the Mobile relay, so Studio can drive them while the app is closed
/// (`docs/live-activity-server.md`). It also redraws the widgets when what they
/// show about a Bot changes.
@MainActor
final class BotLiveActivities {
    static let shared = BotLiveActivities()

    private var store: BotSpacesStore?
    private var client: BBClient?
    private var subscriptions: Set<AnyCancellable> = []
    private var syncTask: Task<Void, Never>?
    private var tokenTasks: [String: Task<Void, Never>] = [:]
    private var startTokenTask: Task<Void, Never>?
    private var updatesTask: Task<Void, Never>?
    private var pushToStartToken: String?
    private var registered: Set<String> = []
    private var widgetKey = ""
    /// Whether this process may talk to the relay (not in tests or QA runs).
    private let registers = PushRegistration.allowed(arguments: CommandLine.arguments, environment: ProcessInfo.processInfo.environment)

    var deviceId: String? { UIDevice.current.identifierForVendor?.uuidString }

    func attach(store: BotSpacesStore, client: BBClient) {
        guard store !== self.store || client.baseURL != self.client?.baseURL else { return }
        self.store = store
        self.client = client
        registered = []
        subscriptions = []
        store.$spaces.combineLatest(store.$views)
            .debounce(for: .milliseconds(400), scheduler: RunLoop.main)
            .sink { [weak self] _, _ in self?.scheduleSync() }
            .store(in: &subscriptions)
        observeTokens()
    }

    private var server: String? { client.map { ServerScope.namespace($0.baseURL) } }

    private func scheduleSync() {
        syncTask?.cancel()
        syncTask = Task { [weak self] in await self?.sync() }
    }

    /// Brings every Bot's activity in line with what the app knows.
    func sync() async {
        guard let store, let spaces = store.spaces, let server, let client else { return }
        reloadWidgetsIfChanged(spaces, views: store.views)
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        for bot in spaces.bots {
            if Task.isCancelled { return }
            let view = store.view(for: bot.id)
            var state = BotActivityAttributes.ContentState.make(bot: bot, view: view)
            if state?.presence == .needs, let conversationId = state?.conversationId {
                let approval = (try? await client.conversationApprovals(threadId: conversationId))?
                    .first { $0.state == .pending }
                    .map { BotActivityAttributes.Approval($0) }
                if let approval { state = .make(bot: bot, view: view, approval: approval) }
            }
            let running = Activity<BotActivityAttributes>.activities.filter {
                $0.attributes.botId == bot.id && $0.attributes.belongs(to: server) && $0.activityState == .active
            }
            guard let state else {
                for activity in running {
                    await activity.end(ActivityContent(state: activity.content.state, staleDate: nil), dismissalPolicy: .immediate)
                }
                continue
            }
            if let activity = running.first {
                if state.differs(from: activity.content.state) {
                    await activity.update(ActivityContent(state: state, staleDate: .now + 30 * 60))
                }
                for extra in running.dropFirst() { await extra.end(nil, dismissalPolicy: .immediate) }
            } else if UIApplication.shared.applicationState == .active {
                let attributes = BotActivityAttributes(botId: bot.id, botName: bot.name, server: server)
                let content = ActivityContent(state: state, staleDate: Date.now + 30 * 60)
                let pushType: PushType? = registers ? .token : nil
                if let activity = try? Activity.request(attributes: attributes, content: content, pushType: pushType) {
                    watchUpdateToken(activity)
                }
            }
        }
        // Activities for Bots that are gone, or for another server.
        let known = Set(spaces.bots.map(\.id))
        for activity in Activity<BotActivityAttributes>.activities where !activity.attributes.belongs(to: server) || !known.contains(activity.attributes.botId) {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
        registerPushToStart(for: spaces)
    }

    // MARK: Tokens

    private func observeTokens() {
        for activity in Activity<BotActivityAttributes>.activities { watchUpdateToken(activity) }
        guard registers else { return }
        updatesTask?.cancel()
        // Activities Studio started by push while the app was closed.
        updatesTask = Task { [weak self] in
            for await activity in Activity<BotActivityAttributes>.activityUpdates {
                self?.watchUpdateToken(activity)
            }
        }
        startTokenTask?.cancel()
        startTokenTask = Task { [weak self] in
            for await data in Activity<BotActivityAttributes>.pushToStartTokenUpdates {
                guard let self else { return }
                self.pushToStartToken = data.hex
                self.registered = self.registered.filter { !$0.hasPrefix("start:") }
                if let spaces = self.store?.spaces { self.registerPushToStart(for: spaces) }
            }
        }
    }

    private func watchUpdateToken(_ activity: Activity<BotActivityAttributes>) {
        guard registers, tokenTasks[activity.id] == nil else { return }
        let botId = activity.attributes.botId
        let server = activity.attributes.server
        tokenTasks[activity.id] = Task { [weak self] in
            for await data in activity.pushTokenUpdates {
                await self?.register(botId: botId, kind: .update, token: data.hex, server: server)
            }
        }
    }

    /// Registers this phone's push-to-start token for every Bot, once per launch.
    private func registerPushToStart(for spaces: BotSpaces) {
        guard registers, let token = pushToStartToken, let server else { return }
        for bot in spaces.bots where registered.insert("start:\(bot.id):\(token)").inserted {
            Task { await register(botId: bot.id, kind: .push_to_start, token: token, server: server) }
        }
    }

    private func register(botId: String, kind: Mobile.LiveActivityRegisterInputKind, token: String, server: String) async {
        guard let client, server.isEmpty || ServerScope.namespace(client.baseURL) == server, let deviceId else { return }
        do {
            try await client.registerLiveActivity(deviceId: deviceId, botId: botId, kind: kind, token: token)
        } catch {
            if kind == .push_to_start { registered.remove("start:\(botId):\(token)") }
        }
    }

    // MARK: Widgets

    /// The Bot widgets show presence, needs-you and workers: redraw them when those change.
    private func reloadWidgetsIfChanged(_ spaces: BotSpaces, views: [String: BotThreadsView]) {
        let key = spaces.bots.map { bot in
            let view = views[bot.id]
            let state = bot.presenceState(live: view)
            let latest = view.flatMap(BotActivityAttributes.ContentState.conversation)?.latest ?? ""
            return "\(bot.id):\(state.rawValue):\(bot.activity.workers):\(latest.hashValue)"
        }.joined(separator: ",")
        guard key != widgetKey else { return }
        let first = widgetKey.isEmpty
        widgetKey = key
        if !first { WidgetCenter.shared.reloadAllTimelines() }
    }
}

extension BotActivityAttributes.Approval {
    init(_ approval: WorkerApproval) {
        let what = approval.short.isEmpty ? approval.title : approval.short
        self.init(workerThreadId: approval.worker.threadId, interactionId: approval.interactionId,
                  summary: String("\(approval.worker.title): \(what)".prefix(140)),
                  canApprove: approval.decisions.contains(.allowOnce), canDeny: approval.decisions.contains(.deny))
    }
}

private extension Data {
    var hex: String { map { String(format: "%02x", $0) }.joined() }
}
