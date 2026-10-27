#if DEBUG
import SwiftUI
import UIKit

/// A deterministic, offline replay of what a chat does to its transcript:
/// streaming, bursts, a long history paged in from the top, images and
/// cards that resize, the keyboard, folds, splits and window resizes. After
/// every step it checks the rules the old transcript broke:
///
/// - never past the end (offset ≤ max + 0.5);
/// - following: the last row whole, just above the composer;
/// - reading: the anchor row's screen y moves < 1 pt through prepends and
///   height changes above the viewport;
/// - the composer's gap is the layout's;
/// - bounded layout passes and writes per step, and none at rest.
///
/// Runs in a unit test's window (simulated keyboard), or in the app with
/// `-qaTranscriptReplay` (the real keyboard, for UI tests).
@MainActor
final class TranscriptReplay {
    struct Row: Identifiable, Equatable {
        enum Kind: Equatable {
            case text(String, mine: Bool)
            case image(loaded: Bool)
            case card(expanded: Bool)
            case status(String)
        }
        var id: String
        var kind: Kind
    }

    struct Step: Codable, Equatable {
        var name: String
        var mode: String
        var pastEnd: Double
        var followGap: Double?
        var anchorDrift: Double?
        var composerGapError: Double
        var layouts: Int
        var offsetWrites: Int
        var insetWrites: Int
        var restLayouts: Int
        var restWrites: Int
        var failures: [String]
    }

    struct Report: Codable, Equatable {
        var layout: String
        var steps: [Step]
        var failures: [String] { steps.flatMap { step in step.failures.map { "\(step.name): \($0)" } } }
        var maxPastEnd: Double { steps.map(\.pastEnd).max() ?? 0 }
        var maxFollowGap: Double { steps.compactMap(\.followGap).map(abs).max() ?? 0 }
        var maxAnchorDrift: Double { steps.compactMap(\.anchorDrift).map(abs).max() ?? 0 }
        var maxComposerGapError: Double { steps.map(\.composerGapError).map(abs).max() ?? 0 }
        var maxLayouts: Int { steps.map(\.layouts).max() ?? 0 }
        var maxWrites: Int { steps.map(\.offsetWrites).max() ?? 0 }
        var restWrites: Int { steps.map(\.restWrites).reduce(0, +) }
        var restLayouts: Int { steps.map(\.restLayouts).reduce(0, +) }

        var summary: String {
            String(format: "%@: %d steps, past end max %.2f pt, follow gap max %.2f pt, anchor drift max %.2f pt, composer gap error max %.2f pt, layouts/step max %d, offset writes/step max %d, writes at rest %d, no-op layouts at rest %d, failures %d",
                   layout, steps.count, maxPastEnd, maxFollowGap, maxAnchorDrift, maxComposerGapError, maxLayouts, maxWrites, restWrites, restLayouts, failures.count)
        }
    }

    /// A screen to replay on: its window size and how the composer rests.
    struct Layout {
        var name: String
        var size: CGSize
        var chrome = TranscriptChrome()
        var safeBottom: CGFloat = 34

        static let phone = Layout(name: "phone", size: CGSize(width: 402, height: 874))
        static let duoOuter = Layout(name: "duo-outer", size: CGSize(width: 466, height: 678))
        static var duoInner: Layout {
            var chrome = TranscriptChrome()
            chrome.composerIgnoresBottomSafeArea = true
            chrome.composerIgnoresTrailingSafeArea = true
            chrome.pill = .center
            return Layout(name: "duo-inner", size: CGSize(width: 475, height: 669), chrome: chrome)
        }
    }

    let controller = TranscriptController()
    private let window: UIWindow
    private var layout: Layout
    private var rows: [Row] = []
    /// The older history, paged in from the top: 3,000 rows in all.
    private var older: [Row] = []
    private var steps: [Step] = []
    private var keyboard: CGFloat = 0
    private var serial = 0
    /// Real keyboard (in the app) rather than a simulated one.
    private let realKeyboard: UITextField?

