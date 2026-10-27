import SwiftUI
import UIKit

/// Where the composer rests, where rows sit, and when the transcript counts
/// as at its end or its top. Set by the app per layout (phone, Duo pages).
struct TranscriptChrome: Equatable {
    /// Between the composer and the keyboard, or the bottom edge when there's none.
    var composerGap: CGFloat = 8
    /// The composer rests `composerGap` above the window's bottom edge rather
    /// than above the home indicator: the Duo's inner screen, two pages or
    /// iOS's two-app split.
    var composerIgnoresBottomSafeArea = false
    /// The composer and pill run under the trailing safe area: the Duo's
    /// status column beside two pages.
    var composerIgnoresTrailingSafeArea = false
    var rows = TranscriptListLayout.Metrics()
    /// Kept clear of rows at the trailing edge; nil is the safe area.
    var rowsTrailingClear: CGFloat?
    var pill = PillPlacement.trailing
    /// Rows fade softly under the header (iOS's scroll edge effect).
    var softTopEdge = false
    /// The reader's scroll resting this close to the end follows it.
    var nearEnd: CGFloat = 80
    /// `onNearTop` fires when the top of what the reader sees is this close to the first row.
    var nearTop: CGFloat = 600

    enum PillPlacement: Equatable {
        /// Floating at the trailing edge just above the composer (a phone).
        case trailing
        /// Centred in a band above the composer, which the bottom inset includes (beside two pages).
        case center
    }
}

/// The "jump to latest" pill: shown while the reader is up in the history,
/// with how many rows came in meanwhile.
struct TranscriptPillState: Equatable {
    var shown = false
    var unseen = 0
    /// The app's word for something waiting at the end (a question), shown
    /// on the pill in its own style.
    var note: String?
}

enum TranscriptRowPosition: Equatable { case top, center }

/// The transcript and its composer, in UIKit, with one owner of scrolling.
///
/// - The collection view, composer, pill and header live in one view; the
///   composer's bottom is pinned to the keyboard layout guide, so it rides
///   the keyboard (docked, interactive dismissal) with no notification math.
/// - The bottom content inset is the composer's frame (and the pill's band),
///   written only when it changes.
/// - This controller is the only writer of `contentOffset`, and every write is
///   clamped to the valid range: the view can't rest past the end.
/// - Following, the anchor is the end; reading, it's the top visible row.
///   Height changes are answered in the layout's own invalidation, prepends
///   and width changes by `targetContentOffset`, and `settle()` after every
///   layout pass puts the view back on its anchor if anything else moved it.
/// - `follow` changes only on the reader's own scrolls and on "jump to latest".
///
/// Rows are `AnyHashable` ids with a SwiftUI builder; nothing here knows
/// what a message is.
@MainActor
final class TranscriptController: UIViewController, UICollectionViewDelegate, UIGestureRecognizerDelegate, TranscriptLayoutAnchoring {
    let layout = TranscriptListLayout()
    private(set) var collectionView: TranscriptCollectionView!
    private var dataSource: UICollectionViewDiffableDataSource<Int, TranscriptRowID>!
    private(set) var ids: [AnyHashable] = []

    /// A row's view. Called when a cell shows and when its row changes.
    var content: (AnyHashable) -> AnyView = { _ in AnyView(EmptyView()) }
    var pillContent: (TranscriptPillState, @escaping () -> Void) -> AnyView = { _, _ in AnyView(EmptyView()) }

    var onFollowChange: ((TranscriptFollow) -> Void)?
    var onNearTop: (() -> Void)?
    var onPillChange: ((TranscriptPillState) -> Void)?
    /// Scroll log lines: geometry, numbers and ids only.
    var log: ((String) -> Void)?
    /// A row id as the log writes it. An app whose ids could carry text
    /// passes a filter (BB: `ScrollLog.id`).
    var describe: (AnyHashable) -> String = { "\($0)" }
    /// The rows' content frame in window coordinates, after each layout (Debug probes).
    var probe: ((CGRect) -> Void)?
    /// Ends editing after a tap on the transcript. The default waits a run
    /// loop turn; an app can hold it further (BB waits out window resizes).
    var dismissKeyboard: (UIWindow) -> Void = { window in
        DispatchQueue.main.async { window.endEditing(true) }
    }

    var chrome = TranscriptChrome() {
        didSet { if chrome != oldValue, isViewLoaded { applyChrome() } }
    }

    private(set) var follow = TranscriptFollow()
    private(set) var pill = TranscriptPillState()
    /// The row the reader is looking at. Moved only by the reader's scrolls
    /// and by `scrollTo`, never by layout.
    private(set) var anchor: TranscriptGeometry.Anchor<AnyHashable>?

