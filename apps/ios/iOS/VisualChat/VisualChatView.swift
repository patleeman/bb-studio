import SafariServices
import SwiftUI

/// Visual Chat's chats (canvas.list), most recent first, and New chat.
struct VisualChatListView: View {
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }
    @State private var chats: [VisualChat.CanvasListOutputCanvasesItem] = []
    @State private var loaded = false
    @State private var error: String?

    var body: some View {
        List {
            Section {
                NavigationLink(value: Route.visualChat(threadId: nil)) {
                    Label("New chat", systemImage: "plus.bubble")
                }
                .accessibilityIdentifier("visualChatNew")
            }
            if let error {
                Section { Text(error).font(.footnote).foregroundStyle(.secondary) }
            }
            if !chats.isEmpty {
                Section("Chats") {
                    ForEach(chats, id: \.id) { chat in
                        if let threadId = chat.threadId {
                            NavigationLink(value: Route.visualChat(threadId: threadId)) { row(chat) }
                                .accessibilityIdentifier("visualChatRow")
                        }
                    }
                }
            }
        }
        .overlay {
            if loaded, chats.isEmpty, error == nil {
                ContentUnavailableView("No visual chats yet", systemImage: "rectangle.3.group.bubble",
                                       description: Text("Ask anything. The agent answers on a board it designs each turn."))
            }
        }
        .navigationTitle("Visual Chat")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink(value: Route.visualChat(threadId: nil)) { Image(systemName: "square.and.pencil") }
                    .accessibilityLabel("New chat")
            }
        }
        .refreshable { await load() }
        .task(id: app.serverURL) { await load() }
        .onReceive(NotificationCenter.default.publisher(for: VisualChatScreen.changed)) { _ in Task { await load() } }
    }

    private func row(_ chat: VisualChat.CanvasListOutputCanvasesItem) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(chat.title ?? "Visual chat").lineLimit(2)
            if let updated = chat.updatedAt {
                Text(Date(timeIntervalSince1970: updated / 1000), style: .relative)
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }

    private func load() async {
        do {
            let output: VisualChat.CanvasListOutput = try await client.rpc(VisualChatPlugin.id, VisualChat.Method.canvas_list)
            operation.complete(on: app) {
                chats = output.canvases ?? []
                error = nil
            }
        } catch where BBClient.isCancellation(error) {
        } catch {
            operation.complete(on: app) { self.error = BBClient.describe(error, server: client.baseURL) }
        }
        loaded = true
    }
}

/// One Visual Chat: the board fills the screen, and the chat line sits at its
/// bottom edge: the caption (two lines), ‹ › through the versions, the field,
/// Talk's dictation and Send. Hands-free voice is for a later version.
struct VisualChatScreen: View {
    static let changed = Notification.Name("VisualChatChanged")