    init(window: UIWindow, layout: Layout, realKeyboard: UITextField? = nil) {
        self.window = window
        self.layout = layout
        self.realKeyboard = realKeyboard
        controller.chrome = layout.chrome
        controller.content = { [unowned self] id in
            guard let row = byID[id as? String ?? ""] else { return AnyView(EmptyView()) }
            return AnyView(ReplayRowView(row: row))
        }
        controller.pillContent = { state, jump in
            AnyView(Button(state.unseen > 0 ? "\(state.unseen) new" : "Latest", action: jump).buttonStyle(.borderedProminent).padding(8))
        }
        controller.setComposer(AnyView(ReplayComposer()))
        if ProcessInfo.processInfo.environment["TRANSCRIPT_LOG"] != nil {
            let started = Date()
            controller.log = { print(String(format: "TRANSCRIPT-LOG %.3f ", Date().timeIntervalSince(started)) + $0) }
        }
    }

    private var byID: [String: Row] = [:]

    // MARK: The script

    func run() async -> Report {
        window.frame = CGRect(origin: .zero, size: layout.size)
        window.rootViewController = controller
        window.makeKeyAndVisible()
        await settle()

        let history = (0..<3000).map { makeRow(index: $0) }
        older = Array(history.prefix(2880))
        await step("open at the end of 120 rows") { set(Array(history.suffix(120))) }

        // Streaming into one row, token by token.
        let streamID = nextID("stream")
        await step("a reply starts") { set(rows + [Row(id: streamID, kind: .text("", mine: false))]) }
        for token in 0..<60 {
            await step("token \(token)", quiet: true) { grow(streamID, by: token) }
        }
        await step("a burst of 40") { set(rows + (0..<40).map { _ in makeRow(index: serial * 7, id: nextID("burst")) }) }
        await step("keyboard up") { setKeyboard(320) }
        await step("a reply with the keyboard up") { set(rows + [Row(id: nextID("kb"), kind: .text(Self.words(30), mine: false))]) }
        await step("keyboard down") { setKeyboard(0) }
        let image = nextID("image")
        await step("an image row") { set(rows + [Row(id: image, kind: .image(loaded: false))]) }
        await step("the image loads") { replace(image, .image(loaded: true)) }
        let card = nextID("card")
        await step("a question card") { set(rows + [Row(id: card, kind: .card(expanded: false))]) }
        await step("the card opens") { replace(card, .card(expanded: true)) }
        await step("fold to the outer screen") { resize(Layout.duoOuter) }
        await step("unfold to the inner screen") { resize(Layout.duoInner) }
        await step("back to this screen") { resize(layout) }

        // A fling up from the end that UIKit cuts short without saying so,
        // then anything that lays out (here the keyboard): the reader stays
        // where the fling left them (Patrick, Oct 27: "I scroll up, touch
        // something and it scrolls down").
        await step("a fling up from the end, cut short", expectReading: true, anchorAfterChange: true) {
            controller.simulateFlingCutShort(to: controller.collectionView.contentOffset.y - 1500)
        }
        await step("then the keyboard, after the cut-short fling", expectReading: true) { setKeyboard(320) }
        await step("and down again", expectReading: true) { setKeyboard(0) }
        await step("back to the end") { controller.jumpToLatest(animated: false) }

        // Reading: the reader scrolls up into the history.
        await step("the reader scrolls up", expectReading: true) { readerScroll(by: -1600) }
        // Up through the whole history: each scroll shows unmeasured rows
        // that size themselves above the reader; each time the top comes
        // near, `onNearTop` asks for the next page, which goes in above.
        var nearTop = false
        controller.onNearTop = { nearTop = true }
        var page = 0
        while !older.isEmpty, page < 120 {
            await step("scroll up into unmeasured rows \(page)", expectReading: true, anchorAfterChange: true) { readerScroll(by: -6000) }
            if nearTop {
                nearTop = false
                await step("prepend page \(page)", expectReading: true) { prepend(200) }
            }
            page += 1
        }
        if !older.isEmpty { steps.append(Step(name: "paging", mode: "", pastEnd: 0, followGap: nil, anchorDrift: nil, composerGapError: 0, layouts: 0, offsetWrites: 0, insetWrites: 0, restLayouts: 0, restWrites: 0, failures: ["\(older.count) rows never paged in"])) }
        await step("all 3,000 rows in", expectReading: true) {}
        if rows.count < 3000 { steps.append(Step(name: "history", mode: "", pastEnd: 0, followGap: nil, anchorDrift: nil, composerGapError: 0, layouts: 0, offsetWrites: 0, insetWrites: 0, restLayouts: 0, restWrites: 0, failures: ["only \(rows.count) rows"])) }
        await step("back down a little", expectReading: true, anchorAfterChange: true) { readerScroll(by: 3000) }
        await step("a card across the top edge opens", expectReading: true, anchorAfterChange: true) { openCardAcrossTheTop() }
        await step("a row above the top grows", expectReading: true) { growRowAbove() }
        await step("replies arrive while reading", expectReading: true) {
            set(rows + (0..<3).map { _ in Row(id: nextID("late"), kind: .text(Self.words(20), mine: false)) })
        }
        await step("keyboard up while reading", expectReading: true) { setKeyboard(320) }
        await step("keyboard down while reading", expectReading: true) { setKeyboard(0) }
        await step("fold while reading", expectReading: true, drift: 1.5) { resize(Layout.duoOuter) }
        await step("split while reading", expectReading: true, drift: 1.5) { resize(Layout.duoInner) }
        await step("unfold while reading", expectReading: true, drift: 1.5) { resize(layout) }
        await step("window shorter while reading", expectReading: true) { resizeHeight(-200) }
        await step("window back while reading", expectReading: true) { resizeHeight(200) }
        await step("background and back", expectReading: true) { background() }

        // Back to the end.
        await step("jump to latest") { controller.jumpToLatest() }
        await step("a reply streams at the end") { set(rows + [Row(id: nextID("end"), kind: .text(Self.words(80), mine: false))]) }
        await step("fold while following") { resize(Layout.duoOuter) }
        await step("keyboard up on the outer screen") { setKeyboard(270) }
        await step("keyboard down on the outer screen") { setKeyboard(0) }
        await step("unfold while following") { resize(layout) }
        await step("rows replaced by a newer page") { set(Array(rows.suffix(30)) + (0..<10).map { _ in makeRow(index: 7, id: nextID("page")) }) }
        await step("the reader scrolls a little and lets go near the end") { readerScroll(by: -40) }
        await step("a short chat in a sheet") { set(Array(rows.suffix(2))) }
        await step("the sheet grows") { resizeHeight(-300) }
        await step("the sheet is back") { resizeHeight(300) }

        return Report(layout: layout.name, steps: steps)
    }

