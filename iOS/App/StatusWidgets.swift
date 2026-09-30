import WidgetKit

/// Asks the home and lock screen widgets to redraw when the counts they show change.
@MainActor
enum StatusWidgets {
    private static var lastKey = ""

    static func reloadIfChanged(_ threads: [ThreadEntry]) {
        let summary = ThreadSummary(threads)
        let key = (summary.needsYou + summary.running).map { "\($0.id):\($0.status)" }.joined(separator: ",")
        guard key != lastKey else { return }
        lastKey = key
        WidgetCenter.shared.reloadAllTimelines()
    }
}