    @EnvironmentObject private var app: AppModel
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dismiss) private var dismiss
    /// The folded Duo's outer screen: iOS puts a navigation bar's buttons in a column at the right edge there,
    /// so this screen hides the bar and draws its own header row (back beside the title), as on an iPhone.
    private let folded = FoldedChrome.foldedDuo
    @State private var geometry = ""
    @StateObject private var model: VisualChatModel
    @State private var host: VisualChatBoardHost?
    @State private var text = ""
    @State private var opening: OpenedURL?
    @State private var dictating = false
    @State private var boardSize: CGSize = .zero
    @State private var rendered = "loading"
    @FocusState private var focused: Bool

    init(threadId: String?) {
        _model = StateObject(wrappedValue: VisualChatModel(client: AppModel.shared.client, threadId: threadId))
    }

    var body: some View {
        VStack(spacing: 0) {
            if folded { foldedHeader }
            board
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background { GeometryReader { proxy in Color.clear.onAppear { boardSize = proxy.size }.onChange(of: proxy.size) { boardSize = $1 } } }
            chatLine
        }
        .background(Color(.systemBackground))
        .navigationTitle(model.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(folded ? .hidden : .automatic, for: .navigationBar)
        .background { GeometryReader { _ in Color.clear.onAppear(perform: measureWindow) } }
        .toolbar(.hidden, for: .tabBar)
        .task {
            model.attach(app.realtime)
            await model.loadRenderer()
            await model.load()
        }
        .onDisappear {
            model.detach()
            NotificationCenter.default.post(name: Self.changed, object: nil)
        }
        .onChange(of: model.renderer) { _, renderer in makeHost(renderer) }
        .sheet(item: $opening) { SafariView(url: $0.url).ignoresSafeArea() }
        .sheet(isPresented: $dictating) {
            DictationView(threadId: nil, autoStart: true, insertLabel: ("Insert", "text.insert")) { spoken in
                let words = spoken.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !words.isEmpty else { return }
                text = text.trimmingCharacters(in: .whitespaces).isEmpty ? words : text.trimmingCharacters(in: .whitespaces) + " " + words
            }
        }
    }

    /// The folded Duo's header: back beside the title, inside the safe area, nothing over the board.
    private var foldedHeader: some View {
        HStack(spacing: 10) {
            Button { dismiss() } label: {
                Image(systemName: "chevron.left").font(.system(size: 17, weight: .semibold)).frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.interactive(), in: .circle)
            .accessibilityLabel("Back")
            .accessibilityIdentifier("visualChatHeaderBack")
            Text(model.title)
                .font(.headline)
                .lineLimit(1)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("visualChatHeaderTitle")
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 4)
    }

    /// For UI tests and stills: the window's real safe area and size, and the screen's.
    private func measureWindow() {
        guard let window = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).flatMap(\.windows).first(where: \.isKeyWindow) else { return }
        let inset = window.safeAreaInsets
        let screen = window.windowScene?.screen.bounds.size ?? .zero
        geometry = String(format: "window %.0fx%.0f screen %.0fx%.0f safe top %.0f left %.0f bottom %.0f right %.0f folded %@",
                          window.bounds.width, window.bounds.height, screen.width, screen.height,
                          inset.top, inset.left, inset.bottom, inset.right, folded ? "yes" : "no")
    }

    // MARK: The board

    @ViewBuilder private var board: some View {
        ZStack {
            if let host, !model.isItemsBoard {
                VisualChatBoardView(host: host, state: boardState)
                    .opacity(model.page == nil && model.livestream == nil ? 0 : 1)
                    .accessibilityIdentifier("visualChatBoard")
            }
            if model.isItemsBoard {
                note("This board is from before pages. Open it in BB on your computer.")
            } else if model.renderer == nil, model.error == nil {
                ProgressView()
            } else if model.page == nil, model.livestream == nil, model.error == nil {
                if model.working {
                    VStack(spacing: 10) {
                        ProgressView()
                        Text("Thinking it through…").font(.subheadline).foregroundStyle(.secondary)
                    }
                } else if model.loaded {
                    note("Ask anything. The board fills in as we talk, and changes as the conversation does.")
                }
            }
            if let error = model.error, model.page == nil {
                note(error)
            }
            // For UI tests and stills: what the board's frame shows now.
            Text(rendered)
                .font(.system(size: 1))
                .foregroundStyle(.clear)
                .frame(width: 1, height: 1)
                .accessibilityIdentifier("visualChatBoardState")
                .accessibilityValue(geometry)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    private func note(_ text: String) -> some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: 320)
            .padding(24)
    }

    private var boardState: VisualChatBoardState {
        let traits = UITraitCollection(userInterfaceStyle: colorScheme == .dark ? .dark : .light)
        return VisualChatBoardState(
            html: model.page, stream: model.livestream?.html, streamN: model.livestream?.n ?? 0,
            rev: Int(model.canvas?.rev ?? 0), look: model.look, mode: VisualChatTheme.mode(traits), theme: VisualChatTheme.raw(traits))
    }

    private func makeHost(_ renderer: VisualChatRenderer?) {
        guard let renderer, host == nil else { return }
        let host = VisualChatBoardHost(renderer: renderer)
        host.onOpen = { url in opening = OpenedURL(url: url) }
        host.onWebpage = { [model] url in await model.webpage(url) }
        host.onRendered = { rev, streamN, streaming in
            rendered = streaming ? "streaming rev \(rev) step \(streamN)" : "page rev \(rev)"
        }
        host.onFailure = { message in model.error = message }
        self.host = host
    }

    // MARK: The chat line

    private var chatLine: some View {
        let timeline = model.timeline
        return VStack(alignment: .leading, spacing: 8) {
            if let caption = model.caption {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    if caption.asking, model.working { ProgressView().controlSize(.mini) }
                    Text(caption.text)
                        .font(.subheadline)
                        .foregroundStyle(caption.asking ? .secondary : .primary)
                        .lineLimit(2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .accessibilityIdentifier("visualChatCaption")
            }
            HStack(spacing: 8) {
                if let label = timeline.label {
                    HStack(spacing: 2) {
                        Button { model.step(-1) } label: { Image(systemName: "chevron.left").frame(width: 28, height: 36) }
                            .disabled(!timeline.canGoBack)
                            .accessibilityLabel("Previous version")
                            .accessibilityIdentifier("visualChatBack")
                        Text(label)
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                            .fixedSize()
                            .accessibilityIdentifier("visualChatVersion")
                        Button { model.step(1) } label: { Image(systemName: "chevron.right").frame(width: 28, height: 36) }
                            .disabled(!timeline.canGoForward)
                            .accessibilityLabel("Next version")
                            .accessibilityIdentifier("visualChatForward")
                    }
                }
                TextField(timeline.shown != nil ? "Continue from this version" : "Ask anything", text: $text, axis: .vertical)
                    .lineLimit(1...4)
                    .focused($focused)
                    .submitLabel(.send)
                    .onSubmit(send)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 20))
                    .accessibilityIdentifier("visualChatField")
                // Hands-free voice stays hidden in v1.
                Button { dictating = true } label: {
                    Image(systemName: "mic.fill").font(.body).frame(width: 36, height: 36)
                }
                .accessibilityLabel("Dictate")
                .accessibilityIdentifier("visualChatMic")
                Button(action: send) {
                    Image(systemName: "arrow.up.circle.fill").font(.system(size: 30))
                }
                .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.pending != nil)
                .accessibilityLabel("Send")
                .accessibilityIdentifier("visualChatSend")
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background(.bar)
        .overlay(alignment: .top) { Divider() }
    }

    private func send() {
        let message = text
        guard !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, model.pending == nil else { return }
        text = ""
        focused = false
        let hint = VisualChatClient.of(screen: Self.screenSize, phone: UIDevice.current.userInterfaceIdiom == .phone, board: boardSize)
        Task {
            if !(await model.send(message, client: hint)) { text = message }
        }
    }

    private static var screenSize: CGSize {
        var size = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.screen.bounds.size }.first ?? .zero
        #if DEBUG
        if let demo = DuoDemo.screenSize { size = demo }
        #endif
        return size
    }
}

private struct OpenedURL: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

/// "Open" from the board: the page in Safari's view, over the chat.
struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let configuration = SFSafariViewController.Configuration()
        configuration.entersReaderIfAvailable = false
        return SFSafariViewController(url: url, configuration: configuration)
    }

    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}