    private let composerHost = TranscriptHost()
    private let topHost = TranscriptHost()
    private let pillHost = TranscriptHost()
    private var composerHeight: NSLayoutConstraint!
    private var topHeight: NSLayoutConstraint!
    private var composerBottom: NSLayoutConstraint!
    private var composerFloor: NSLayoutConstraint?
    private var composerEdges: [NSLayoutConstraint] = []
    private var pillPlacement: [NSLayoutConstraint] = []
    private var hasTop = false

    /// Our own animated scroll is running: settling waits for it.
    private var animating = false
    private var animationToken = 0
    private var nearTopArmed = true
    /// A row asked for before it was in the transcript.
    private var pendingScroll: (id: AnyHashable, position: TranscriptRowPosition)?

    /// For the harness: how much work each step took.
    struct Counters: Equatable {
        var layouts = 0
        var offsetWrites = 0
        var insetWrites = 0
        var followChanges = 0
        var configures = 0
        var applies = 0
        /// Frames of our own animated scrolls, apart from `layouts`.
        var animationLayouts = 0
    }

    /// Rows whose height changed since the layout began (for the harness's bound).
    var resizes: Int { layout.resizes }
    private(set) var counters = Counters()

    /// The harness raises a keyboard this tall without one (tests can't
    /// summon the real keyboard deterministically).
    var simulatedKeyboard: CGFloat = 0 {
        didSet { if isViewLoaded { applyChrome() } }
    }

    // MARK: Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear

        let collectionView = TranscriptCollectionView(frame: view.bounds, collectionViewLayout: layout)
        self.collectionView = collectionView
        collectionView.backgroundColor = .clear
        collectionView.contentInsetAdjustmentBehavior = .never
        collectionView.automaticallyAdjustsScrollIndicatorInsets = false
        collectionView.keyboardDismissMode = .interactive
        collectionView.alwaysBounceVertical = true
        collectionView.allowsSelection = false
        collectionView.selfSizingInvalidation = .enabled
        collectionView.delegate = self
        collectionView.didLayout = { [weak self] in self?.transcriptDidLayout() }
        collectionView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(collectionView)

        let registration = UICollectionView.CellRegistration<TranscriptCell, TranscriptRowID> { [weak self] cell, _, row in
            let id = row.id
            self?.configure(cell, id)
        }
        dataSource = UICollectionViewDiffableDataSource(collectionView: collectionView) { view, indexPath, row in
            view.dequeueConfiguredReusableCell(using: registration, for: indexPath, item: row)
        }
        layout.identify = { [weak self] in self?.dataSource.itemIdentifier(for: $0)?.id }
        layout.anchoring = self

        // Tap anywhere on the transcript to put the keyboard away. It never
        // takes the touch, so links, buttons and text selection keep it.
        let tap = UITapGestureRecognizer(target: self, action: #selector(tappedTranscript(_:)))
        tap.cancelsTouchesInView = false
        tap.delaysTouchesBegan = false
        tap.delaysTouchesEnded = false
        tap.delegate = self
        collectionView.addGestureRecognizer(tap)

        // The pill (and its scrim) under the composer, the header over all.
        for host in [pillHost, composerHost, topHost] {
            addChild(host)
            host.view.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(host.view)
            host.didMove(toParent: self)
        }
        pillHost.view.alpha = 0
        pillHost.view.isUserInteractionEnabled = false

        // The keyboard: the container's bottom is the keyboard's top. Its
        // host leaves the keyboard's safe area in (`TranscriptContainer`), so
        // the container ends where the keyboard begins, docked or in an
        // interactive dismissal. A UIKit keyboard layout guide never moved
        // here: hosted in SwiftUI, both the view's and the window's stayed
        // at zero size through every keyboard show and hide (iOS 27).
        //
        // The composer rests on the lower of the container's bottom and its
        // resting edge (the safe area, which includes a tab bar; or the
        // bottom edge on the Duo's inner screen), pulled down to it.
        let pullDown = composerHost.view.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        pullDown.priority = .defaultLow
        composerBottom = composerHost.view.bottomAnchor.constraint(lessThanOrEqualTo: view.safeAreaLayoutGuide.bottomAnchor)
        composerHeight = composerHost.view.heightAnchor.constraint(equalToConstant: 0)
        topHeight = topHost.view.heightAnchor.constraint(equalToConstant: 0)
        NSLayoutConstraint.activate([
            collectionView.topAnchor.constraint(equalTo: view.topAnchor),
            collectionView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            collectionView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            collectionView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            composerBottom, pullDown, composerHeight, topHeight,
            topHost.view.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            topHost.view.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            topHost.view.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            pillHost.view.bottomAnchor.constraint(equalTo: composerHost.view.topAnchor),
        ])
        applyChrome()
        var snapshot = NSDiffableDataSourceSnapshot<Int, TranscriptRowID>()
        snapshot.appendSections([0])
        dataSource.applySnapshotUsingReloadData(snapshot)
    }

