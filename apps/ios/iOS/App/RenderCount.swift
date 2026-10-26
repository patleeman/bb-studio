#if DEBUG
import Foundation

/// Debug builds: how often the transcript redraws and how often geometry
/// readers write back, and how long the main thread stays busy, for the
/// hang guards in the UI tests (`bbstudio://qa-duo/counts`). Two hangs
/// (0x8BADF00D, 10 s of main-thread CPU) were the Bot chat redrawing all
/// of itself on every scroll request and keystroke.
@MainActor
enum RenderCount {
    private(set) static var counts: [String: Int] = [:]

    static func bump(_ name: String) { counts[name, default: 0] += 1 }

    static func reset() { counts = [:] }

    /// From now on, `busy.ms` adds up the main run loop's time between
    /// waking and sleeping again, and `busy.maxMs` keeps the longest one: a
    /// single stretch is what the watchdog kills.
    static func watchMainThread() {
        guard observer == nil else { return }
        var woke: CFAbsoluteTime = 0
        let activities = CFRunLoopActivity.afterWaiting.rawValue | CFRunLoopActivity.beforeWaiting.rawValue
        let observer = CFRunLoopObserverCreateWithHandler(nil, activities, true, 0) { _, activity in
            let now = CFAbsoluteTimeGetCurrent()
            if activity == .afterWaiting {
                woke = now
            } else if woke > 0 {
                let ms = Int(((now - woke) * 1000).rounded())
                woke = 0
                MainActor.assumeIsolated {
                    counts["busy.ms", default: 0] += ms
                    counts["busy.maxMs"] = max(counts["busy.maxMs"] ?? 0, ms)
                }
            }
        }
        CFRunLoopAddObserver(CFRunLoopGetMain(), observer, .commonModes)
        self.observer = observer
    }
    private static var observer: CFRunLoopObserver?
}
#endif
