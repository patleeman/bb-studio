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
    }
    struct Row: Equatable {
        var width: CGFloat
        var frame: CGRect
    }
    enum Anchor: Equatable {
        case bottom
        case message(String, offset: CGFloat)
    }
    private(set) var viewport: Viewport?
    private var rows: [CGFloat: [String: Row]] = [:]
    private var saved: Anchor?
    private(set) var restoring = false
    private(set) var generation = 0

    func measure(_ id: String, row: Row) {
        rows[key(row.width), default: [:]][id] = row
        remember()
    }

    func update(_ next: Viewport) -> Anchor? {
        let changed = viewport.map { abs($0.size.width - next.size.width) > 0.5 } ?? false
        let anchor = changed ? saved : nil
        if changed { rows = rows.filter { $0.key == key(next.size.width) } }
        viewport = next
        if changed, let anchor {
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
        return viewport.offset + viewport.inset + row.frame.minY - offset
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

    private func key(_ width: CGFloat) -> CGFloat { (width * 2).rounded() / 2 }

    private func remember() {
        guard !restoring, let viewport else { return }
        if viewport.bottomGap <= 2 {
            saved = .bottom
        } else if let row = rows[key(viewport.size.width), default: [:]].filter({ $0.value.frame.maxY > 0 })
            .min(by: { $0.value.frame.minY < $1.value.frame.minY }) {
            saved = .message(row.key, offset: row.value.frame.minY)
        }
    }
}
