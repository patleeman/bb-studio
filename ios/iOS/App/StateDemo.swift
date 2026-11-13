#if DEBUG
import SwiftUI
import WidgetKit

/// Debug builds: `-qaStateDemo dictation|related|studio-chat|widgets[-bot|-work]` opens that sheet with local
/// data, for screenshots of its states without a server. The app's client
/// answers from fixtures here; sends and replies fail as if BB were
/// unreachable. `-qaBotSheet skills` with `-qaBotDemo` gets its skills here too.
/// `-qaOutboxUnreadable` (see `Outbox.shared`) makes the outbox's file unreadable.
enum StateDemo {
    static let threadId = "thr_statedemo1"
    static let transcript = "Move the launch review to Thursday and ask Dana to send the pricing deck before then."

    static var variant: String? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: "-qaStateDemo"), arguments.indices.contains(index + 1) else { return nil }
        return arguments[index + 1]
    }

    /// Answers the app's requests from fixtures, once per launch.
    @MainActor static func install(_ model: AppModel) {
        guard variant != nil || BotDemo.sheet == "skills" else { return }
        BBClient.demoTransport = { method, path, _ in
            let rpc = "/api/v1/plugins/studio/rpc/"
            guard method == "POST", path.hasPrefix(rpc) else { throw URLError(.cannotConnectToHost) }
            switch String(path.dropFirst(rpc.count)) {
            case Studio.Method.links: return ok(links)
            case Studio.Method.itemThreads: return ok(#"{"threads":[{"threadId":"thr_launchrev1","role":"source","state":"Launch review"}]}"#)
            case Studio.Method.comments: return ok(comments)
            // The project's defaults fail (not RPC, so unreachable); the chat starts anyway.
            case Studio.Method.chat_start: return ok(#"{"threadId":"\#(BotDemo.threadId)"}"#)
            case Studio.Method.bot_skills: return ok(skills)
            case Studio.Method.bot_learning: return ok(learning)
            default: throw URLError(.cannotConnectToHost)
            }
        }
        if variant == "dictation" { model.sheet = .dictation(threadId: threadId, autoStart: false) }
    }

    private static func ok(_ result: String) -> (Int, Data) {
        (200, Data(#"{"ok":true,"result":\#(result)}"#.utf8))
    }

    private static var now: Double { Date().timeIntervalSince1970 * 1000 }

    private static let links = #"{"outgoing":[{"to":{"pluginId":"pages","id":"pg_pricing01"}}],"backlinks":[]}"#

    private static var comments: String {
        #"""
        {"comments":[
         {"id":"c1","parentId":null,"actor":{"kind":"user","name":"You"},"body":"Can we move the launch review to Thursday?","createdAt":\#(now - 7_200_000)},
         {"id":"c2","parentId":"c1","actor":{"kind":"agent","name":"Juniper"},"body":"Thursday at 2pm works for everyone on the invite.","createdAt":\#(now - 5_400_000)},
         {"id":"c3","parentId":null,"actor":{"kind":"user","name":"You"},"body":"The pricing table still shows last quarter's tiers.","createdAt":\#(now - 1_800_000)}
        ]}
        """#
    }

    private static var skills: String {
        #"""
        {"skills":[
         {"name":"weekly-digest","description":"Collects the week's merged PRs and open decisions into a Monday page.","updatedAt":\#(now - 86_400_000),"state":"active","pinned":true},
         {"name":"triage-inbox","description":"Sorts new threads by who is waiting and drafts the replies.","updatedAt":\#(now - 3 * 86_400_000),"state":"active"},
         {"name":"travel-budget","description":"Checks offsite costs against the budget sheet.","updatedAt":\#(now - 40 * 86_400_000),"state":"stale"},
         {"name":"old-standup","description":"Posted the daily standup.","updatedAt":\#(now - 120 * 86_400_000),"state":"archived"}
        ]}
        """#
    }

    private static var learning: String {
        #"{"enabled":true,"interval":10,"reviewing":false,"lastReview":{"at":\#(now - 7_200_000),"result":"Saved 1 skill"}}"#
    }
}

/// Opens the Related sheet for `-qaStateDemo related`.
struct StateDemoSheets: ViewModifier {
    @State private var related = false
    @State private var chat = false
    @State private var widgets = false

    func body(content: Content) -> some View {
        content
            .sheet(isPresented: $related) {
                RelatedView(pluginId: "pages", itemId: "pg_launch01").environmentObject(AppModel.shared)
            }
            .fullScreenCover(isPresented: $widgets) { WidgetsDemo() }
            .studioChat(isPresented: $chat, pluginId: "pages", itemId: "pg_launch01", title: "Launch plan", projectId: "proj_statedemo")
            .task {
                // Before anything it opens loads.
                StateDemo.install(AppModel.shared)
                StudioDemo.install()
                related = StateDemo.variant == "related"
                chat = StateDemo.variant == "studio-chat"
                widgets = StateDemo.variant?.hasPrefix("widgets") == true
                if VoiceLiveDemo.variant != nil { AppModel.shared.sheet = .handsFree() }
            }
            // Outermost, so the sheets above it get the app too.
            .environmentObject(AppModel.shared)
    }
}

/// `-qaStateDemo widgets`: the widgets' own views with local data. WidgetKit
/// can't be pointed at a fixture server safely here, so this draws each view in
/// the app at the home screen's sizes.
/// - `widgets` (or `widgets-status`): BB status small, medium, large and Lock Screen, while the Bot
///   asked you a question, two threads wait on you and one failed, and six run.
/// - `widgets-bot`: the Bot small, medium and large: a long reply, its chat and the threads it's on.
/// - `widgets-work`: BB work medium and large.
/// - `widgets-live`: the Bot Live Activity: lock screen, compact and expanded island (design 10e).
/// On an iPad, every variant shows all three widgets extra large.
/// `-qaWidgetState empty` draws them with nothing to show; `placeholder`, as
/// WidgetKit's redacted placeholder.
private struct WidgetsDemo: View {
    @Environment(\.colorScheme) private var colorScheme
    private let kind = StateDemo.variant.map { $0.replacingOccurrences(of: "widgets-", with: "") } ?? "status"
    private let state = UserDefaults.standard.string(forKey: "qaWidgetState")
    private var pad: Bool { UIDevice.current.userInterfaceIdiom == .pad }

    private var space: WidgetBot { WidgetBot(id: "bot_juniper", name: "Juniper", state: .needs, workers: 2, look: look) }
    private var status: StatusEntry {
        guard state != "empty" else { return .placeholder }
        var entry = StatusEntry.sample
        entry.space = space
        return entry
    }
    private var bot: BotEntry {
        if state == "empty" { return BotEntry(date: .now, threadId: "thr_bot", title: "Juniper", look: look) }
        var entry = BotEntry.sample
        entry.title = "Juniper"
        entry.look = look
        entry.botId = "bot_juniper"
        entry.presence = .working
        entry.workers = 2
        return entry
    }
    private var work: WorkEntry {
        guard state != "empty" else { return .placeholder }
        var entry = WorkEntry.sample
        entry.space = space
        return entry
    }
    private var look: BotLook { BotLook(shape: BotShape.default.rawValue, color: "#2ba59a", emoji: "🌿") }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if pad {
                    tile("status", .systemExtraLarge) { StatusWidgetView(entry: status, family: .systemExtraLarge) }
                    tile("bot", .systemExtraLarge) { BotWidgetView(entry: bot, family: .systemExtraLarge) }
                    tile("work", .systemExtraLarge) { WorkWidgetView(entry: work, family: .systemExtraLarge) }
                } else if kind == "bot" {
                    tile("bot", .systemSmall) { BotWidgetView(entry: bot, family: .systemSmall) }
                    tile("bot", .systemMedium) { BotWidgetView(entry: bot, family: .systemMedium) }
                    tile("bot", .systemLarge) { BotWidgetView(entry: bot, family: .systemLarge) }
                } else if kind == "live" {
                    LiveActivityDemo()
                } else if kind == "work" {
                    tile("work", .systemMedium) { WorkWidgetView(entry: work, family: .systemMedium) }
                    tile("work", .systemLarge) { WorkWidgetView(entry: work, family: .systemLarge) }
                } else {
                    HStack(alignment: .top, spacing: 20) {
                        tile("status", .systemSmall) { StatusWidgetView(entry: status, family: .systemSmall) }
                        VStack(alignment: .leading, spacing: 18) {
                            tile("status", .accessoryCircular) { StatusWidgetView(entry: status, family: .accessoryCircular) }
                            tile("status", .accessoryRectangular) { StatusWidgetView(entry: status, family: .accessoryRectangular) }
                        }
                    }
                    tile("status", .systemMedium) { StatusWidgetView(entry: status, family: .systemMedium) }
                    tile("status", .systemLarge) { StatusWidgetView(entry: status, family: .systemLarge) }
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity)
        }
        .background(LinearGradient(colors: colorScheme == .dark ? [Color(red: 0.12, green: 0.14, blue: 0.24), .black]
                                                                 : [Color(red: 0.78, green: 0.84, blue: 0.95), Color(red: 0.95, green: 0.93, blue: 0.9)],
                                   startPoint: .top, endPoint: .bottom))
    }

    /// The Bot Live Activity's views as the lock screen and the island draw them.
    private struct LiveActivityDemo: View {
        private let attributes = BotActivityAttributes(botId: "bot_juniper", botName: "Juniper", server: "demo")
        private var state: BotActivityAttributes.ContentState {
            BotActivityAttributes.ContentState(
                state: "needs", workers: 2, conversationId: "thr_main", conversationTitle: "Main",
                line: "Fable moved the bridge onto the Studio contract.", needsYou: "Push bb-studio-native to origin?",
                approval: .init(workerThreadId: "thr_w", interactionId: "int_1", summary: "git push origin bb-studio-native"),
                updatedAt: Date.now.timeIntervalSince1970)
        }

        var body: some View {
            VStack(alignment: .leading, spacing: 24) {
                BotActivityLockView(attributes: attributes, state: state)
                    .padding(.horizontal, 16).padding(.vertical, 14)
                    .frame(width: 370)
                    .background(Color.black.opacity(0.45), in: .rect(cornerRadius: 26))
                    .accessibilityIdentifier("live-lock")
                HStack(spacing: 0) {
                    BotActivityGlyph(botId: attributes.botId, state: state.presence, size: 22)
                    Spacer(minLength: 126)
                    Text("\(state.workers)").font(.callout.weight(.semibold)).foregroundStyle(BotActivityStyle.amber)
                }
                .padding(.horizontal, 12)
                .frame(width: 250, height: 37)
                .background(.black, in: .capsule)
                .frame(maxWidth: .infinity)
                .accessibilityIdentifier("live-compact")
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        BotActivityGlyph(botId: attributes.botId, state: state.presence, size: 28)
                        Text(attributes.botName).font(.headline)
                        Spacer()
                        BotActivityWorkers(count: state.workers)
                    }
                    BotActivityLine(state: state)
                    if let needs = state.needsYou { BotActivityNeeds(text: needs) }
                    if let approval = state.approval { BotActivityDecisions(attributes: attributes, state: state, approval: approval) }
                }
                .foregroundStyle(.white)
                .padding(20)
                .frame(width: 370)
                .background(.black, in: .rect(cornerRadius: 44))
                .accessibilityIdentifier("live-expanded")
            }
            .environment(\.colorScheme, .dark)
        }
    }

    /// The home screen's sizes: iPhone 17 Pro for the phone, the 13-inch iPad for extra large.
    private func size(_ family: WidgetFamily) -> CGSize {
        switch family {
        case .systemSmall: CGSize(width: 170, height: 170)
        case .systemMedium: CGSize(width: 364, height: 170)
        case .systemLarge: CGSize(width: 364, height: 382)
        case .systemExtraLarge: CGSize(width: 795, height: 379)
        case .accessoryCircular: CGSize(width: 76, height: 76)
        default: CGSize(width: 172, height: 76)
        }
    }

    private func tile(_ name: String, _ family: WidgetFamily, @ViewBuilder content: () -> some View) -> some View {
        let lockScreen = family == .accessoryCircular || family == .accessoryRectangular
        let size = size(family)
        return content()
            // A widget's links don't take the app's accent colour.
            .tint(.primary)
            .redacted(reason: state == "placeholder" ? .placeholder : [])
            .padding(lockScreen ? 0 : 16)
            .frame(width: size.width, height: size.height, alignment: .topLeading)
            .background(lockScreen ? AnyShapeStyle(.clear) : AnyShapeStyle(.thinMaterial), in: .rect(cornerRadius: 22))
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier(name == "status" ? "widget-\(family)" : "widget-\(name)-\(family)")
    }
}
#endif
