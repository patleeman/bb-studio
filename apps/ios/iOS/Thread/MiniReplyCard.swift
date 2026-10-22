import SwiftUI
import WebKit

/// `::mini{id="mini_…"}` in a reply: the mini app itself, live, as the
/// desktop's card shows it. It fits its content between the manifest's
/// `size.minHeight` and `size.maxHeight`, and scrolls inside only past that.
///
/// A thread can hold many, so a card runs its app only near the screen and
/// while `MiniCardPool` lets it: it makes its web view then, and drops it,
/// closing its copy on the server, when it scrolls far away. In between it
/// keeps its last height, so the thread doesn't jump.
struct MiniReplyCard: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.colorScheme) private var colorScheme
    private let operation = ServerOperation()
    let id: String
    @State private var card = UUID()
    @State private var session: MiniSession?
    @State private var distance: Double?
    private var pool: MiniCardPool { .shared }

    /// The last content height each mini app measured, so a card made again starts at it.
    @MainActor private static var heights: [String: Double] = [:]

    var body: some View {
        let mini = session?.mini
        let missing = session?.missing == true
        let records = mini?.recordCount ?? 0
        StudioCardChrome(
            route: .mini(id: id),
            title: mini?.displayName ?? (missing ? "Deleted mini app" : "Mini app"),
            detail: ["Mini app", mini.flatMap { $0.collections.isEmpty ? nil : records == 1 ? "1 record" : "\(records) records" }]
                .compactMap { $0 }.joined(separator: " · "),
            missing: missing,
            hasPreview: mini != nil && !missing,
            identifier: "replyItemCard",
            action: missing ? nil : "Open"
        ) {
            Image(systemName: StudioKind.of("mini").symbol)
                .font(.body.weight(.medium))
                .foregroundStyle(StudioKind.of("mini").tint)
                .frame(width: 44, height: 44)
                .background(StudioKind.of("mini").tint.opacity(0.12), in: .rect(cornerRadius: 10))
        } preview: {
            if let session, let mini { preview(mini, session: session) }
        }
        .task(id: id) {
            let session = self.session ?? MiniSession(client: operation.client, id: id)
            self.session = session
            if pool.live.contains(card) {
                await session.start(app)
            } else if session.mini == nil {
                await session.load()
            }
        }
        .onChange(of: pool.live.contains(card)) { _, live in
            guard let session else { return }
            if live {
                Task { await session.start(app) }
            } else {
                session.stop()
            }
        }
        .onChange(of: session?.contentHeight) { _, height in
            if let height { Self.heights[id] = height }
        }
        .onDisappear {
            pool.report(card, distance: nil)
            session?.stop()
        }
    }

    @ViewBuilder
    private func preview(_ mini: MiniApp, session: MiniSession) -> some View {
        let content = session.contentHeight ?? Self.heights[id]
        VStack(spacing: 0) {
            MiniStrips(mini: mini, appError: session.appError)
            if let versionId = mini.versionId {
                Group {
                    if pool.live.contains(card) {
                        MiniCardFrameView(host: session.host, versionId: versionId, granted: mini.granted, dark: colorScheme == .dark,
                            tall: MiniSizing.scrolls(content: content, size: mini.manifest?.size) ? content : nil)
                            .accessibilityLabel(mini.displayName)
                            .accessibilityIdentifier("miniCardFrame")
                    } else {
                        paused
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(height: MiniSizing.height(content: content, size: mini.manifest?.size))
                .background(Color(.systemBackground))
                // Where the card is, against the visible part of the thread, in steps
                // of 100 points so scrolling doesn't report every frame.
                .onGeometryChange(for: Double.self) { proxy in
                    guard let viewport = proxy.bounds(of: .scrollView) else { return 0 }
                    let distance = MiniCardLiveness<UUID>.distance(of: proxy.frame(in: .scrollView), in: viewport)
                    return (distance / 100).rounded(.up) * 100
                } action: { distance in
                    self.distance = distance
                    pool.report(card, distance: distance)
                }
                .onAppear {
                    if let distance { pool.report(card, distance: distance) }
                }
                .onDisappear { pool.report(card, distance: nil) }
            } else {
                Text("This mini app has no source yet. Ask an agent to build it.")
                    .font(.footnote).foregroundStyle(.secondary).padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    /// What shows while the app doesn't run: on screen only when other cards
    /// hold every live slot, and then a tap runs this one instead.
    private var paused: some View {
        Button {
            pool.pick(card)
        } label: {
            VStack(spacing: 6) {
                Image(systemName: "play.circle").font(.title2)
                Text("Tap to run here").font(.footnote)
            }
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("miniCardPaused")
    }
}

/// The app in a card. An app that fits fills it, and drags over it scroll
/// the thread. One taller than the card gets its full height, and the card
/// scrolls it under its own drag, which the thread waits for; WebKit's own
/// scroll view never got drags ahead of the thread's.
private struct MiniCardFrameView: UIViewRepresentable {
    let host: MiniHost
    let versionId: String
    let granted: [String]
    let dark: Bool
    /// The app's full height when it's taller than the card.
    let tall: Double?

    func makeUIView(context: Context) -> MiniCardScroller {
        let scroller = MiniCardScroller()
        scroller.web = host.makeWebView()
        update(scroller)
        return scroller
    }

    func updateUIView(_ scroller: MiniCardScroller, context: Context) {
        update(scroller)
    }

    private func update(_ scroller: MiniCardScroller) {
        host.show(versionId: versionId, granted: granted, dark: dark)
        scroller.tall = tall.map { CGFloat($0) }
    }

    static func dismantleUIView(_ scroller: MiniCardScroller, coordinator: ()) {
        MainActor.assumeIsolated {
            (scroller.web?.navigationDelegate as? MiniHost)?.close()
        }
    }
}

/// Holds the web view, and scrolls a tall one by moving it. A hidden scroll
/// view lends its drag and deceleration; it isn't the web view's parent,
/// because WebKit keeps its accessibility frames, and so taps in UI tests and
/// VoiceOver, in step with the nearest scroll view above it, which must be the
/// thread's.
final class MiniCardScroller: UIView, UIScrollViewDelegate {
    private let tracker = UIScrollView()

    var web: WKWebView? {
        didSet {
            oldValue?.removeFromSuperview()
            if let web { insertSubview(web, at: 0) }
        }
    }

    var tall: CGFloat? {
        didSet {
            guard tall != oldValue else { return }
            tracker.isScrollEnabled = tall != nil
            if tall == nil { tracker.contentOffset = .zero }
            holdThread()
            setNeedsLayout()
        }
    }

    /// The thread whose drags wait for this card's.
    private weak var thread: UIScrollView?

    override init(frame: CGRect) {
        super.init(frame: frame)
        clipsToBounds = true
        tracker.isHidden = true
        tracker.isScrollEnabled = false
        tracker.bounces = false
        tracker.contentInsetAdjustmentBehavior = .never
        tracker.delegate = self
        addSubview(tracker)
        addGestureRecognizer(tracker.panGestureRecognizer)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func layoutSubviews() {
        super.layoutSubviews()
        let size = CGSize(width: bounds.width, height: max(bounds.height, tall ?? 0))
        tracker.frame = bounds
        if tracker.contentSize != size { tracker.contentSize = size }
        place()
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        holdThread()
    }

    /// The thread's drag would win over the card's, which UIKit only puts
    /// first for a scroll view inside it. So the thread waits for the card's
    /// drag to fail: at once while the app fits, since it's disabled then.
    private func holdThread() {
        guard tall != nil, window != nil, thread == nil else { return }
        var ancestor = superview
        while let view = ancestor, !(view is UIScrollView) { ancestor = view.superview }
        guard let scrollView = ancestor as? UIScrollView else { return }
        scrollView.panGestureRecognizer.require(toFail: tracker.panGestureRecognizer)
        thread = scrollView
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        place()
    }

    private func place() {
        let frame = CGRect(x: 0, y: -tracker.contentOffset.y, width: bounds.width, height: tracker.contentSize.height)
        if web?.frame != frame { web?.frame = frame }
    }
}

/// Which reply cards run their mini app, over the whole app: see `MiniCardLiveness`.
@MainActor
@Observable
final class MiniCardPool {
    static let shared = MiniCardPool()

    private(set) var live: Set<UUID> = []
    @ObservationIgnored private var policy = MiniCardLiveness<UUID>()

    func report(_ card: UUID, distance: Double?) {
        policy.report(card, distance: distance)
        publish()
    }

    func pick(_ card: UUID) {
        policy.pick(card)
        publish()
    }

    private func publish() {
        if policy.live != live { live = policy.live }
    }
}
