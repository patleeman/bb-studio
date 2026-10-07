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
        .navigationTitle(design?.displayName ?? "Design")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            Menu {
                if let threadId = design?.threadId {
                    Button { app.push(.thread(id: threadId)) } label: { Label("Open Thread", systemImage: Symbols.thread) }
                }
                StudioChatMenuButton(isPresented: $chatting)
                Button { showingRelated = true } label: { Label("Related", systemImage: "link") }
                Button { showingWeb = true } label: { Label("Comment in BB Web", systemImage: "safari") }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .accessibilityLabel("Design options")
        }
        .sheet(isPresented: $showingRelated) { RelatedView(pluginId: "design", itemId: id) }
        .sheet(isPresented: $showingWeb) {
            NavigationStack {
                WebView(url: client.baseURL.appending(path: "plugins/design/designs/\(id)"))
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
                case .pluginSignal("design", _, let payload) where payload["designId"]?.stringValue == id: Task { await load() }
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

    private func roundView(_ round: Design.GetDesignOutputDesignRoundsItem) -> some View {
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
                            .accessibilityLabel("Play screen \(screen.id ?? ""), \(screen.title ?? screen.caption ?? "")")
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
    }

    @ViewBuilder
    private func reviewBanner(_ review: Design.GetDesignOutputDesignReview) -> some View {
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

    private func commentsView(_ comments: [Design.GetDesignOutputDesignCommentsItem]) -> some View {
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
            }
            Text("Pin new comments to a screen's elements in BB web.").font(.caption).foregroundStyle(.secondary)
        }
        .padding(.horizontal)
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
/// phone's width and scrolls. A prototype's steps start it part-way through.
private struct DesignPlayer: View {
    private let operation = ServerOperation()
    let designId: String
    let screen: DesignScreen
    @State private var fill = false
    @State private var step = ""
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            GeometryReader { proxy in
                let size = screen.size
                let scale = fill ? proxy.size.width / size.width : min(1, proxy.size.width / size.width, proxy.size.height / size.height)
                DesignFrame(url: operation.client.designScreenURL(designId, screen, step: step), interactive: true)
                    .id(step)
                    .frame(width: size.width, height: fill ? proxy.size.height / scale : size.height)
                    .scaleEffect(scale, anchor: .topLeading)
                    .frame(width: size.width * scale, height: fill ? proxy.size.height : size.height * scale, alignment: .topLeading)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .background(Color(.secondarySystemBackground))
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

/// A design screen's page. Previews take no touches, so the row scrolls.
private struct DesignFrame: UIViewRepresentable {
    let url: URL
    let interactive: Bool

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.isUserInteractionEnabled = interactive
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.isOpaque = false
        view.load(URLRequest(url: url))
        context.coordinator.loaded = url
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        view.isUserInteractionEnabled = interactive
        guard context.coordinator.loaded != url else { return }
        context.coordinator.loaded = url
        view.load(URLRequest(url: url))
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator {
        var loaded: URL?
    }
}
