import CoreGraphics

/// Whether the transcript keeps its newest row in view.
///
/// It changes only on what the reader does: where their own scroll comes to
/// rest, and the "jump to latest" tap (or an explicit request standing in
/// for one, such as sending a message). Layout, insets, the keyboard and new
/// rows never change it. That is the rule the old SwiftUI transcript broke:
/// its geometry callbacks decided `following` too, so an app scroll cut
/// short by a layout change stopped following with no one touching the
/// screen.
public struct TranscriptFollow: Equatable, Sendable {
    public enum Mode: Equatable, Sendable {
        /// The newest row stays in view: the anchor is the end of the content.
        case following
        /// The reader is up in the history: the anchor is the top visible row.
        case reading
    }

    public enum Event: Equatable, Sendable {
        /// The reader's scroll came to rest: the drag ended without a fling,
        /// or the fling stopped. `nearEnd` is measured where it rested.
        case readerScrollEnded(nearEnd: Bool)
        /// The "jump to latest" pill, or a request that stands for it.
        case jumpToLatest
        /// The app took the reader to a row (a find match, the unread row).
        case readRow
        /// Rows were added after the last one the reader has seen.
        case appended(Int)
    }

    public private(set) var mode: Mode = .following
    /// Rows that came in at the end while reading, for the "new messages" pill.
    public private(set) var unseen = 0

    public init(mode: Mode = .following) { self.mode = mode }

    /// Applies one event; returns whether anything changed.
    @discardableResult
    public mutating func handle(_ event: Event) -> Bool {
        let before = self
        switch event {
        case .readerScrollEnded(let nearEnd):
            mode = nearEnd ? .following : .reading
        case .jumpToLatest:
            mode = .following
        case .readRow:
            mode = .reading
        case .appended(let count):
            if mode == .reading { unseen += max(0, count) }
        }
        if mode == .following { unseen = 0 }
        return self != before
    }
}

/// The scroll math, without a scroll view: the offsets that are valid, and
/// where an anchor puts the view after the content changes under it.
///
/// Offsets are `UIScrollView.contentOffset.y`: 0 is the content's top at
/// the scroll view's top edge, and the top inset (the header) makes the
/// first valid offset negative.
public enum TranscriptGeometry {
    /// The first valid offset: the content's top just under the header.
    public static func minOffset(topInset: CGFloat) -> CGFloat { -topInset }

    /// The last valid offset: the content's end just above the composer. A
    /// transcript shorter than its viewport rests at the top, so a short
    /// conversation in a half-height sheet has no gap above it.
    public static func maxOffset(contentHeight: CGFloat, boundsHeight: CGFloat, topInset: CGFloat, bottomInset: CGFloat) -> CGFloat {
        max(-topInset, contentHeight + bottomInset - boundsHeight)
    }

    public static func clamp(_ offset: CGFloat, contentHeight: CGFloat, boundsHeight: CGFloat, topInset: CGFloat, bottomInset: CGFloat) -> CGFloat {
        let high = maxOffset(contentHeight: contentHeight, boundsHeight: boundsHeight, topInset: topInset, bottomInset: bottomInset)
        guard offset.isFinite else { return high }
        return min(max(offset, -topInset), high)
    }

    /// How far the end of the content is below the bottom of what the
    /// reader sees (above the composer and keyboard). Negative is past the
    /// end: blank screen.
    public static func distanceToEnd(offset: CGFloat, contentHeight: CGFloat, boundsHeight: CGFloat, bottomInset: CGFloat) -> CGFloat {
        contentHeight - (offset + boundsHeight - bottomInset)
    }

    /// A row the reader is looking at, and how far its top is below the top
    /// of what they see. Kept through prepends and height changes above it.
    public struct Anchor<ID: Hashable>: Equatable {
        public var id: ID
        public var distance: CGFloat
        public init(id: ID, distance: CGFloat) {
            self.id = id
            self.distance = distance
        }
    }

    /// The offset that puts `anchor` back where the reader saw it, given
    /// the row's top in the new layout.
    public static func offset(restoring distance: CGFloat, rowTop: CGFloat, topInset: CGFloat) -> CGFloat {
        rowTop - topInset - distance
    }

    /// The reading anchor: the first row that starts at or below the top of
    /// what the reader sees. A row across the top edge is above it, so it
    /// grows upward as it measures and the rows the reader sees stay put.
    /// `frames` are in content coordinates, in order.
    public static func readingAnchor<ID>(ids: [ID], frames: [CGRect], offset: CGFloat, topInset: CGFloat) -> Anchor<ID>? {
        let top = offset + topInset
        guard let first = firstIndex(endingBelow: top, frames: frames) else { return nil }
        let index = frames[first].minY >= top - 0.5 || first + 1 >= frames.count ? first : first + 1
        guard ids.indices.contains(index) else { return nil }
        return Anchor(id: ids[index], distance: frames[index].minY - top)
    }

    /// Binary search: the first frame whose bottom is below `y`.
    public static func firstIndex(endingBelow y: CGFloat, frames: [CGRect]) -> Int? {
        var low = 0, high = frames.count
        while low < high {
            let mid = (low + high) / 2
            if frames[mid].maxY <= y { low = mid + 1 } else { high = mid }
        }
        return low < frames.count ? low : nil
    }
}