    private func applyChrome() {
        NSLayoutConstraint.deactivate([composerBottom])
        composerBottom = composerHost.view.bottomAnchor.constraint(lessThanOrEqualTo: chrome.composerIgnoresBottomSafeArea
            ? view.bottomAnchor : view.safeAreaLayoutGuide.bottomAnchor)
        composerBottom.isActive = true
        // Always under the container's bottom (the keyboard's top), too.
        if composerFloor == nil {
            composerFloor = composerHost.view.bottomAnchor.constraint(lessThanOrEqualTo: view.bottomAnchor)
            composerFloor?.isActive = true
        }
        composerFloor?.constant = -(chrome.composerGap + simulatedKeyboard)
        collectionView.topEdgeEffect.style = chrome.softTopEdge ? .soft : .automatic
        composerBottom.constant = -(chrome.composerGap + simulatedKeyboard)
        NSLayoutConstraint.deactivate(composerEdges + pillPlacement)
        let guide = view.safeAreaLayoutGuide
        let trailing = chrome.composerIgnoresTrailingSafeArea ? view.trailingAnchor : guide.trailingAnchor
        composerEdges = [
            composerHost.view.leadingAnchor.constraint(equalTo: guide.leadingAnchor),
            composerHost.view.trailingAnchor.constraint(equalTo: trailing),
        ]
        switch chrome.pill {
        case .trailing:
            pillPlacement = [pillHost.view.trailingAnchor.constraint(equalTo: trailing)]
        case .center:
            // The band's width is the composer's, for a scrim behind the pill.
            pillPlacement = [pillHost.view.leadingAnchor.constraint(equalTo: composerHost.view.leadingAnchor),
                             pillHost.view.trailingAnchor.constraint(equalTo: composerHost.view.trailingAnchor)]
        }
        NSLayoutConstraint.activate(composerEdges + pillPlacement)
        view.setNeedsLayout()
    }

    // MARK: Hosted chrome

    /// The composer, under the transcript's bottom edge.
    func setComposer(_ composer: AnyView) { composerHost.rootView = composer }

    /// Above the transcript's top (a find bar, a header); rows scroll under it.
    func setTop(_ top: AnyView?) {
        if hasTop != (top != nil) { view.setNeedsLayout() }
        hasTop = top != nil
        topHost.rootView = top ?? AnyView(EmptyView())
        topHost.view.isHidden = top == nil
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let width = view.bounds.width
        let composer = composerHost.measure(width: composerHost.view.bounds.width > 0 ? composerHost.view.bounds.width : width)
        let top = hasTop ? topHost.measure(width: topHost.view.bounds.width > 0 ? topHost.view.bounds.width : width) : 0
        if abs(composerHeight.constant - composer) > 0.5 || abs(topHeight.constant - top) > 0.5 {
            composerHeight.constant = composer
            topHeight.constant = top
            view.layoutIfNeeded()
        }
        applyRowMetrics()
        updateInsets()
        settle("layout")
        logGeometry()
        if let probe, let rect = rowsFrameInWindow, rect != lastProbe {
            lastProbe = rect
            probe(rect)
        }
    }

    private func applyRowMetrics() {
        var metrics = chrome.rows
        metrics.leading = view.safeAreaInsets.left
        metrics.trailing = chrome.rowsTrailingClear ?? view.safeAreaInsets.right
        if layout.metrics != metrics { layout.metrics = metrics }
    }

    /// The insets come from where the header and composer are; only a real change is written.
    private func updateInsets() {
        let top = hasTop ? topHost.view.frame.maxY : view.safeAreaInsets.top
        var bottom = view.bounds.maxY - composerHost.view.frame.minY
        if chrome.pill == .center, pill.shown { bottom += pillHost.view.bounds.height }
        bottom = max(0, bottom)
        let insets = collectionView.contentInset
        guard abs(insets.top - top) > 0.5 || abs(insets.bottom - bottom) > 0.5 else { return }
        counters.insetWrites += 1
        let next = UIEdgeInsets(top: top, left: 0, bottom: bottom, right: 0)
        collectionView.contentInset = next
        collectionView.verticalScrollIndicatorInsets = next
        log?(String(format: "v2 insets top=%.1f bottom=%.1f follow=%@", top, bottom, "\(follow.mode)"))
    }

    // MARK: Rows

