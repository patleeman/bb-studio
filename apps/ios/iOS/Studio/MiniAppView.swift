import SwiftUI
import WebKit

/// A Studio mini app, live and interactive. Its frame runs in a WKWebView, and
/// the phone is its host, as mini-frame.tsx is on the desktop: it answers the
/// frame's record calls through Studio's RPC, saves its shared state, and
/// passes on other copies' changes. Network, BB access, sending to the agent
/// and approving access stay on the desktop.
struct MiniAppView: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.colorScheme) private var colorScheme
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }
    let id: String
    @State private var session: MiniSession?
    @State private var showingWeb = false
    @State private var showingRelated = false

    var body: some View {
        Group {
            if let session, let mini = session.mini {
                content(mini, session: session)
            } else if session?.missing == true {
                ContentUnavailableView("Mini app not found", systemImage: StudioKind.of("mini").symbol,
                    description: Text("It may have been deleted."))
            } else if let error = session?.error {
                ContentUnavailableView("Couldn't open mini app", systemImage: StudioKind.of("mini").symbol, description: Text(error))
            } else {
                ProgressView()
            }
        }
        .navigationTitle(session?.mini?.displayName ?? "Mini app")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            Menu {
                Button { showingWeb = true } label: { Label("Edit on Desktop or BB Web", systemImage: "safari") }
                Button { showingRelated = true } label: { Label("Related", systemImage: "link") }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .accessibilityLabel("Mini app options")
        }
        .sheet(isPresented: $showingRelated) { RelatedView(pluginId: "minis", itemId: id) }
        .sheet(isPresented: $showingWeb) {
            NavigationStack {
                WebView(url: client.baseURL.appending(path: "plugins/studio/studio/minis/\(id)"))
                    .ignoresSafeArea(edges: .bottom)
                    .navigationTitle(session?.mini?.displayName ?? "Mini app")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar { Button("Done") { showingWeb = false } }
            }
        }
        .task(id: id) {
            let session = self.session ?? MiniSession(client: client, id: id)
            self.session = session
            await session.start(app)
        }
        .onDisappear { session?.stop() }
        .accessibilityIdentifier("miniAppView")
    }

    @ViewBuilder
    private func content(_ mini: MiniApp, session: MiniSession) -> some View {
        VStack(spacing: 0) {
            MiniStrips(mini: mini, appError: session.appError)
            if let versionId = mini.versionId {
                MiniFrameView(host: session.host, versionId: versionId, granted: mini.granted, dark: colorScheme == .dark)
                    .accessibilityLabel(mini.displayName)
            } else {
                ContentUnavailableView("No source yet", systemImage: StudioKind.of("mini").symbol,
                    description: Text("This mini app has no source yet. Ask an agent to build it."))
            }
        }
        .background(Color(.systemBackground))
    }
}

/// One mini app on screen, full screen or in a reply card: what it is, kept
/// current from Studio's `minis` signal, and its host, which that signal's
/// state, record changes and agent commands go to while it runs.
@MainActor
@Observable
final class MiniSession {
    let id: String
    let client: BBClient
    let host: MiniHost
    private(set) var mini: MiniApp?
    private(set) var missing = false
    private(set) var error: String?
    /// What the app's own code last threw, from its frame.
    private(set) var appError: String?
    /// The frame's content height, once it has measured itself.
    private(set) var contentHeight: Double?
    @ObservationIgnored private weak var realtime: BBRealtime?
    @ObservationIgnored private var listener: UUID?
    @ObservationIgnored private var loads = 0
    @ObservationIgnored private var changeReload: Task<Void, Never>?

    init(client: BBClient, id: String) {
        self.client = client
        self.id = id
        host = MiniHost(client: client, miniId: id)
    }

