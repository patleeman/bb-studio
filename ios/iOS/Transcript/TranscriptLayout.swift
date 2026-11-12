import UIKit

/// Where the view lands after rows go in or out, or the width changes: the
/// controller's to say (the end, if the view is at it).
@MainActor
protocol TranscriptLayoutAnchoring: AnyObject {
    func targetOffset(proposed: CGPoint, in layout: TranscriptListLayout) -> CGPoint
}

/// One column of rows, top to bottom, each as tall as its cell measures.
///
/// Not inverted: VoiceOver order, context-menu previews, selection handles,
/// the scroll indicator and interactive keyboard dismissal all stay native.
/// Not a compositional layout: its self-sizing passes are opaque, and a
/// row above the view that resizes must move the offset in the same pass.
///
/// Heights are kept by row id, so a prepend or a reorder keeps what was
/// measured. After a width change the old heights stay as estimates until
/// the rows measure again.
final class TranscriptListLayout: UICollectionViewLayout {
    struct Metrics: Equatable {
        /// Between rows.
        var spacing: CGFloat = 14
        /// Above the first row and below the last.
        var top: CGFloat = 8
        var bottom: CGFloat = 8
        /// Each side of the rows, inside the column.
        var margin: CGFloat = 12
        /// The column (rows and their margins) is at most this wide, centred.
        var readableWidth: CGFloat = .greatestFiniteMagnitude
        /// Kept clear at each edge: a landscape safe area, the Duo's status column.
        var leading: CGFloat = 0
        var trailing: CGFloat = 0
    }

    weak var anchoring: TranscriptLayoutAnchoring?
    /// The row id at an index path: the data source's, so heights follow ids.
    var identify: (IndexPath) -> AnyHashable? = { _ in nil }
    /// A row's height before it has measured.
    var estimate: (AnyHashable) -> CGFloat = { _ in 64 }

    var metrics = Metrics() {
        didSet { if metrics != oldValue { needsFrames = true; invalidateLayout() } }
    }

    private(set) var ids: [AnyHashable] = []
    private var indices: [AnyHashable: Int] = [:]
    private(set) var frames: [CGRect] = []
    private(set) var contentHeight: CGFloat = 0
    private var heights: [AnyHashable: CGFloat] = [:]
    /// Measured at another width: their heights are estimates until they measure again.
    private var stale: Set<AnyHashable> = []
    private var width: CGFloat = 0
    private var needsIDs = true
    private var needsFrames = true

    /// For the harness's bounds: layout passes that rebuilt something.
    private(set) var prepares = 0
    private(set) var measures = 0
    /// Rows whose height changed: each can cost a layout pass, so the
    /// harness bounds passes by these rather than by a fixed number.
    private(set) var resizes = 0

    /// The row the reader is on (the first that starts at the top of what
    /// they see), set by their own scrolls. Rows before it grow upward.
    var readerRow: AnyHashable?
    /// The view is held at the end: a resize moves the offset to the new end
    /// in the same pass. Left past the end for a moment (a row at the end
    /// shrinking), UIKit sprang it back over 0.3 s while the controller put it
    /// on the end each frame.
    var holdsEnd = true

    /// A row that resizes before the reader's row grows upward, as UIKit's
    /// own self-sizing layouts do: nothing on screen moves. Without one, a
    /// row that starts above the top. Judged by the row rather than by the
    /// top edge, which each adjustment moves: a row shrinking across the
    /// top stopped counting as above it halfway (the replay's drag, 15 pt).
    private func growsUpward(_ index: Int) -> Bool {
        if let readerRow, let reader = indices[readerRow] { return index < reader }
        guard let collectionView else { return false }
        return frames[index].minY < collectionView.contentOffset.y + collectionView.contentInset.top - 0.5
    }

    /// Several rows' new heights at once, in one invalidation (one layout
    /// pass): returns the offset adjustment for all of them.
    func applyHeights(_ sizes: [(index: Int, height: CGFloat)]) -> CGFloat {
        var upward: CGFloat = 0
        for (index, height) in sizes.sorted(by: { $0.index > $1.index }) where frames.indices.contains(index) {
            let delta = height - frames[index].height
            guard delta != 0 else { continue }
            if growsUpward(index) { upward += delta }
            resize(index, to: height)
        }
        return holdsEnd ? toEnd() : upward
    }

    /// From the offset to the end, with the content as it is now.
    private func toEnd() -> CGFloat {
        guard let collectionView else { return 0 }
        let end = TranscriptGeometry.maxOffset(contentHeight: contentHeight, boundsHeight: collectionView.bounds.height,
            topInset: collectionView.contentInset.top, bottomInset: collectionView.contentInset.bottom)
        return end - collectionView.contentOffset.y
    }

    func index(of id: AnyHashable) -> Int? { indices[id] }
    func frame(of id: AnyHashable) -> CGRect? { indices[id].map { frames[$0] } }
    func isMeasured(_ id: AnyHashable) -> Bool { heights[id] != nil && !stale.contains(id) }

    /// A row that became another (an optimistic row confirmed under the
    /// server's id) keeps its height, so the swap doesn't move anything.
    func carryHeight(from old: AnyHashable, to new: AnyHashable) {
        guard let height = heights[old] else { return }
        heights[new] = height
        if stale.contains(old) { stale.insert(new) }
    }

    /// Drops heights for rows that are gone, so a long session doesn't keep them all.
    func forget(keeping live: Set<AnyHashable>) {
        guard heights.count > live.count * 2 + 64 else { return }
        heights = heights.filter { live.contains($0.key) }
        stale = stale.filter { live.contains($0) }
    }