    /// The rows in order, and those whose content changed. Only an order
    /// change goes through a snapshot; a changed row (a streamed token)
    /// reconfigures its own cell if it's on screen, nothing else.
    func setRows(_ next: [AnyHashable], changed: [AnyHashable] = []) {
        loadViewIfNeeded()
        if next != ids {
            var seen = Set<AnyHashable>()
            let unique = next.filter { seen.insert($0).inserted }
            if unique.count != next.count { log?("v2 dropped \(next.count - unique.count) duplicate ids") }
            let appended = Self.appendedCount(old: ids, new: unique)
            // The anchor's row is going: hold on to the nearest row that stays.
            if let anchor, !seen.contains(anchor.id) { rebaseAnchor(keeping: seen) }
            var snapshot = NSDiffableDataSourceSnapshot<Int, TranscriptRowID>()
            snapshot.appendSections([0])
            snapshot.appendItems(unique.map(TranscriptRowID.init), toSection: 0)
            counters.applies += 1
            ids = unique
            dataSource.apply(snapshot, animatingDifferences: false)
            layout.forget(keeping: seen)
            if appended > 0, follow.handle(.appended(appended)) { followChanged() }
            nearTopArmed = true
            if let pending = pendingScroll, seen.contains(pending.id) {
                collectionView.layoutIfNeeded()
                scrollTo(pending.id, position: pending.position)
            }
        }
        reconfigure(changed)
        updatePill()
    }

    /// Reconfigures the cells on screen for these rows; off-screen rows
    /// pick up their content when they show.
    func reconfigure(_ changed: [AnyHashable]) {
        for id in changed {
            guard let indexPath = dataSource.indexPath(for: TranscriptRowID(id)),
                  let cell = collectionView.cellForItem(at: indexPath) as? TranscriptCell else { continue }
            configure(cell, id)
            measure([cell])
        }
    }

    /// "Row A is now row B": it keeps its measured height (and the anchor),
    /// so the swap that follows doesn't move anything.
    func carry(from old: AnyHashable, to new: AnyHashable) {
        layout.carryHeight(from: old, to: new)
        if anchor?.id == old { anchor?.id = new }
    }

    private func configure(_ cell: TranscriptCell, _ id: AnyHashable) {
        counters.configures += 1
        let view = content(id)
        // Its ideal height, as a lazy stack proposes: a row with a flexible
        // `frame(maxHeight:)` (a clamped long message) otherwise grows to
        // whatever height the sizing pass offers.
        cell.contentConfiguration = UIHostingConfiguration { view.fixedSize(horizontal: false, vertical: true).id(id) }
            .margins(.all, 0)
            .minSize(width: 0, height: 0)
    }

    /// Rows after the old last row: new at the end, for the pill's count.
    static func appendedCount(old: [AnyHashable], new: [AnyHashable]) -> Int {
        guard let last = old.last else { return 0 }
        guard let index = new.lastIndex(of: last) else { return 0 }
        return new.count - index - 1
    }

    private func rebaseAnchor(keeping live: Set<AnyHashable>) {
        guard let anchor, let index = layout.index(of: anchor.id) else { return }
        let top = collectionView.contentOffset.y + collectionView.contentInset.top
        let order = Array(layout.ids[index...]) + layout.ids[..<index].reversed()
        guard let survivor = order.first(where: live.contains), let frame = layout.frame(of: survivor) else {
            self.anchor = nil
            return
        }
        self.anchor = .init(id: survivor, distance: frame.minY - top)
    }

    // MARK: Requests

    /// Follows the end from now on, and goes there: from far up, a jump to a
    /// screen above the end (which lays the end out), then a short animation.
    func jumpToLatest(animated: Bool = true) {
        loadViewIfNeeded()
        pendingScroll = nil
        if follow.handle(.jumpToLatest) { followChanged() }
        log?("v2 jumpToLatest animated=\(animated)")
        let target = restingOffset()
        let height = collectionView.bounds.height
        if !animated || collectionView.window == nil {
            write(target, "jump")
            return
        }
        if target - collectionView.contentOffset.y > height * 2 {
            write(target - height, "jump near the end")
            collectionView.layoutIfNeeded()
        }
        animate(to: restingOffset())
        updatePill()
    }

    /// Takes the reader to a row (a find match, the unread row): reading from
    /// there, with the row at the top or centred.
    func scrollTo(_ id: AnyHashable, position: TranscriptRowPosition, animated: Bool = false) {
        loadViewIfNeeded()
        collectionView.layoutIfNeeded()
        guard let frame = layout.frame(of: id) else {
            // Not in yet (the first unread, before its page lands): go there when it is.
            pendingScroll = (id, position)
            log?("v2 scrollTo \(describe(id)) waits for its row")
            return
        }
        pendingScroll = nil
        if follow.handle(.readRow) { followChanged() }
        let visible = collectionView.bounds.height - collectionView.contentInset.top - collectionView.contentInset.bottom
        let distance = position == .top ? 0 : max(0, (visible - frame.height) / 2)
        anchor = .init(id: id, distance: distance)
        log?("v2 scrollTo \(describe(id)) \(position)")
        if animated { animate(to: restingOffset()) } else { write(restingOffset(), "scrollTo") }
        updatePill()
    }

