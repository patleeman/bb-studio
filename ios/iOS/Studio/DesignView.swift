import SwiftUI
import WebKit

/// A Studio Design: its rounds, newest first, each a row of live screens.
/// Tapping a screen plays it full screen; comments and edits stay with the
/// design's thread and BB web, where elements can be picked.
struct DesignView: View {
    @Environment(\.look) private var look
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
        case .needs_work: ("The reviewer sent\(round) back for fixes", "exclamationmark.triangle", .secondary)
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

/// One screen, full screen. It opens as a still of the screen, drawn at its
/// own size and zoomed in one scroll view: fit to the width and centred on
/// open, pinch to 6×, drag to pan, double-tap to zoom in and out, with only a
/// light bounce at the edges. A tap (or Play) plays the live prototype, laid
/// out at the screen's width; a prototype's steps start it part-way through.
private struct DesignPlayer: View {
    private let operation = ServerOperation()
    let designId: String
    let screen: DesignScreen
    @State private var playing = false
    @State private var step = ""
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if playing {
                    DesignFrame(url: operation.client.designScreenURL(designId, screen, step: step), interactive: true,
                                pageWidth: screen.size.width)
                        .id(step)
                } else {
                    DesignStill(url: operation.client.designScreenURL(designId, screen),
                                size: CGSize(width: screen.size.width, height: screen.size.height)) { playing = true }
                }
            }
            .background(Color(.secondarySystemBackground))
            .navigationTitle([screen.id, screen.title?.isEmpty == false ? screen.title : screen.caption].compactMap { $0 }.joined(separator: " · "))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    if let steps = screen.steps, !steps.isEmpty {
                        Menu {
                            Picker("Start at", selection: Binding(get: { step }, set: { step = $0; playing = true })) {
                                Text("Beginning").tag("")
                                ForEach(steps, id: \.id) { Text($0.label ?? $0.id ?? "").tag($0.id ?? "") }
                            }
                        } label: { Image(systemName: "list.number") }
                        .accessibilityLabel("Steps")
                    }
                    Button { playing.toggle() } label: {
                        Image(systemName: playing ? "photo" : "play.fill")
                    }
                    .accessibilityLabel(playing ? "View" : "Play")
                    .accessibilityIdentifier("designPlayToggle")
                }
            }
        }
    }
}

/// A screen's still in one scroll view (`DesignStillView`).
private struct DesignStill: UIViewRepresentable {
    let url: URL
    let size: CGSize
    var play: () -> Void

    func makeUIView(context: Context) -> DesignStillView {
        DesignStillView(url: url, size: size, play: play)
    }

    func updateUIView(_ view: DesignStillView, context: Context) {
        view.play = play
    }
}

/// Draws the screen once, under the scroll view at its own size, takes a picture of it,
/// and shows the picture in a `UIScrollView`: the only scroll view, so a pan
/// moves the picture and nothing inside it rubber-bands. The minimum zoom is
/// fit-to-width, the picture is centred while it's smaller than the view, and
/// the edges bounce lightly. `designStill`'s value is the zoom relative to fit.
final class DesignStillView: UIView, UIScrollViewDelegate, WKNavigationDelegate {
    var play: () -> Void
    private let url: URL
    private let size: CGSize
    private let scroll = UIScrollView()
    private let imageView = UIImageView()
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let failure = UILabel()
    private var renderer: WKWebView?
    private var started = false
    private var fit: CGFloat = 1
    private var laidOutWidth: CGFloat = 0
    /// The page's height at its own width (a screen can be taller than its frame).
    private var pageHeight: CGFloat = 0

