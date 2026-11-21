import SwiftUI
import WebKit

/// A Studio Design: its rounds, newest first, each a row of live screens.
/// Tapping a screen plays it full screen; comments and edits stay with the
/// design's thread and BB web, where elements can be picked.
struct DesignView: View {
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }
    let id: String
    @State private var design: StudioDesign?
    @State private var missing = false
    @State private var error: String?
    @State private var playing: DesignScreen?
    @State private var showingRelated = false
    @State private var chatting = false
    @State private var showingWeb = false
    @State private var renaming = false
    @State private var newName = ""
    @State private var listener: UUID?
    /// Each signal starts a load; only the newest one may show its answer.
    @State private var loads = 0

    var body: some View {
        Group {
            if let design {
                content(design)
            } else if missing {
                ContentUnavailableView("Design not found", systemImage: StudioKind.of("design").symbol,
                    description: Text("It may have been deleted."))
            } else if let error {
                ContentUnavailableView("Couldn't open design", systemImage: StudioKind.of("design").symbol, description: Text(error))
            } else {
                ProgressView()
            }
        }
        .modifier(RegularScrollingSurface())
        .navigationTitle(design?.displayName ?? "Design")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            Menu {
                if let threadId = design?.threadId {
                    Button { app.push(.thread(id: threadId)) } label: { Label("Open Thread", systemImage: Symbols.thread) }
                }
                StudioChatMenuButton(isPresented: $chatting)
                Button {
                    newName = design?.name ?? ""
                    renaming = true
                } label: { Label("Rename", systemImage: "pencil") }
                .disabled(design == nil)
                Button { showingRelated = true } label: { Label("Related", systemImage: "link") }
                Button { showingWeb = true } label: { Label("Comment in BB Web", systemImage: "safari") }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .accessibilityLabel("Design options")
        }
        .alert("Rename design", isPresented: $renaming) {
            TextField("Name", text: $newName)
            Button("Cancel", role: .cancel) {}
            Button("Rename") { act { try await client.renameDesign(id, name: newName.trimmingCharacters(in: .whitespacesAndNewlines)) } }
                .disabled(newName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .sheet(isPresented: $showingRelated) { RelatedView(pluginId: "design", itemId: id) }
        .sheet(isPresented: $showingWeb) {
            NavigationStack {
                WebView(url: client.baseURL.appending(path: "plugins/studio/studio/designs/\(id)"))
                    .ignoresSafeArea(edges: .bottom)
                    .navigationTitle(design?.displayName ?? "Design")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar { Button("Done") { showingWeb = false } }
            }
        }
        .studioChat(isPresented: $chatting, pluginId: "design", itemId: id, title: design?.displayName ?? "Design", projectId: design?.projectId)
        .fullScreenCover(item: $playing) { screen in
            DesignPlayer(designId: id, screen: screen)
        }
        .refreshable { await load() }
        .task(id: id) {
            // Agents write a round a screen at a time. The plugin says when this
            // design changes, and a reconnect may have missed some: reload then.
            if let listener { app.realtime.removeListener(listener) }
            listener = app.realtime.listen { event in
                switch event {
                // Studio sends it on its `design` channel.
                case .pluginSignal("studio", "design", let payload) where payload["designId"]?.stringValue == id: Task { await load() }
                case .connected: Task { await load() }
                default: break
                }
            }
            await load()
        }
        .onDisappear {
            if let listener { app.realtime.removeListener(listener) }
            listener = nil
        }
        .accessibilityIdentifier("designView")
    }

    private func content(_ design: StudioDesign) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 24) {
                if let review = design.review { reviewBanner(review) }
                if design.screens.isEmpty {
                    ContentUnavailableView("No screens yet", systemImage: StudioKind.of("design").symbol,
                        description: Text("The agent's first round shows up here as it writes it."))
                }
                ForEach(design.rounds ?? [], id: \.round) { round in
                    roundView(round)
                }
                let comments = design.comments ?? []
                if !comments.isEmpty { commentsView(comments) }
            }
            .padding(.vertical)
        }
    }

    private func roundView(_ round: Studio.DesignsGetDesignOutputDesignRoundsItem) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(["Round \(Int(round.round ?? 0))", round.title].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " · "))
                    .font(.headline)
                if let intro = round.intro, !intro.isEmpty {
                    Text(intro).font(.subheadline).foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal)
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: 14) {
                    ForEach(round.screens ?? [], id: \.id) { screen in
                        Button { playing = screen } label: { thumbnail(screen) }
                            .buttonStyle(.plain)
                            // Pinching a screen opens it full screen, where pinch zooms and a drag pans.
                            .simultaneousGesture(MagnifyGesture().onEnded { value in
                                if value.magnification > 1.1 { playing = screen }
                            })
                            .accessibilityLabel("Play screen \(screen.id ?? ""), \(screen.title ?? screen.caption ?? "")")
                            .accessibilityIdentifier("designScreen-\(screen.id ?? "")")
                    }
                }
                .padding(.horizontal)
            }
        }
    }

    /// A screen at its own size, scaled into a card 300 points tall.
    private func thumbnail(_ screen: DesignScreen) -> some View {
        let size = screen.size
        let scale = 300 / size.height
        return VStack(alignment: .leading, spacing: 6) {
            DesignFrame(url: client.designScreenURL(id, screen), interactive: false)
                .frame(width: size.width, height: size.height)
                .scaleEffect(scale, anchor: .topLeading)
                .frame(width: size.width * scale, height: 300, alignment: .topLeading)
                .clipShape(.rect(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(.separator))
            HStack(spacing: 6) {
                Text(screen.id ?? "").font(.caption.weight(.semibold).monospaced())
                Text(screen.title?.isEmpty == false ? screen.title! : screen.caption ?? "")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .frame(width: size.width * scale, alignment: .leading)
        }
        // The page takes no touches, so without this only the caption was a target: the whole card plays the screen.
        .contentShape(.rect)
    }

    @ViewBuilder
    private func reviewBanner(_ review: Studio.DesignsGetDesignOutputDesignReview) -> some View {
        let round = review.round.map { " round \(Int($0))" } ?? ""
        let (text, symbol, tint): (String, String, Color) = switch review.state {
        case .reviewing: ("Reviewing\(round)…", "eye", .blue)
        case .needs_work: ("The reviewer sent\(round) back for fixes", "exclamationmark.triangle", .orange)
        case .failed: ("The review\(round) didn't finish", "xmark.octagon", .red)
        default: ("Reviewed\(round)", "checkmark.seal", .green)
        }
        VStack(alignment: .leading, spacing: 4) {
            Label(text, systemImage: symbol).font(.subheadline.weight(.medium)).foregroundStyle(tint)
            if let summary = review.summary, !summary.isEmpty, review.state != .done {
                Text(summary).font(.caption).foregroundStyle(.secondary).lineLimit(4)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tint.opacity(0.1), in: .rect(cornerRadius: 12))
        .padding(.horizontal)
    }

    private func commentsView(_ comments: [Studio.DesignsGetDesignOutputDesignCommentsItem]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Comments").font(.headline)
            ForEach(comments, id: \.id) { comment in
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(comment.screenId ?? "").font(.caption.weight(.semibold).monospaced())
                        if let element = comment.elementText, !element.isEmpty {
                            Text("on \u{201C}\(element)\u{201D}").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                        Spacer(minLength: 0)
                        if comment.sent == true {
                            Image(systemName: "paperplane").font(.caption2).foregroundStyle(.secondary).accessibilityLabel("Sent to the agent")
                        }
                    }
                    Text(comment.body ?? "").font(.subheadline)
                }
                .contextMenu { commentActions(comment) }
                .accessibilityAction(named: "Resolve") { if let id = comment.id { act { try await client.resolveDesignComment(id) } } }
            }
            Text("Touch and hold a comment to send it to the agent, resolve or delete it. Pin new comments to a screen's elements in BB web.")
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding(.horizontal)
    }

    @ViewBuilder
    private func commentActions(_ comment: Studio.DesignsGetDesignOutputDesignCommentsItem) -> some View {
        if let commentId = comment.id {
            if comment.sent != true {
                Button { act { try await client.sendDesignComment(commentId) } } label: { Label("Send to Agent", systemImage: "paperplane") }
            }
            Button { act { try await client.resolveDesignComment(commentId) } } label: { Label("Resolve", systemImage: "checkmark.circle") }
            Button(role: .destructive) { act { try await client.deleteDesignComment(commentId) } } label: { Label("Delete", systemImage: "trash") }
        }
    }

    /// Runs a change, then reloads (the design signal also reloads); a failure shows over the page.
    private func act(_ change: @escaping () async throws -> Void) {
        Task {
            do {
                try await change()
                await load()
            } catch {
                app.flash(BBClient.describe(error, plugin: "Studio", server: client.baseURL))
            }
        }
    }

    private func load() async {
        loads += 1
        let load = loads
        do {
            let found = try await client.design(id)
            guard load == loads else { return }
            if let found {
                if found != design { design = found }
                error = nil
            } else {
                missing = true
            }
        } catch {
            guard load == loads else { return }
            if design == nil { self.error = BBClient.describe(error, server: client.baseURL) }
        }
    }
}

extension DesignScreen: Identifiable {}

/// One screen, live, played full screen: Fit shows it whole, Fill uses the
/// phone's width and scrolls. Pinch zooms (to 6×) and pans, and a double tap
/// zooms in and out, in the web view's own scroll view (the screen's page laid
/// out at the width it was written for), so taps still play the prototype. A
/// prototype's steps start it part-way through.
private struct DesignPlayer: View {
    private let operation = ServerOperation()
    let designId: String
    let screen: DesignScreen
    @State private var fill = false
    @State private var step = ""
    @State private var zoom: CGFloat = 0
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            DesignFrame(url: operation.client.designScreenURL(designId, screen, step: step), interactive: true,
                        zoom: .init(width: screen.size.width, height: screen.size.height, fill: fill)) { zoom = $0 }
                .id(step)
                .background(Color(.secondarySystemBackground))
                .overlay(alignment: .bottomTrailing) {
                    // The page's zoom scale, for the UI tests.
                    Color.clear.frame(width: 1, height: 1)
                        .accessibilityElement()
                        .accessibilityLabel("Zoom")
                        .accessibilityValue(String(format: "%.4f", zoom))
                        .accessibilityIdentifier("designZoom")
                }
            .navigationTitle([screen.id, screen.title?.isEmpty == false ? screen.title : screen.caption].compactMap { $0 }.joined(separator: " · "))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    if let steps = screen.steps, !steps.isEmpty {
                        Menu {
                            Picker("Start at", selection: $step) {
                                Text("Beginning").tag("")
                                ForEach(steps, id: \.id) { Text($0.label ?? $0.id ?? "").tag($0.id ?? "") }
                            }
                        } label: { Image(systemName: "list.number") }
                        .accessibilityLabel("Steps")
                    }
                    Button { fill.toggle() } label: {
                        Image(systemName: fill ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right")
                    }
                    .accessibilityLabel(fill ? "Fit" : "Fill")
                }
            }
        }
    }
}