    // MARK: The one writer

    private var interacting: Bool {
        collectionView.isTracking || collectionView.isDragging || collectionView.isDecelerating || simulatedReaderScroll
    }
    private var simulatedReaderScroll = false

    /// The harness's stand-in for a reader's drag: moves the view as a
    /// finger would, then rests, so `follow` decides as for a real one.
    func simulateReaderScroll(to y: CGFloat, beforeLayout: () -> Void = {}) {
        simulatedReaderScroll = true
        collectionView.contentOffset.y = clamp(y)
        scrollViewDidScroll(collectionView)
        beforeLayout()
        collectionView.layoutIfNeeded()
        simulatedReaderScroll = false
        readerScrollEnded()
    }

    /// The end is held: following, and no scroll of the reader's or ours in the way.
    private var holdsEnd: Bool { follow.mode == .following && !interacting && !animating }

    private func bounds(contentHeight: CGFloat? = nil) -> (content: CGFloat, height: CGFloat, top: CGFloat, bottom: CGFloat) {
        (contentHeight ?? layout.collectionViewContentSize.height, collectionView.bounds.height,
         collectionView.contentInset.top, collectionView.contentInset.bottom)
    }

    var maxOffset: CGFloat {
        let b = bounds()
        return TranscriptGeometry.maxOffset(contentHeight: b.content, boundsHeight: b.height, topInset: b.top, bottomInset: b.bottom)
    }

    private func clamp(_ y: CGFloat) -> CGFloat {
        let b = bounds()
        return TranscriptGeometry.clamp(y, contentHeight: b.content, boundsHeight: b.height, topInset: b.top, bottomInset: b.bottom)
    }

    /// Where the view belongs now: the end while following, the anchor while reading.
    func restingOffset() -> CGFloat {
        switch follow.mode {
        case .following:
            return maxOffset
        case .reading:
            guard Self.anchorsReading, let anchor, let frame = layout.frame(of: anchor.id) else { return clamp(collectionView.contentOffset.y) }
            return clamp(TranscriptGeometry.offset(restoring: anchor.distance, rowTop: frame.minY, topInset: collectionView.contentInset.top))
        }
    }

    /// Puts the view on its anchor after a layout pass, unless a scroll is under way.
    func settle(_ why: String) {
        guard isViewLoaded, collectionView.bounds.height > 0, !interacting, !animating else { return }
        let target = restingOffset()
        if abs(target - collectionView.contentOffset.y) > 0.25 { write(target, why) }
    }

    /// A `v2 geo` line in the scroll log, as the old transcript's `geo`
    /// lines: offset, content, insets, how far past the end (positive is
    /// blank) and the rows on screen. Only when something changed.
    private func logGeometry() {
        guard let log else { return }
        let b = bounds()
        let past = -TranscriptGeometry.distanceToEnd(offset: collectionView.contentOffset.y, contentHeight: b.content,
                                                     boundsHeight: b.height, bottomInset: b.bottom)
        let visible = collectionView.indexPathsForVisibleItems.map(\.item).sorted()
        let ids = [visible.first, visible.last].compactMap { $0 }.compactMap { layout.ids.indices.contains($0) ? describe(layout.ids[$0]) : nil }
        let line = String(format: "v2 geo offset=%.1f content=%.1f container=%.1f insetTop=%.1f insetBottom=%.1f past=%.1f",
                          collectionView.contentOffset.y, b.content, b.height, b.top, b.bottom, past)
            + " rows=\(visible.count) follow=\(follow.mode) visible=\(ids.joined(separator: "…"))"
        guard line != lastGeometry else { return }
        lastGeometry = line
        log(line)
    }
    private var lastGeometry = ""

    private func write(_ y: CGFloat, _ why: String) {
        let target = clamp(y)
        counters.offsetWrites += 1
        log?(String(format: "v2 offset %@ from %.1f to %.1f follow=%@", why, collectionView.contentOffset.y, target, "\(follow.mode)"))
        collectionView.contentOffset = CGPoint(x: collectionView.contentOffset.x, y: target)
    }