    /// Listens for changes and loads the mini app. The frame opens its copy
    /// on the server when `MiniFrameView` shows it, and closes it when it goes.
    func start(_ app: AppModel) async {
        let model = app
        host.onNotice = { [weak model] message in model?.flash(message) }
        host.onError = { [weak self] message in self?.appError = message }
        host.onSize = { [weak self] height in
            guard let self, height != contentHeight else { return }
            contentHeight = height
        }
        if let listener { realtime?.removeListener(listener) }
        realtime = app.realtime
        let id = id, clientId = host.clientId
        listener = app.realtime.listen { [weak self] event in
            guard let self else { return }
            switch event {
            // Studio publishes state, record changes and edits on its `minis` channel.
            case .pluginSignal("studio", "minis", let payload):
                switch MiniRelay.event(payload, miniId: id, clientId: clientId) {
                case .post(let message)?: host.post(message)
                case .reload?: Task { await self.load() }
                case .changed?: reloadSoon()
                case nil: break
                }
            case .connected:
                Task { await self.load() }
            default: break
            }
        }
        await load()
    }

    /// Stops listening. The frame, if it shows, keeps its copy until it goes.
    func stop() {
        if let listener { realtime?.removeListener(listener) }
        listener = nil
        changeReload?.cancel()
        changeReload = nil
    }

    /// Record writes also say "changed"; a burst of them loads once.
    private func reloadSoon() {
        changeReload?.cancel()
        changeReload = Task {
            try? await Task.sleep(for: .milliseconds(800))
            guard !Task.isCancelled else { return }
            await load()
        }
    }

    func load() async {
        loads += 1
        let load = loads
        do {
            let found = try await client.mini(id)
            guard load == loads else { return }
            if let found {
                if found != mini { mini = found }
                missing = false
                error = nil
            } else {
                missing = true
            }
        } catch {
            guard load == loads else { return }
            if mini == nil { self.error = BBClient.describe(error, server: client.baseURL) }
        }
    }
}

/// The strips over the app: its access request and its last error.
struct MiniStrips: View {
    let mini: MiniApp
    let appError: String?

    var body: some View {
        if let access = mini.accessText {
            MiniStrip(symbol: "lock.shield", tint: .orange, text: access + " Approve it in BB on your computer.")
                .accessibilityIdentifier("miniAccessBanner")
        }
        if let appError {
            MiniStrip(symbol: "exclamationmark.triangle", tint: .red,
                text: "The app hit an error. " + (appError.split(separator: "\n").first.map(String.init) ?? ""))
        }
    }
}

/// A slim strip over the app: its access request or its last error.
private struct MiniStrip: View {
    let symbol: String
    let tint: Color
    let text: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: symbol).foregroundStyle(tint)
            Text(text).font(.footnote).frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(tint.opacity(0.12))
    }
}

// MARK: The frame

/// The web view that shows the frame. A small host page holds the frame in a
/// sandboxed iframe, as the desktop's page does; the host's bridge relays only
/// that iframe's messages.
struct MiniFrameView: UIViewRepresentable {
    let host: MiniHost
    let versionId: String
    let granted: [String]
    let dark: Bool

    func makeUIView(context: Context) -> WKWebView {
        let view = host.makeWebView()
        host.show(versionId: versionId, granted: granted, dark: dark)
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        host.show(versionId: versionId, granted: granted, dark: dark)
    }

    static func dismantleUIView(_ view: WKWebView, coordinator: ()) {
        MainActor.assumeIsolated {
            (view.navigationDelegate as? MiniHost)?.close()
        }
    }
}