    init(url: URL, size: CGSize, play: @escaping () -> Void) {
        self.url = url
        self.size = CGSize(width: max(1, size.width), height: max(1, size.height))
        self.play = play
        super.init(frame: .zero)
        scroll.delegate = self
        scroll.bounces = true
        scroll.bouncesZoom = true
        scroll.alwaysBounceVertical = false
        scroll.alwaysBounceHorizontal = false
        scroll.showsHorizontalScrollIndicator = false
        scroll.contentInsetAdjustmentBehavior = .never
        scroll.decelerationRate = .normal
        scroll.backgroundColor = .secondarySystemBackground
        scroll.accessibilityIdentifier = "designStill"
        scroll.accessibilityLabel = "Design screen"
        scroll.isAccessibilityElement = true
        imageView.contentMode = .scaleToFill
        scroll.addSubview(imageView)
        addSubview(scroll)
        spinner.startAnimating()
        addSubview(spinner)
        failure.text = "This screen didn't draw. Play opens it live."
        failure.font = .preferredFont(forTextStyle: .footnote)
        failure.textColor = .secondaryLabel
        failure.numberOfLines = 0
        failure.textAlignment = .center
        failure.isHidden = true
        addSubview(failure)
        let doubleTap = UITapGestureRecognizer(target: self, action: #selector(doubleTapped(_:)))
        doubleTap.numberOfTapsRequired = 2
        scroll.addGestureRecognizer(doubleTap)
        let tap = UITapGestureRecognizer(target: self, action: #selector(tapped))
        tap.require(toFail: doubleTap)
        scroll.addGestureRecognizer(tap)
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }

    override func layoutSubviews() {
        super.layoutSubviews()
        scroll.frame = bounds
        spinner.center = CGPoint(x: bounds.midX, y: bounds.midY)
        failure.frame = bounds.insetBy(dx: 32, dy: 0)
        guard bounds.width > 0 else { return }
        if !started, window != nil { render() }
        if imageView.image != nil, bounds.width != laidOutWidth { fitToWidth(keepingZoom: laidOutWidth > 0) }
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        setNeedsLayout()
    }

    // MARK: Drawing the still

    /// The page at its own width, offscreen (it must be in the window to draw), until its fonts and first frames are in.
    private func render() {
        started = true
        let configuration = WKWebViewConfiguration()
        configuration.suppressesIncrementalRendering = true
        let page = WKWebView(frame: CGRect(origin: .zero, size: size), configuration: configuration)
        // Opaque, under the scroll view's opaque background: a snapshot keeps the view's alpha, and a hidden view doesn't draw.
        page.isUserInteractionEnabled = false
        page.accessibilityElementsHidden = true
        page.scrollView.contentInsetAdjustmentBehavior = .never
        page.navigationDelegate = self
        insertSubview(page, at: 0)
        renderer = page
        #if DEBUG
        if let html = DesignDemo.html(for: url) {
            page.loadHTMLString(html, baseURL: nil)
            return
        }
        #endif
        page.load(URLRequest(url: url))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let script = """
            if (document.fonts) { await document.fonts.ready; }
            await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
            return Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
            """
        webView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { [weak self] result in
            guard let self else { return }
            let height = (try? result.get()) as? Double ?? Double(self.size.height)
            self.pageHeight = min(8000, max(self.size.height, CGFloat(height)))
            webView.frame.size.height = self.pageHeight
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { self.snapshot(webView) }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failed() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failed() }

    private func snapshot(_ page: WKWebView) {
        let configuration = WKSnapshotConfiguration()
        configuration.rect = CGRect(x: 0, y: 0, width: size.width, height: pageHeight)
        // Sharp to a few times fit, within a texture a phone handles (4096 px wide).
        let scale = window?.screen.scale ?? 3
        let width = min(size.width * 3, max(bounds.width * 6, size.width), 4096 / scale, 16384 / scale * size.width / pageHeight)
        configuration.snapshotWidth = NSNumber(value: Double(width))
        configuration.afterScreenUpdates = true
        page.takeSnapshot(with: configuration) { [weak self] image, _ in
            guard let self else { return }
            page.removeFromSuperview()
            self.renderer = nil
            guard let image else { return self.failed() }
            self.spinner.stopAnimating()
            self.spinner.isHidden = true
            self.imageView.image = image
            self.imageView.frame = CGRect(x: 0, y: 0, width: self.size.width, height: self.pageHeight)
            self.scroll.contentSize = self.imageView.frame.size
            self.fitToWidth(keepingZoom: false)
        }
    }

    private func failed() {
        renderer?.removeFromSuperview()
        renderer = nil
        spinner.stopAnimating()
        spinner.isHidden = true
        failure.isHidden = false
    }

    // MARK: Zoom

    /// Fit-to-width is the least zoom; a size change keeps the zoom relative to it.
    private func fitToWidth(keepingZoom: Bool) {
        guard bounds.width > 0, imageView.image != nil else { return }
        let relative = keepingZoom && fit > 0 ? scroll.zoomScale / fit : 1
        laidOutWidth = bounds.width
        fit = bounds.width / size.width
        scroll.minimumZoomScale = fit
        scroll.maximumZoomScale = fit * 6
        scroll.zoomScale = fit * min(6, max(1, relative))
        if !keepingZoom { scroll.contentOffset = .zero }
        center()
        report()
    }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }

    func scrollViewDidZoom(_ scrollView: UIScrollView) {
        center()
        report()
    }

    /// While the picture is smaller than the view (a wide screen's height), it sits in the middle.
    private func center() {
        let content = scroll.contentSize
        scroll.contentInset = UIEdgeInsets(top: max(0, (bounds.height - content.height) / 2), left: max(0, (bounds.width - content.width) / 2),
                                           bottom: 0, right: 0)
    }

    private func report() {
        scroll.accessibilityValue = String(format: "%.4f", fit > 0 ? scroll.zoomScale / fit : 0)
    }

    @objc private func doubleTapped(_ gesture: UITapGestureRecognizer) {
        guard imageView.image != nil else { return }
        if scroll.zoomScale > fit * 1.05 {
            scroll.setZoomScale(fit, animated: true)
        } else {
            let point = gesture.location(in: imageView)
            let scale = fit * 2.5
            let size = CGSize(width: bounds.width / scale, height: bounds.height / scale)
            scroll.zoom(to: CGRect(x: point.x - size.width / 2, y: point.y - size.height / 2, width: size.width, height: size.height), animated: true)
        }
    }

    @objc private func tapped() { play() }
}

/// A design screen's live page. Previews take no touches, so the row scrolls.
/// Played (`pageWidth`), the page is laid out at the screen's own width from
/// its first layout (WebKit fits it to the view), and it zooms in its own
/// scroll view with WebKit's own limits; nothing else zooms or scrolls it.
private struct DesignFrame: UIViewRepresentable {
    let url: URL
    let interactive: Bool
    var pageWidth: Double? = nil

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        if let pageWidth {
            configuration.userContentController.addUserScript(Self.viewport(width: pageWidth))
            configuration.ignoresViewportScaleLimits = true
        }
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.isUserInteractionEnabled = interactive
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.isOpaque = false
        if pageWidth != nil { view.accessibilityIdentifier = "designPlayerPage" }
        context.coordinator.load(url, in: view)
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        view.isUserInteractionEnabled = interactive
        guard context.coordinator.loaded != url else { return }
        context.coordinator.load(url, in: view)
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    /// The page's viewport at the screen's width before its first layout, and kept there if the page changes it.
    static func viewport(width: Double) -> WKUserScript {
        WKUserScript(source: """
            (function () {
              var content = 'width=\(Int(width)), maximum-scale=6, user-scalable=yes';
              function apply() {
                var metas = document.querySelectorAll('meta[name=viewport]');
                if (!metas.length) {
                  var meta = document.createElement('meta'); meta.name = 'viewport';
                  (document.head || document.documentElement).appendChild(meta); metas = [meta];
                }
                metas.forEach(function (meta) { if (meta.content !== content) meta.content = content; });
              }
              apply();
              new MutationObserver(apply).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['content'] });
            })();
            """, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    final class Coordinator {
        var loaded: URL?

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
    }
}