    /// Our own animated scroll, a frame at a time toward the live resting
    /// offset. UIKit's animated `setContentOffset` aims at a fixed point:
    /// worked out from estimated heights, it ran 2,400 pt past the end in
    /// the replay when the rows measured shorter. Here each frame is the
    /// current target less what's left of the starting distance, clamped,
    /// so it lands on the measured end and never passes it.
    private func animate(to y: CGFloat) {
        let distance = clamp(y) - collectionView.contentOffset.y
        guard abs(distance) > 0.5 else { return }
        animation?.invalidate()
        animating = true
        animationToken += 1
        animationStart = CACurrentMediaTime()
        animationDistance = distance
        let link = CADisplayLink(target: TranscriptDisplayLinkTarget { [weak self] in self?.animationFrame() }, selector: #selector(TranscriptDisplayLinkTarget.tick))
        link.add(to: .main, forMode: .common)
        animation = link
    }

    private var animation: CADisplayLink?
    private var animationStart: CFTimeInterval = 0
    private var animationDistance: CGFloat = 0
    private static let animationDuration: CFTimeInterval = 0.3

    private func animationFrame() {
        guard animating else { return stopAnimation() }
        let progress = min(1, (CACurrentMediaTime() - animationStart) / Self.animationDuration)
        let eased = 1 - pow(1 - progress, 3)
        let target = restingOffset()
        let y = clamp(target - animationDistance * (1 - eased))
        counters.offsetWrites += 1
        collectionView.contentOffset = CGPoint(x: collectionView.contentOffset.x, y: y)
        if progress >= 1 { animationEnded("ended") }
    }

    private func stopAnimation() {
        animation?.invalidate()
        animation = nil
    }

    private func animationEnded(_ why: String) {
        stopAnimation()
        guard animating else { return }
        animating = false
        log?("v2 animation ended \(why)")
        settle("after animation")
        updatePill()
    }

    // MARK: TranscriptLayoutAnchoring

    #if DEBUG
    /// The harness's control run: no anchoring while reading, to show its checks catch the drift.
    static var anchorsReading = ProcessInfo.processInfo.environment["TRANSCRIPT_CONTROL_NO_ANCHOR"] == nil
    #else
    static let anchorsReading = true
    #endif

    func offsetAdjustment(resizing index: Int, frame: CGRect, by delta: CGFloat, in layout: TranscriptListLayout) -> CGFloat {
        guard delta != 0, let collectionView else { return 0 }
        guard Self.anchorsReading || holdsEnd else { return 0 }
        if holdsEnd {
            let b = bounds(contentHeight: layout.contentHeight + delta)
            let end = TranscriptGeometry.maxOffset(contentHeight: b.content, boundsHeight: b.height, topInset: b.top, bottomInset: b.bottom)
            return end - collectionView.contentOffset.y
        }
        // Reading, or a scroll under way: a row above the anchor (wholly
        // above what the reader sees, or across its top edge, as rows are
        // when a drag up brings them in) grows upward, so what the reader
        // sees stays put.
        let top = collectionView.contentOffset.y + collectionView.contentInset.top
        return frame.minY < top - 0.5 ? delta : 0
    }

    func targetOffset(proposed: CGPoint, in layout: TranscriptListLayout) -> CGPoint {
        guard collectionView != nil, collectionView.bounds.height > 0 else { return proposed }
        if interacting, Self.anchorsReading, let anchor, let frame = layout.frame(of: anchor.id) {
            return CGPoint(x: proposed.x, y: TranscriptGeometry.offset(restoring: anchor.distance, rowTop: frame.minY, topInset: collectionView.contentInset.top))
        }
        guard Self.anchorsReading || follow.mode == .following else { return proposed }
        return CGPoint(x: proposed.x, y: restingOffset())
    }

    // MARK: Layout passes

    private func transcriptDidLayout() {
        if animating { counters.animationLayouts += 1 } else { counters.layouts += 1 }
        measureStaleCells()
        #if DEBUG
        log?(String(format: "v2 layout offset=%.1f content=%.1f tracking=%@ decel=%@", collectionView.contentOffset.y, collectionView.contentSize.height, "\(collectionView.isTracking)", "\(collectionView.isDecelerating)"))
        #endif
        settle("transcript layout")
        updatePill()
        checkNearTop()
    }

    /// UIKit sizes a cell when it shows and when it asks to, not when only
    /// the width changes, and a measure taken before SwiftUI applied a new
    /// configuration is the old size: rows kept heights 20 to 60 pt off
    /// (a short bubble stood 140 pt tall). After each transcript layout pass
    /// the rows on screen measure again, and any that changed by more than
    /// 1 pt go through the layout's own invalidation, so the anchor holds.
    /// About ten rows, only when something laid out; nothing at rest.
    private func measureStaleCells() {
        guard collectionView.bounds.width > 0 else { return }
        measure(collectionView.visibleCells)
        // SwiftUI can apply a new configuration after this pass; look once
        // more on the next turn. Nothing changed, nothing is written.
        guard !remeasureScheduled else { return }
        remeasureScheduled = true
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.remeasureScheduled = false
            self.measure(self.collectionView.visibleCells)
        }
    }
    private var remeasureScheduled = false
    private var measuring = false
    private var lastProbe: CGRect?

