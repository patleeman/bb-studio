import CoreGraphics

/// The scroll math, without a scroll view: the offsets that are valid.
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