    // MARK: Mutations

    private func set(_ next: [Row]) {
        let old = byID
        rows = next
        byID = Dictionary(next.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let changed = next.filter { row in old[row.id].map { $0 != row } ?? false }.map { AnyHashable($0.id) }
        controller.setRows(next.map { AnyHashable($0.id) }, changed: changed)
    }

    private func replace(_ id: String, _ kind: Row.Kind) {
        set(rows.map { $0.id == id ? Row(id: id, kind: kind) : $0 })
    }

    private func grow(_ id: String, by token: Int) {
        set(rows.map { row in
            guard row.id == id, case .text(let text, let mine) = row.kind else { return row }
            return Row(id: id, kind: .text(text + (text.isEmpty ? "" : " ") + Self.vocabulary[token % Self.vocabulary.count], mine: mine))
        })
    }

    private func prepend(_ count: Int) {
        let page = older.suffix(count)
        older.removeLast(page.count)
        set(Array(page) + rows)
    }

    /// A card across the top of what the reader sees opens. The reader's
    /// scroll first puts a row's middle at the top edge; then it opens, and
    /// grows downward without moving.
    private func openCardAcrossTheTop() {
        let view = controller.collectionView!
        let top = view.contentOffset.y + view.contentInset.top
        guard let index = controller.layout.frames.firstIndex(where: { $0.maxY > top + 4 }) else { return }
        let frame = controller.layout.frames[index]
        readerScroll(to: frame.midY - view.contentInset.top)
        let id = rows[index].id
        set(rows.map { $0.id == id ? Row(id: id, kind: .card(expanded: true)) : $0 })
    }

    /// The row just above the top, still on screen as a cell (prefetched),
    /// grows: everything the reader sees stays where it is.
    private func growRowAbove() {
        let view = controller.collectionView!
        let top = view.contentOffset.y + view.contentInset.top
        guard let index = controller.layout.frames.lastIndex(where: { $0.maxY <= top }),
              view.cellForItem(at: IndexPath(item: index, section: 0)) != nil else {
            // Not a cell yet: it will measure when it shows, which the paging steps cover.
            return
        }
        let id = rows[index].id
        set(rows.map { $0.id == id ? Row(id: id, kind: .card(expanded: true)) : $0 })
    }

    private func setKeyboard(_ height: CGFloat) {
        keyboard = height
        if let realKeyboard {
            if height > 0 { realKeyboard.becomeFirstResponder() } else { realKeyboard.resignFirstResponder() }
        } else {
            controller.simulatedKeyboard = height
        }
    }

    private func resize(_ next: Layout) {
        controller.chrome = next.chrome
        currentLayout = next
        window.frame = CGRect(origin: .zero, size: next.size)
    }

    private func resizeHeight(_ delta: CGFloat) {
        window.frame.size.height += delta
    }

    private func background() {
        window.isHidden = true
        window.layoutIfNeeded()
        window.isHidden = false
    }

    /// The reader's drag. The anchor to hold is the one where the drag
    /// left the view, taken before the rows it brings in have measured.
    private func readerScroll(by delta: CGFloat) {
        readerScroll(to: controller.collectionView.contentOffset.y + delta)
    }

    private func readerScroll(to y: CGFloat) {
        let view = controller.collectionView!
        controller.simulateReaderScroll(to: y) {
            if let id = controller.anchor?.id, let frame = controller.layout.frame(of: id) {
                scrolledAnchor = (id, frame.minY - view.contentOffset.y)
                let top = view.contentOffset.y + view.contentInset.top
                let index = controller.layout.index(of: id) ?? 0
                controller.log?(String(format: "replay scrolled: top=%.1f anchor=%@ minY=%.1f measured=%@ above=%@ measured=%@", top, "\(id)", frame.minY,
                    "\(controller.layout.isMeasured(id))", index > 0 ? "\(controller.layout.frames[index - 1])" : "-",
                    index > 0 ? "\(controller.layout.isMeasured(controller.layout.ids[index - 1]))" : "-"))
            }
        }
    }

    private var scrolledAnchor: (id: AnyHashable, y: CGFloat)?

    private var currentLayout: Layout?

    // MARK: Checks

    /// `anchorAfterChange`: the change is the reader's own scroll, so the
    /// anchor to hold is where it left the reader, through the self-sizing
    /// of the rows it showed.
    private func step(_ name: String, quiet: Bool = false, expectReading: Bool = false, drift allowed: CGFloat = 1,
                      anchorAfterChange: Bool = false, _ change: () -> Void) async {
        let view = controller.collectionView!
        var anchorID = controller.anchor?.id
        var anchorY = anchorID.flatMap { controller.layout.frame(of: $0) }.map { $0.minY - view.contentOffset.y }
        let resizesBefore = controller.resizes
        controller.resetCounters()
        scrolledAnchor = nil
        change()
        if anchorAfterChange {
            if let scrolledAnchor {
                (anchorID, anchorY) = (scrolledAnchor.id, scrolledAnchor.y)
            } else {
                anchorID = controller.anchor?.id
                anchorY = anchorID.flatMap { controller.layout.frame(of: $0) }.map { $0.minY - view.contentOffset.y }
            }
        }
        await settle()
        // UIKit lays out once more about 0.5 s after the offset moves (its
        // scroll indicator's timer), with nothing written: wait that out,
        // then nothing at all may happen.
        try? await Task.sleep(for: .milliseconds(700))
        let work = controller.counters
        controller.resetCounters()
        await rest()
        let atRest = controller.counters

        var failures: [String] = []
        let insets = view.contentInset
        let maxOffset = TranscriptGeometry.maxOffset(contentHeight: view.contentSize.height, boundsHeight: view.bounds.height,
            topInset: insets.top, bottomInset: insets.bottom)
        let past = Double(view.contentOffset.y - maxOffset)
        if past > 0.5 { failures.append(String(format: "past the end by %.1f pt", past)) }

        var followGap: Double?
        if controller.follow.mode == .following, let last = controller.layout.frames.last {
            // The last row whole and just above the composer, unless the chat is shorter than its view.
            let bottom = view.contentOffset.y + view.bounds.height - insets.bottom
            let short = view.contentSize.height + insets.top + insets.bottom <= view.bounds.height
            followGap = short ? 0 : Double(bottom - (last.maxY + controller.layout.metrics.bottom))
            if let gap = followGap, abs(gap) > 0.5 { failures.append(String(format: "following, but the end is %.1f pt off", gap)) }
            if last.height < view.bounds.height - insets.top - insets.bottom, last.minY < view.contentOffset.y + insets.top - 0.5, !short {
                failures.append("following, but the last row isn't whole")
            }
        }
        if expectReading, controller.follow.mode != .reading { failures.append("expected reading, is \(controller.follow.mode)") }

        var drift: Double?
        if expectReading, let anchorID, let anchorY, let frame = controller.layout.frame(of: anchorID) {
            let y = frame.minY - view.contentOffset.y
            // A clamp at an edge is allowed to move it; nothing else is.
            let clamped = abs(view.contentOffset.y - maxOffset) < 0.5 || abs(view.contentOffset.y + insets.top) < 0.5
            drift = Double(y - anchorY)
            if let drift, abs(drift) >= Double(allowed), !clamped {
                failures.append(String(format: "the anchor row moved %.2f pt", drift))
            }
        }

        // Every row on screen as tall as it measures at this width.
        for misfit in controller.misfitRows().prefix(3) {
            failures.append(String(format: "row %@ is %.1f pt, measures %.1f", "\(misfit.id)", misfit.layout, misfit.fitted))
        }

        let layout = currentLayout ?? self.layout
        let safeBottom = window.safeAreaInsets.bottom
        let expectedGap = layout.chrome.composerGap + keyboardHeight(safeBottom: safeBottom, layout: layout)
        let gapError = Double((controller.view.bounds.maxY - controller.composerFrame.maxY) - expectedGap)
        if abs(gapError) > 1 { failures.append(String(format: "composer gap off by %.1f pt", gapError)) }

        // Bounds in proportion to the rows that changed height in the step,
        // because how many rounds those take depends on timing, not on the
        // step: SwiftUI can apply a row's configuration a turn late, more so
        // under load (the full suite ran 51 passes where a quiet run took
        // 11). Each resized row may cost UIKit's sizing pass, the settle after
        // it and the next turn's re-check (3 passes), and a settle or an
        // adjustment (2 writes). A loop lays out without anything resizing,
        // so it can't stay under these. Our own animated scroll writes once a
        // frame for 0.3 s on top.
        let resized = controller.resizes - resizesBefore
        if work.layouts > 12 + 3 * resized { failures.append("\(work.layouts) layout passes for \(resized) resized rows") }
        let writes = 4 + 2 * resized + (work.animationLayouts > 0 ? 40 : 0)
        if work.offsetWrites > writes { failures.append("\(work.offsetWrites) offset writes for \(resized) resized rows") }
        // At rest nothing is written. UIKit or SwiftUI may still lay out once
        // or twice late with nothing to change: counted (`restLayouts`), and a
        // loop (more than 2) fails.
        if atRest.layouts > 2 || atRest.offsetWrites > 0 || atRest.insetWrites > 0 {
            failures.append("work at rest: \(atRest.layouts) layouts, \(atRest.offsetWrites) offset writes, \(atRest.insetWrites) inset writes")
        }
        let result = Step(name: name, mode: "\(controller.follow.mode)", pastEnd: max(0, past), followGap: followGap, anchorDrift: drift,
            composerGapError: gapError, layouts: work.layouts, offsetWrites: work.offsetWrites, insetWrites: work.insetWrites,
            restLayouts: atRest.layouts, restWrites: atRest.offsetWrites + atRest.insetWrites, failures: failures)
        if !quiet || !failures.isEmpty { steps.append(result) } else { steps.append(result) }
    }

    private func keyboardHeight(safeBottom: CGFloat, layout: Layout) -> CGFloat {
        if realKeyboard != nil {
            // The container ends at the keyboard; the composer rests on its bottom.
            return layout.chrome.composerIgnoresBottomSafeArea ? 0 : controller.view.safeAreaInsets.bottom
        }
        return keyboard + (layout.chrome.composerIgnoresBottomSafeArea ? 0 : safeBottom)
    }

    /// Lets layout, self-sizing and any animation run out.
    private func settle() async {
        var quiet = 0
        var last = controller.counters
        for _ in 0..<120 {
            window.layoutIfNeeded()
            try? await Task.sleep(for: .milliseconds(realKeyboard == nil ? 16 : 40))
            let now = controller.counters
            quiet = now == last && !controller.isAnimating ? quiet + 1 : 0
            last = now
            if quiet >= (realKeyboard == nil ? 6 : 15) { break }
        }
    }

    private func rest() async {
        controller.log?("rest begins")
        try? await Task.sleep(for: .milliseconds(500))
        window.layoutIfNeeded()
        controller.log?("rest ends")
    }

    // MARK: Rows

    private func nextID(_ prefix: String) -> String {
        serial += 1
        return "\(prefix)-\(serial)"
    }

    private func makeRow(index: Int, id: String? = nil) -> Row {
        let id = id ?? "h\(index)"
        switch index % 11 {
        case 3: return Row(id: id, kind: .image(loaded: index % 2 == 0))
        case 7: return Row(id: id, kind: .card(expanded: false))
        case 9: return Row(id: id, kind: .status("Reading the sources…"))
        default: return Row(id: id, kind: .text(Self.words(5 + (index * 37) % 90), mine: index % 4 == 1))
        }
    }

    private static let vocabulary = ["the", "transcript", "keeps", "its", "place", "while", "rows", "stream", "in,", "and", "nothing", "jumps."]
    static func words(_ count: Int) -> String {
        (0..<count).map { vocabulary[$0 % vocabulary.count] }.joined(separator: " ")
    }
}

/// The replay's rows: bubbles of wrapping text, images that load, cards
/// that open, status lines.
struct ReplayRowView: View {
    let row: TranscriptReplay.Row