    /// Where the rows' content runs, in window coordinates: their leading and
    /// trailing edges (the composer lines up with them beside two pages).
    var rowsFrameInWindow: CGRect? {
        guard let window = view.window, let first = layout.frames.first else { return nil }
        let rect = CGRect(x: first.minX, y: 0, width: first.width, height: collectionView.bounds.height)
        return collectionView.convert(rect.offsetBy(dx: 0, dy: collectionView.contentOffset.y), to: window)
    }

    /// These rows measured now. Any that changed by more than 1 pt take
    /// their new heights together, in one invalidation: one layout pass
    /// however many rows changed. Reading (or under the reader's finger),
    /// the view moves by what changed above the top, so nothing on screen
    /// moves; following, the settle after the pass keeps the end.
    private func measure(_ cells: [UICollectionViewCell]) {
        guard collectionView.bounds.width > 0 else { return }
        var sizes: [(index: Int, height: CGFloat)] = []
        for cell in cells {
            guard let cell = cell as? TranscriptCell, let indexPath = collectionView.indexPath(for: cell),
                  layout.ids.indices.contains(indexPath.item),
                  let original = layout.layoutAttributesForItem(at: indexPath), original.size.width > 0 else { continue }
            let fitted = cell.preferredLayoutAttributesFitting(original).size.height
            if abs(fitted - original.size.height) > 1 { sizes.append((indexPath.item, fitted)) }
        }
        guard !sizes.isEmpty else { return }
        measuring = true
        defer { measuring = false }
        let top = collectionView.contentOffset.y + collectionView.contentInset.top
        let moved = layout.applyHeights(sizes, above: top)
        layout.invalidateLayout(with: TranscriptListLayout.Context())
        if !holdsEnd, moved.aboveTop != 0 {
            counters.offsetWrites += 1
            collectionView.contentOffset.y += moved.aboveTop
        }
    }

    /// Visible rows whose height isn't what they measure now, for the harness.
    func misfitRows() -> [(id: AnyHashable, layout: CGFloat, fitted: CGFloat)] {
        collectionView.visibleCells.compactMap { cell in
            guard let cell = cell as? TranscriptCell, let indexPath = collectionView.indexPath(for: cell),
                  let original = layout.layoutAttributesForItem(at: indexPath) else { return nil }
            let fitted = cell.preferredLayoutAttributesFitting(original).size.height
            return abs(fitted - original.size.height) > 1 ? (layout.ids[indexPath.item], original.size.height, fitted) : nil
        }
    }

    // MARK: Scrolling

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        // Only the reader's own movement moves the anchor. The offset also
        // moves inside a layout pass, where rows coming into view size
        // themselves and the anchor is being held: taken again there, an
        // adjustment that missed stayed for good (24 pt in the replay).
        if interacting, !collectionView.isLayingOut, !measuring {
            anchor = TranscriptGeometry.readingAnchor(ids: layout.ids, frames: layout.frames,
                offset: scrollView.contentOffset.y, topInset: scrollView.contentInset.top)
        }
        updatePill()
        checkNearTop()
    }

    func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
        if animating { animating = false; stopAnimation() }
    }

    func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
        if !decelerate { readerScrollEnded() }
    }

    func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) { readerScrollEnded() }

    func scrollViewDidScrollToTop(_ scrollView: UIScrollView) { readerScrollEnded() }


    private var distanceToEnd: CGFloat {
        let b = bounds()
        return TranscriptGeometry.distanceToEnd(offset: collectionView.contentOffset.y, contentHeight: b.content,
            boundsHeight: b.height, bottomInset: b.bottom)
    }

    /// The reader decides: where their scroll comes to rest, near the end
    /// follows it, anywhere else reads from there.
    private func readerScrollEnded() {
        let near = distanceToEnd <= chrome.nearEnd
        log?(String(format: "v2 reader scroll ended distance=%.1f near=%@", distanceToEnd, "\(near)"))
        if follow.handle(.readerScrollEnded(nearEnd: near)) { followChanged() }
        defer { logGeometry() }
        if follow.mode == .following {
            animate(to: maxOffset)
        } else if anchor == nil || layout.frame(of: anchor!.id) == nil {
            anchor = TranscriptGeometry.readingAnchor(ids: layout.ids, frames: layout.frames,
                offset: collectionView.contentOffset.y, topInset: collectionView.contentInset.top)
        } else {
            // Where the reader left it: back on the anchor if a layout moved it.
            settle("reader rest")
        }
        updatePill()
    }

    private func followChanged() {
        counters.followChanges += 1
        log?("v2 follow \(follow.mode) unseen=\(follow.unseen)")
        onFollowChange?(follow)
    }

    private func updatePill() {
        guard isViewLoaded else { return }
        let next = TranscriptPillState(shown: follow.mode == .reading && distanceToEnd > chrome.nearEnd, unseen: follow.unseen,
                                       note: pillNote)
        guard next != pill else { return }
        let placementChanged = next.shown != pill.shown
        pill = next
        pillHost.rootView = pillContent(next) { [weak self] in self?.jumpToLatest() }
        pillHost.view.isUserInteractionEnabled = next.shown
        UIView.animate(withDuration: 0.2) { self.pillHost.view.alpha = next.shown ? 1 : 0 }
        if placementChanged, chrome.pill == .center { view.setNeedsLayout() }
        onPillChange?(next)
    }

    /// Something waiting at the end, for the pill ("Question"). It doesn't
    /// move the reader: following changes only on what they do.
    var pillNote: String? {
        didSet { if pillNote != oldValue { updatePill() } }
    }

    private func checkNearTop() {
        guard nearTopArmed, !ids.isEmpty, collectionView.bounds.height > 0 else { return }
        let top = collectionView.contentOffset.y + collectionView.contentInset.top
        guard top < chrome.nearTop else { return }
        nearTopArmed = false
        log?(String(format: "v2 near top %.1f", top))
        onNearTop?()
    }

    // MARK: Tap to close the keyboard

    @objc private func tappedTranscript(_ recognizer: UITapGestureRecognizer) {
        guard recognizer.state == .ended else { return }
        // After the tap's own handlers: a text link acts as the touch ends,
        // and resigning in the same pass dropped it.
        guard let window = view.window else { return }
        dismissKeyboard(window)
    }

    func gestureRecognizer(_ recognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }

    // MARK: Harness

    func resetCounters() {
        counters = Counters()
    }

    var composerFrame: CGRect { composerHost.view.frame }
    var isAnimating: Bool { animating }
    var pillFrame: CGRect { pillHost.view.frame }
}