/// One open copy of a mini app: the web view, the relay, and the
/// `minis.live.*` presence the server counts for approvals and agent actions.
@MainActor
final class MiniHost: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    let client: BBClient
    let miniId: String
    /// This copy, for the server: which writes were ours, and where agent commands go.
    let clientId = UUID().uuidString.lowercased()
    var onNotice: ((String) -> Void)?
    var onError: ((String?) -> Void)?
    /// The frame's content height, for cards that fit it.
    var onSize: ((Double) -> Void)?
    private weak var view: WKWebView?
    private var shown: String?
    private var dark = false
    private var actions: [String] = []
    private var touched = Date.distantPast
    private var heartbeat: Task<Void, Never>?
    private var crashes: [Date] = []

    init(client: BBClient, miniId: String) {
        self.client = client
        self.miniId = miniId
    }

    /// Relays the iframe's `bb-mini` messages, and only its own: `event.source`
    /// must be the iframe's window. It runs in the app's content world, so the
    /// frame's scripts can't reach the handler or post replies themselves.
    private static let bridge = """
        (function () {
          var frame = function () { return document.getElementById("mini"); };
          addEventListener("message", function (event) {
            var f = frame();
            if (!f || event.source !== f.contentWindow) return;
            var d = event.data;
            if (!d || typeof d !== "object" || d.type !== "\(MiniRelay.message)") return;
            var text;
            try { text = JSON.stringify(d); } catch (e) { return; }
            if (typeof text === "string") webkit.messageHandlers.bbMini.postMessage(text);
          });
          window.__bbMiniPost = function (message) {
            var f = frame();
            if (f && f.contentWindow) f.contentWindow.postMessage(message, "*");
          };
        })();
        """

    func makeWebView() -> WKWebView {
        if let view { return view }
        let configuration = WKWebViewConfiguration()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.allowsInlineMediaPlayback = true
        let world = WKContentWorld.defaultClient
        configuration.userContentController.addUserScript(
            WKUserScript(source: Self.bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: world))
        configuration.userContentController.add(self, contentWorld: world, name: "bbMini")
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.isOpaque = false
        view.backgroundColor = .clear
        // The frame scrolls itself; the host page fills the screen.
        view.scrollView.isScrollEnabled = false
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.scrollView.bounces = false
        view.allowsLinkPreview = false
        view.navigationDelegate = self
        view.uiDelegate = self
        self.view = view
        return view
    }

    /// Loads the version, again only when it or the grants change; a new theme is posted instead.
    func show(versionId: String, granted: [String], dark: Bool) {
        let key = versionId + "|" + granted.joined(separator: ",")
        if key != shown {
            shown = key
            self.dark = dark
            open()
            load(versionId: versionId)
        } else if dark != self.dark {
            self.dark = dark
            post(MiniRelay.theme(dark: dark))
        }
    }

    private func load(versionId: String) {
        guard let view else { return }
        let frame = MiniRelay.relative(client.miniFrameURL(miniId, versionId: versionId, dark: dark))
        view.loadHTMLString(MiniRelay.hostDocument(frame: frame, dark: dark), baseURL: client.baseURL)
    }

    /// Tells the server this copy is open, and keeps telling it while it stays open.
    private func open() {
        guard heartbeat == nil else { return }
        live(Studio.Method.minis_live_open, ["actions": .array([])])
        heartbeat = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: MiniRelay.heartbeat)
                guard !Task.isCancelled, let self else { return }
                self.live(Studio.Method.minis_live_open, ["actions": .array(self.actions.map(OrderedJSON.string))])
            }
        }
    }

    /// The screen went away: the server stops counting this copy.
    func close() {
        guard heartbeat != nil || view != nil else { return }
        heartbeat?.cancel()
        heartbeat = nil
        shown = nil
        crashes = []
        if let view {
            view.configuration.userContentController.removeAllScriptMessageHandlers()
            view.navigationDelegate = nil
            view.uiDelegate = nil
            view.stopLoading()
        }
        view = nil
        let client = client, input = Self.input(miniId: miniId, clientId: clientId, [:])
        Task { let _: OrderedJSON? = try? await client.rpc("studio", Studio.Method.minis_live_close, ordered: input) }
    }

    /// Posts a message into the frame.
    func post(_ message: OrderedJSON) {
        view?.evaluateJavaScript("window.__bbMiniPost && window.__bbMiniPost(\(message.jsonText)); void 0", in: nil, in: .defaultClient)
    }

    // MARK: Messages from the frame

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "bbMini", message.frameInfo.isMainFrame, let text = message.body as? String,
              let json = try? OrderedJSON.parse(Data(text.utf8)), json["type"]?.string == MiniRelay.message
        else { return }
        receive(json)
    }

    private func receive(_ message: OrderedJSON) {
        switch message["op"]?.string {
        case "ready":
            onError?(nil)
            post(MiniRelay.theme(dark: dark))
        case "call":
            answer(message)
        case "save":
            let client = client, input = Self.input(miniId: miniId, clientId: clientId, ["state": message["state"] ?? .null])
            Task { [weak self] in
                do {
                    let _: OrderedJSON = try await client.rpc("studio", Studio.Method.minis_live_save, ordered: input)
                } catch {
                    self?.onNotice?("Couldn't save: \(Self.text(error))")
                }
            }
        case "emit":
            let input: OrderedJSON = .object([
                .init("id", .string(miniId)), .init("name", .string(MiniRelay.jsString(message["name"]))), .init("data", message["data"] ?? .null),
            ])
            let client = client
            Task { let _: OrderedJSON? = try? await client.rpc("studio", Studio.Method.minis_live_emit, ordered: input) }
        case "expose":
            actions = Array((message["actions"]?.array ?? []).compactMap(\.string).prefix(100))
            live(Studio.Method.minis_live_open, ["actions": .array(actions.map(OrderedJSON.string))])
        case "touch":
            guard Date().timeIntervalSince(touched) >= MiniRelay.touchEvery else { return }
            touched = Date()
            live(Studio.Method.minis_live_touch, [:])
        case "result":
            let client = client, input = MiniRelay.result(message, clientId: clientId)
            Task { let _: OrderedJSON? = try? await client.rpc("studio", Studio.Method.minis_live_result, ordered: input) }
        case "send":
            onNotice?(MiniRelay.sendRefused)
        case "error":
            onError?(MiniRelay.jsString(message["message"]))
        case "size":
            if let height = MiniRelay.size(message) { onSize?(height) }
        default:
            break
        }
    }

    private func answer(_ message: OrderedJSON) {
        let id = message["id"] ?? .null
        let method = message["method"]?.string ?? ""
        switch MiniRelay.call(method, params: message["params"] ?? .object([]), miniId: miniId, clientId: clientId) {
        case .success(let call):
            let client = client
            Task { [weak self] in
                do {
                    let result: OrderedJSON = try await client.rpc("studio", call.method, ordered: call.input)
                    self?.post(MiniRelay.reply(id, value: call.pick.map { result[$0] ?? .null } ?? result))
                } catch {
                    self?.post(MiniRelay.reply(id, error: Self.text(error)))
                }
            }
        case .failure(let refusal):
            post(MiniRelay.reply(id, error: refusal.message))
        }
    }

    /// A `minis.live.*` call for this copy, whose answer doesn't matter.
    private func live(_ method: String, _ extra: [String: OrderedJSON]) {
        let client = client, input = Self.input(miniId: miniId, clientId: clientId, extra)
        Task { let _: OrderedJSON? = try? await client.rpc("studio", method, ordered: input) }
    }

    private static func input(miniId: String, clientId: String, _ extra: [String: OrderedJSON]) -> OrderedJSON {
        .object([.init("id", .string(miniId)), .init("clientId", .string(clientId))] + extra.sorted { $0.key < $1.key }.map { .init($0.key, $0.value) })
    }

    private static func text(_ error: Error) -> String {
        (error as? BBError)?.message ?? BBClient.describe(error)
    }

    // MARK: Navigation

    /// Only the host page and this mini app's frame load. The frame can't
    /// navigate anywhere else, and links don't open windows.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let allowed = MiniRelay.allows(action.request.url, mainFrame: action.targetFrame?.isMainFrame ?? true, server: client.baseURL, miniId: miniId)
        decisionHandler(allowed ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // Load it again from the start, as a fresh copy, unless it keeps dying.
        guard let shown, let versionId = shown.split(separator: "|", omittingEmptySubsequences: false).first else { return }
        let (reload, recent) = MiniRelay.reloadAfterCrash(crashes, now: Date())
        crashes = recent
        guard reload else {
            onError?("It stopped responding. Open it again to retry.")
            return
        }
        load(versionId: String(versionId))
    }
}