    var body: some View {
        switch row.kind {
        case .text(let text, let mine):
            Text(text.isEmpty ? " " : text)
                .padding(.horizontal, 14).padding(.vertical, 9)
                .background(mine ? Color.accentColor.opacity(0.3) : Color.secondary.opacity(0.2), in: .rect(cornerRadius: 18))
                .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
                .padding(mine ? .leading : .trailing, 48)
        case .image(let loaded):
            RoundedRectangle(cornerRadius: 12).fill(.teal.opacity(0.5))
                .frame(width: 220, height: loaded ? 180 : 48)
                .frame(maxWidth: .infinity, alignment: .leading)
        case .card(let expanded):
            VStack(alignment: .leading, spacing: 8) {
                Text("Which one should go first?").font(.headline)
                if expanded {
                    ForEach(0..<4) { index in Text("Choice \(index + 1): " + TranscriptReplay.words(8)) }
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.orange.opacity(0.15), in: .rect(cornerRadius: 14))
        case .status(let text):
            Text(text).font(.footnote).foregroundStyle(.secondary).frame(maxWidth: .infinity)
        }
    }
}

private struct ReplayComposer: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 22).fill(.gray.opacity(0.25))
            .frame(height: 44)
            .overlay(Text("Message").foregroundStyle(.secondary).padding(.leading, 14), alignment: .leading)
            .padding(.horizontal, 12)
            .accessibilityIdentifier("replayComposer")
    }
}
#endif
