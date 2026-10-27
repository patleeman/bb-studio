#if DEBUG
import SwiftUI
import WidgetKit

/// Debug builds: `-qaStateDemo dictation|related|studio-chat|widgets` opens that sheet with local
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
                widgets = StateDemo.variant == "widgets"
            }
            // Outermost, so the sheets above it get the app too.
            .environmentObject(AppModel.shared)
    }
}

/// `-qaStateDemo widgets`: the BB status widget's own view, small, medium and
/// Lock Screen, while the Bot asked you a question and two threads run.
/// WidgetKit can't be pointed at a fixture server safely here, so this draws
/// the widget's view in the app, in its sizes on a phone.
private struct WidgetsDemo: View {
    private var entry: StatusEntry {
        let now = Date().timeIntervalSince1970 * 1000
        let running = ["Lisbon offsite options", "Approve deploy to prod"].enumerated().map { index, title in
            try! JSONDecoder().decode(ThreadEntry.self, from: Data(#"{"id":"thr_w\#(index)","projectId":"p","title":"\#(title)","status":"active","createdAt":\#(now),"updatedAt":\#(now)}"#.utf8))
        }
        return StatusEntry(date: .now, needsYou: [], running: running, stale: false,
                           bot: .bot(count: 1, reason: "Asked you a question"))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack(spacing: 20) {
                tile(.systemSmall).frame(width: 170, height: 170)
                tile(.accessoryCircular).frame(width: 76, height: 76)
            }
            tile(.systemMedium).frame(width: 364, height: 170)
            tile(.accessoryRectangular).frame(width: 172, height: 76)
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(LinearGradient(colors: [Color(red: 0.12, green: 0.14, blue: 0.24), .black], startPoint: .top, endPoint: .bottom))
    }

    private func tile(_ family: WidgetFamily) -> some View {
        let lockScreen = family == .accessoryCircular || family == .accessoryRectangular
        return StatusWidgetView(entry: entry, family: family)
            // A widget's links don't take the app's accent colour.
            .tint(.primary)
            .padding(lockScreen ? 0 : 16)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(lockScreen ? AnyShapeStyle(.clear) : AnyShapeStyle(.thinMaterial), in: .rect(cornerRadius: 22))
            .accessibilityIdentifier("widget-\(family)")
    }
}
#endif