/// A row's id as the diffable data source holds it. Swift 6 requires the
/// snapshot's item identifiers to be `Sendable`, and `AnyHashable` isn't.
/// The wrapper is `@unchecked Sendable` because the snapshot is built,
/// applied and read only on the main actor (the controller is
/// `@MainActor`), and the ids are the app's own values (BB's are `String`s).
/// The rest of the API keeps `AnyHashable`; nothing else changes.
struct TranscriptRowID: Hashable, @unchecked Sendable {
    let id: AnyHashable
    init(_ id: AnyHashable) { self.id = id }
}

/// A display link holds its target strongly; this breaks the cycle.
private final class TranscriptDisplayLinkTarget: NSObject {
    let frame: () -> Void
    init(_ frame: @escaping () -> Void) { self.frame = frame }
    @objc func tick() { frame() }
}

/// Lays out, then tells the controller, which settles the view on its anchor.
final class TranscriptCollectionView: UICollectionView {
    var didLayout: (() -> Void)?
    /// Inside UIKit's own layout pass (cells sizing themselves).
    private(set) var isLayingOut = false

    override func layoutSubviews() {
        isLayingOut = true
        super.layoutSubviews()
        isLayingOut = false
        didLayout?()
    }
}

/// A row: its SwiftUI content, as tall as it measures at the row's width.
final class TranscriptCell: UICollectionViewCell {
    override func preferredLayoutAttributesFitting(_ attributes: UICollectionViewLayoutAttributes) -> UICollectionViewLayoutAttributes {
        let fitted = attributes.copy() as! UICollectionViewLayoutAttributes
        // A just-set configuration lands in SwiftUI on layout; measure after it.
        let width = attributes.size.width
        contentView.layoutIfNeeded()
        let size = contentView.systemLayoutSizeFitting(
            CGSize(width: width, height: UIView.layoutFittingCompressedSize.height),
            withHorizontalFittingPriority: .required, verticalFittingPriority: .fittingSizeLevel)
        fitted.size = CGSize(width: width, height: TranscriptListLayout.pixel(size.height))
        return fitted
    }
}

/// SwiftUI chrome in the container: its height measured at its width, set
/// as a constraint, so wrapping text sizes it right.
final class TranscriptHost: UIHostingController<AnyView> {
    init() {
        super.init(rootView: AnyView(EmptyView()))
        sizingOptions = .intrinsicContentSize
        // Placed by the container; SwiftUI doesn't add the safe area again.
        safeAreaRegions = []
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        view.setContentHuggingPriority(.defaultLow, for: .vertical)
        view.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
    }

    /// Its intrinsic size changing (the composer grew a line) lays out the
    /// container, which measures again at the real width.
    func measure(width: CGFloat) -> CGFloat {
        guard width > 0 else { return 0 }
        return TranscriptListLayout.pixel(sizeThatFits(in: CGSize(width: width, height: .greatestFiniteMagnitude)).height)
    }
}
