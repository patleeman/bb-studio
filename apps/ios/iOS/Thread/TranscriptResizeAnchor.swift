import SwiftUI

/// Observes positions during reading, but only requests a restore when width
/// changes. Height changes (including the keyboard) never request a restore.
@MainActor
final class TranscriptResizeAnchor {
    struct Viewport: Equatable {
        var size: CGSize
        var offset: CGFloat
        var inset: CGFloat
        var bottomGap: CGFloat
        var contentHeight: CGFloat
        var bottomInset: CGFloat = 0
    }
    struct Row: Equatable {
        var width: CGFloat
        var frame: CGRect
        var isMessage = true
    }
    enum Anchor: Equatable {
        case bottom
        case message(String, offset: CGFloat)
    }
    private(set) var viewport: Viewport?
    var frame: CGRect = .zero
    private var rows: [CGFloat: [String: Row]] = [:]
    private var pendingWidth: CGFloat?
    private var pendingRows: [String: Row] = [:]
    private var visibleIDs: Set<String>?
    private var saved: Anchor?
    private(set) var restoring = false
    private(set) var generation = 0
    #if DEBUG
    private var lastRequested: Anchor?
    #endif

    func measure(_ id: String, row: Row) {
        #if DEBUG
        RenderCount.bump("anchor.measure")
        #endif
        let width = key(row.width)
        if let viewport, width != key(viewport.size.width) {
            // Row geometry for the next width may precede ScrollGeometry.
            // Start a fresh bucket rather than reusing a previous fold's rows.
            if pendingWidth != width { pendingWidth = width; pendingRows = [:] }
            pendingRows[id] = row
            return
        }
        rows[width, default: [:]][id] = row
        remember()
    }

    func visible(_ ids: [String]) {
        visibleIDs = Set(ids)
        remember()
    }

    func forget(_ id: String) {
        for width in Array(rows.keys) { rows[width]?.removeValue(forKey: id) }
        pendingRows.removeValue(forKey: id)
        remember()
    }

    func update(_ next: Viewport) -> Anchor? {
        let changed = viewport.map { abs($0.size.width - next.size.width) > 0.5 } ?? false
        let anchor = changed ? (saved ?? .bottom) : nil
        if changed {
            rows = [key(next.size.width): pendingWidth == key(next.size.width) ? pendingRows : [:]]
            pendingWidth = nil
            pendingRows = [:]
        }
        viewport = next
        if changed, let anchor {
            #if DEBUG
            lastRequested = anchor
            #endif
            restoring = true
            generation += 1
            return anchor
        }
        remember()
        return nil
    }

    func correction(for id: String, offset: CGFloat) -> CGFloat? {
        guard let viewport, let row = rows[key(viewport.size.width)]?[id] else { return nil }
        // ScrollPosition's point is measured from the content's inset origin;
        // ScrollGeometry.contentOffset includes the negative top inset.
        let target = viewport.offset + viewport.inset + row.frame.minY - offset
        let maximum = Self.lastPoint(contentHeight: viewport.contentHeight, viewportHeight: viewport.size.height)
        guard target.isFinite, target >= 0, target <= maximum else { return nil }
        return target
    }

    func alignment(for id: String, offset: CGFloat) -> CGFloat? {
        guard correction(for: id, offset: offset) != nil, let viewport,
              let row = rows[key(viewport.size.width)]?[id] else { return nil }
        let distance = viewport.size.height - row.frame.height
        guard abs(distance) > 1 else { return nil }
        // The SwiftUI frame already starts at the unobscured origin. Adding
        // ScrollGeometry's top inset here would apply the header twice.
        let alignment = (offset - frame.minY) / distance
        return alignment.isFinite ? alignment : nil
    }

    func finish(_ token: Int) {
        guard token == generation else { return }
        restoring = false
        remember()
    }

    func cancel() {
        generation += 1
        restoring = false
        remember()
    }

    /// How far the bottom of what the reader sees (above the composer and
    /// keyboard) runs below the last row. Any of it is blank screen: closing
    /// the keyboard shrinks the bottom inset and leaves the offset where it
    /// was, a band of black the height of the keyboard. Content shorter than
    /// the viewport sits at the top, so nothing is past its end.
    static func overshoot(contentHeight: CGFloat, viewportHeight: CGFloat, visibleBottom: CGFloat) -> CGFloat {
        guard contentHeight > viewportHeight else { return 0 }
        return max(0, visibleBottom - contentHeight)
    }

    /// The furthest valid `ScrollPosition` point: the last row at the bottom
    /// of the viewport. Points are measured from the content's inset origin,
    /// and `viewportHeight` leaves the insets out.
    static func lastPoint(contentHeight: CGFloat, viewportHeight: CGFloat) -> CGFloat {
        max(0, contentHeight - viewportHeight)
    }

    var hasVisibleRows: Bool {
        guard let viewport else { return false }
        return rows[key(viewport.size.width), default: [:]].contains { id, row in
            isVisible(id, row: row, viewport: viewport)
        }
    }

    private func isVisible(_ id: String, row: Row, viewport: Viewport) -> Bool {
        (visibleIDs?.contains(id) ?? true) && row.frame.minY.isFinite
            && row.frame.maxY > frame.minY && row.frame.minY < frame.minY + viewport.size.height
    }


    #if DEBUG
    var debugState: String { "requested=\(String(describing: lastRequested)) saved=\(String(describing: saved)) visible=\(String(describing: visibleIDs)) viewport=\(String(describing: viewport)) frame=\(frame) restoring=\(restoring)" }
    #endif

    private func key(_ width: CGFloat) -> CGFloat { (width * 2).rounded() / 2 }

    private func remember() {
        guard !restoring, pendingWidth == nil, let viewport, viewport.size.height > 0, viewport.contentHeight > 0 else { return }
        // Match the transcript's existing near-bottom / Jump to latest threshold.
        if viewport.bottomGap <= 120 || visibleIDs?.contains("timeline-bottom") == true {
            saved = .bottom
        } else if let row = rows[key(viewport.size.width), default: [:]].filter({ $0.value.isMessage && isVisible($0.key, row: $0.value, viewport: viewport) })
            .min(by: { $0.value.frame.minY < $1.value.frame.minY }) {
            saved = .message(row.key, offset: row.value.frame.minY)
        }
        // Lazy visibility can briefly be empty before the new width is
        // reported. Keep the last known reading anchor through that gap;
        // the restore still validates its new geometry before using it.
    }
}