/// A design screen's page. Previews take no touches, so the row scrolls. With
/// `zoom` (the player) the page is laid out at the screen's own width and the
/// web view's scroll view zooms: it starts at Fit (the whole screen) or Fill
/// (its width), pinch goes to 6×, and WebKit's double tap zooms in and out.
private struct DesignFrame: UIViewRepresentable {
    struct Zoom: Equatable {
        var width: Double
        var height: Double
        var fill: Bool
    }

    let url: URL
    let interactive: Bool
    var zoom: Zoom? = nil
    /// The web view's zoom scale, as it changes.
    var zoomed: ((CGFloat) -> Void)? = nil

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        if let zoom {
            configuration.userContentController.addUserScript(Self.viewport(width: zoom.width))
            // Pinch works even where the page's viewport forbids it.
            configuration.ignoresViewportScaleLimits = true
        }
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.isUserInteractionEnabled = interactive
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.isOpaque = false
        if zoom != nil {
            view.accessibilityIdentifier = "designPlayerPage"
            view.scrollView.bouncesZoom = true
            view.navigationDelegate = context.coordinator
            context.coordinator.watch(view)
        }
        context.coordinator.parent = self
        context.coordinator.load(url, in: view)
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        view.isUserInteractionEnabled = interactive
        let before = context.coordinator.parent.zoom
        context.coordinator.parent = self
        if before?.fill != zoom?.fill { context.coordinator.fit(view, animated: true) }
        guard context.coordinator.loaded != url else { return }
        context.coordinator.load(url, in: view)
    }

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    /// The page's viewport at the screen's width, zoomable (designs often say `user-scalable=no`).
    static func viewport(width: Double) -> WKUserScript {
        WKUserScript(source: """
            (function () {
              var content = 'width=\(Int(width)), minimum-scale=0.1, maximum-scale=6, user-scalable=yes';
              function apply() {
                var meta = document.querySelector('meta[name=viewport]');
                if (!meta) { meta = document.createElement('meta'); meta.name = 'viewport'; (document.head || document.documentElement).appendChild(meta); }
                meta.content = content;
              }
              if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply); else apply();
            })();
            """, injectionTime: .atDocumentEnd, forMainFrameOnly: true)
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var parent: DesignFrame
        var loaded: URL?
        private var reported: CGFloat = 0
        /// WebKit's scroll view doesn't post zoom changes, so the zoom is read four times a second.
        private var timer: Timer?

        init(parent: DesignFrame) { self.parent = parent }

        deinit { timer?.invalidate() }

        func load(_ url: URL, in view: WKWebView) {
            loaded = url
            #if DEBUG
            if let html = DesignDemo.html(for: url) {
                view.loadHTMLString(html, baseURL: nil)
                return
            }
            #endif
            view.load(URLRequest(url: url))
        }

        func watch(_ view: WKWebView) {
            timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self, weak view] _ in
                guard let self, let view else { return }
                let current = view.scrollView.zoomScale
                guard abs(current - self.reported) > 0.0005 else { return }
                self.reported = current
                self.parent.zoomed?(current)
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            // The viewport changes after the page lays out; fit once it has.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self, weak webView] in
                guard let self, let webView else { return }
                self.fit(webView, animated: false)
            }
        }

        /// Fit: the whole screen in view. Fill: the screen's width across the view.
        func fit(_ view: WKWebView, animated: Bool) {
            guard let zoom = parent.zoom, view.bounds.width > 0, zoom.width > 0, zoom.height > 0 else { return }
            let across = view.bounds.width / zoom.width
            let scale = zoom.fill ? across : min(across, view.bounds.height / zoom.height)
            view.scrollView.minimumZoomScale = min(scale, across) * 0.5
            view.scrollView.maximumZoomScale = across * 6
            // WebKit keeps a page at least as wide as the view, so a phone screen's Fit fills the width.
            view.scrollView.setZoomScale(scale, animated: animated)
        }
    }
}