    override func prepare() {
        super.prepare()
        guard let collectionView else { return }
        let newWidth = collectionView.bounds.width
        if newWidth != width {
            if width > 0 { stale.formUnion(heights.keys) }
            width = newWidth
            needsFrames = true
        }
        if needsIDs {
            let count = collectionView.numberOfSections > 0 ? collectionView.numberOfItems(inSection: 0) : 0
            var next: [AnyHashable] = []
            next.reserveCapacity(count)
            for item in 0..<count { next.append(identify(IndexPath(item: item, section: 0)) ?? AnyHashable(item)) }
            ids = next
            indices = Dictionary(next.enumerated().map { ($1, $0) }, uniquingKeysWith: { first, _ in first })
            needsIDs = false
            needsFrames = true
        }
        if needsFrames {
            prepares += 1
            buildFrames()
            needsFrames = false
        }
    }

    private func buildFrames() {
        // A column at most `readableWidth` wide, centred, with the margins inside it.
        let available = max(0, width - metrics.leading - metrics.trailing)
        let column = min(metrics.readableWidth, available)
        let rowWidth = max(0, column - 2 * metrics.margin)
        let x = metrics.leading + (available - column) / 2 + metrics.margin
        var y = metrics.top
        frames = ids.map { id in
            let height = heights[id] ?? estimate(id)
            defer { y += height + metrics.spacing }
            return CGRect(x: x, y: y, width: rowWidth, height: height)
        }
        if !frames.isEmpty { y -= metrics.spacing }
        contentHeight = y + metrics.bottom
    }

    /// As wide as where rows may go: up to the trailing edge kept clear (the
    /// Duo's status column), as the SwiftUI transcript's content was.
    override var collectionViewContentSize: CGSize {
        CGSize(width: max(0, (collectionView?.bounds.width ?? width) - metrics.trailing), height: contentHeight)
    }

    override func layoutAttributesForElements(in rect: CGRect) -> [UICollectionViewLayoutAttributes]? {
        guard var index = TranscriptGeometry.firstIndex(endingBelow: rect.minY, frames: frames) else { return [] }
        var result: [UICollectionViewLayoutAttributes] = []
        while index < frames.count, frames[index].minY < rect.maxY {
            result.append(attributes(at: index))
            index += 1
        }
        return result
    }

    override func layoutAttributesForItem(at indexPath: IndexPath) -> UICollectionViewLayoutAttributes? {
        frames.indices.contains(indexPath.item) ? attributes(at: indexPath.item) : nil
    }

    private func attributes(at index: Int) -> UICollectionViewLayoutAttributes {
        let attributes = UICollectionViewLayoutAttributes(forCellWith: IndexPath(item: index, section: 0))
        attributes.frame = frames[index]
        return attributes
    }

    // MARK: Width

    override func shouldInvalidateLayout(forBoundsChange newBounds: CGRect) -> Bool {
        newBounds.width != (collectionView?.bounds.width ?? width)
    }

    // MARK: Self-sizing

    override func shouldInvalidateLayout(forPreferredLayoutAttributes preferred: UICollectionViewLayoutAttributes,
                                         withOriginalAttributes original: UICollectionViewLayoutAttributes) -> Bool {
        let index = preferred.indexPath.item
        // At no width (a hosted view's first pass) nothing measures for real.
        guard preferred.representedElementCategory == .cell, ids.indices.contains(index), width > 0,
              frames[index].width > 0 else { return false }
        measures += 1
        let height = Self.pixel(preferred.size.height)
        let id = ids[index]
        if abs(height - frames[index].height) > 0.25 { return true }
        // Measured as estimated, or as at the last width: nothing moves.
        heights[id] = frames[index].height
        stale.remove(id)
        return false
    }

    override func invalidationContext(forPreferredLayoutAttributes preferred: UICollectionViewLayoutAttributes,
                                      withOriginalAttributes original: UICollectionViewLayoutAttributes) -> UICollectionViewLayoutInvalidationContext {
        let context = super.invalidationContext(forPreferredLayoutAttributes: preferred, withOriginalAttributes: original)
        let index = preferred.indexPath.item
        guard frames.indices.contains(index) else { return context }
        let height = Self.pixel(preferred.size.height)
        let delta = height - frames[index].height
        context.contentSizeAdjustment = CGSize(width: 0, height: delta)
        let upward = growsUpward(index)
        // Taken now: UIKit moves the offset before it invalidates with this
        // context, and a re-measure in between saw the old height and moved
        // the offset a second time (the replay's drag, 8 to 24 pt).
        resize(index, to: height)
        // Held at the end: to the new end. Else a row before the reader's grows upward.
        let adjustment = holdsEnd ? toEnd() : upward ? delta : 0
        if adjustment != 0 { context.contentOffsetAdjustment = CGPoint(x: 0, y: adjustment) }
        return context
    }

    override func invalidateLayout(with context: UICollectionViewLayoutInvalidationContext) {
        if context.invalidateEverything || context.invalidateDataSourceCounts { needsIDs = true }
        super.invalidateLayout(with: context)
    }

    /// One row's new height: only it and the rows below it move.
    private func resize(_ index: Int, to height: CGFloat) {
        let delta = height - frames[index].height
        if delta != 0 { resizes += 1 }
        heights[ids[index]] = height
        stale.remove(ids[index])
        frames[index].size.height = height
        for below in (index + 1)..<max(index + 1, frames.count) { frames[below].origin.y += delta }
        contentHeight += delta
    }

    // MARK: Updates

    override func targetContentOffset(forProposedContentOffset proposed: CGPoint) -> CGPoint {
        anchoring?.targetOffset(proposed: proposed, in: self) ?? proposed
    }

    static func pixel(_ value: CGFloat) -> CGFloat {
        let scale: CGFloat = 3
        return (value * scale).rounded(.up) / scale
    }
}
