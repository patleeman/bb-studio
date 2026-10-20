import OSLog
import SwiftUI

/// A record of how a chat's scroll view moves, and why, for finding scroll
/// glitches on a real phone. Off unless turned on: always in debug builds,
/// and in release builds by the hidden "Log chat scrolling" switch in
/// Settings (tap the version line five times). It only watches: nothing
/// here changes how the chat scrolls.
///
/// Lines go to OSLog (subsystem `nyc.plee.bbgo`, category `scroll`) and, with
/// the switch on, to a file Settings can share. Only numbers, phases and
/// causes are logged, never message text.
enum ScrollLog {
    static let defaultsKey = "scrollDiagnostics"
    private static let logger = Logger(subsystem: "nyc.plee.bbgo", category: "scroll")
    private static let queue = DispatchQueue(label: "nyc.plee.bbgo.scrolllog", qos: .utility)
    /// Past this the file starts over, keeping the previous one beside it.
    private static let maxFileBytes: UInt64 = 4_000_000

    /// Read once per launch and when the switch changes, not per frame.
    nonisolated(unsafe) private(set) static var enabled: Bool = {
        #if DEBUG
        return true
        #else
        return UserDefaults.standard.bool(forKey: defaultsKey)
        #endif
    }()

    /// Whether the file is written: the Settings switch (or `-scrollDiagnostics YES`).
    nonisolated(unsafe) private(set) static var writesFile = UserDefaults.standard.bool(forKey: defaultsKey)

    static func setEnabled(_ on: Bool) {
        UserDefaults.standard.set(on, forKey: defaultsKey)
        writesFile = on
        #if DEBUG
        enabled = true
        #else
        enabled = on
        #endif
        log("diagnostics \(on ? "on" : "off")")
    }

    static var fileURL: URL {
        #if DEBUG
        // UI tests read it from the host: `-qaScrollLogFile /tmp/….txt`.
        if let path = UserDefaults.standard.string(forKey: "qaScrollLogFile") { return URL(fileURLWithPath: path) }
        #endif
        return FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("scroll-log.txt")
    }

    private static var previousFileURL: URL { fileURL.deletingPathExtension().appendingPathExtension("previous.txt") }

    // MARK: Causes

    /// The last scroll the app made itself, so the offset change it brings
    /// is put down to it rather than to the reader or the layout.
    nonisolated(unsafe) private static var lastCause: (name: String, at: ContinuousClock.Instant)?

    /// The app is about to move the scroll view itself (a snap, a jump, a find).
    static func cause(_ name: String) {
        guard enabled else { return }
        lastCause = (name, .now)
        log("scrollTo \(name)")
    }

    /// A scroll the app made in the last moment (animated scrolls run ~0.4s).
    fileprivate static func recentCause() -> String? {
        guard let lastCause, lastCause.at.duration(to: .now) < .milliseconds(600) else { return nil }
        return lastCause.name
    }

    // MARK: Writing

    nonisolated(unsafe) private static var buffer: [String] = []
    nonisolated(unsafe) private static var start = ContinuousClock.now

    static func log(_ make: @autoclosure () -> String) {
        guard enabled else { return }
        let line = make()
        logger.debug("\(line, privacy: .public)")
        guard writesFile else { return }
        let ms = Int((start.duration(to: .now) / .milliseconds(1)).rounded())
        let stamp = Date().formatted(.iso8601.time(includingFractionalSeconds: true))
        buffer.append("\(stamp) +\(ms)ms \(line)")
        // Written in batches, and whenever Settings shares the file.
        if buffer.count >= 40 { flush() }
    }

    /// Writes what's buffered; call before sharing the file.
    static func flush() {
        guard !buffer.isEmpty else { return }
        let lines = buffer.joined(separator: "\n") + "\n"
        buffer.removeAll(keepingCapacity: true)
        let url = fileURL, previous = previousFileURL, max = maxFileBytes
        queue.async {
            let files = FileManager.default
            if let size = (try? files.attributesOfItem(atPath: url.path))?[.size] as? UInt64, size > max {
                try? files.removeItem(at: previous)
                try? files.moveItem(at: url, to: previous)
            }
            if !files.fileExists(atPath: url.path) { files.createFile(atPath: url.path, contents: nil) }
            guard let handle = try? FileHandle(forWritingTo: url) else { return }
            defer { try? handle.close() }
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: Data(lines.utf8))
        }
    }

    /// Flushes, then waits for the write, so a share sends everything.
    static func flushAndWait() {
        flush()
        queue.sync {}
    }

    static func clear() {
        buffer.removeAll()
        let url = fileURL, previous = previousFileURL
        queue.sync {
            try? FileManager.default.removeItem(at: url)
            try? FileManager.default.removeItem(at: previous)
        }
        start = .now
        log("cleared")
    }

    static var fileSize: Int64 {
        Int64(((try? FileManager.default.attributesOfItem(atPath: fileURL.path))?[.size] as? UInt64) ?? 0)
    }
}

/// What the probe watches of the scroll view, rounded to whole points so a
/// still view doesn't log.
private struct ScrollSample: Equatable {
    var offset: CGFloat = 0
    var content: CGFloat = 0
    var container: CGFloat = 0
    var inset: CGFloat = 0

    init() {}

    init(_ geometry: ScrollGeometry) {
        offset = geometry.contentOffset.y.rounded()
        content = geometry.contentSize.height.rounded()
        container = geometry.containerSize.height.rounded()
        inset = geometry.contentInsets.bottom.rounded()
    }
}

/// Logs a chat's scroll view: each offset and content-height change and its
/// cause (the reader's drag or fling, the app's own scroll, the bottom
/// anchor while pinned, or rows above re-measuring and streaming), each
/// phase change, and the timeline's pinned state (its end marker logs itself). Watches only;
/// when diagnostics are off its geometry read is a constant and nothing logs.
struct ScrollLogProbe: ViewModifier {
    let name: String
    let pinned: Bool
    let working: Bool
    let lastRowLength: Int
    /// Fixed when the chat opens: a switch flipped mid-chat applies to the
    /// next one, so the scroll view is never rebuilt under the reader.
    @State private var on = ScrollLog.enabled
    @State private var phase = ScrollPhase.idle
    #if DEBUG
    @State private var scrollFrames = FrameCounter()
    @State private var turnFrames = FrameCounter()
    #endif
    /// When the last row's text last grew: a reply streaming.
    @State private var streamedAt: ContinuousClock.Instant?

    func body(content: Content) -> some View {
        if on {
            content
                .onScrollGeometryChange(for: ScrollSample.self) { ScrollSample($0) } action: { old, new in
                    record(old, new)
                }
                .onScrollPhaseChange { old, new in
                    phase = new
                    #if DEBUG
                    if new.byReader, !old.byReader { scrollFrames.begin() }
                    if new == .idle, old.byReader, let stats = scrollFrames.end() { ScrollLog.log("\(name) frames scroll \(stats)") }
                    #endif
                    ScrollLog.log("\(name) phase \(old.logName)->\(new.logName)")
                }
                .onChange(of: pinned) { old, new in
                    ScrollLog.log("\(name) pinned \(old)->\(new) jumpButton=\(new ? "hidden" : "shown")")
                }
                .onChange(of: working) { _, new in
                    ScrollLog.log("\(name) workingLine \(new ? "shown" : "hidden")")
                    #if DEBUG
                    if new { turnFrames.begin() } else if let stats = turnFrames.end() { ScrollLog.log("\(name) frames turn \(stats)") }
                    #endif
                }
                .onChange(of: lastRowLength) { old, new in if new > old { streamedAt = .now } }
                .onAppear { ScrollLog.log("\(name) appeared") }
                .onReceive(NotificationCenter.default.publisher(for: UIApplication.didEnterBackgroundNotification)) { _ in ScrollLog.flush() }
                .onDisappear {
                    ScrollLog.log("\(name) disappeared")
                    ScrollLog.flush()
                }
        } else {
            content
        }
    }

    private func record(_ old: ScrollSample, _ new: ScrollSample) {
        let offsetDelta = new.offset - old.offset
        let contentDelta = new.content - old.content
        var parts = [String]()
        if offsetDelta != 0 { parts.append("offset \(Int(old.offset))->\(Int(new.offset)) (\(signed(offsetDelta)))") }
        if contentDelta != 0 { parts.append("content \(Int(old.content))->\(Int(new.content)) (\(signed(contentDelta)))") }
        if new.container != old.container { parts.append("container \(Int(old.container))->\(Int(new.container))") }
        if new.inset != old.inset { parts.append("inset \(Int(old.inset))->\(Int(new.inset))") }
        guard !parts.isEmpty else { return }
        let cause = cause(offsetMoved: offsetDelta != 0, contentChanged: contentDelta != 0 || new.inset != old.inset || new.container != old.container)
        // An offset jump the reader didn't make, away from the end (pinned,
        // the chat follows the end on purpose): what a glitch looks like.
        let flag = abs(offsetDelta) > 8 && !phase.byReader && !pinned && phase != .animating && ScrollLog.recentCause() == nil ? " JUMP" : ""
        ScrollLog.log("\(name) \(parts.joined(separator: " ")) cause=\(cause) pinned=\(pinned)\(flag)")
    }

    private func cause(offsetMoved: Bool, contentChanged: Bool) -> String {
        if phase.byReader { return "user.\(phase.logName)" }
        if let made = ScrollLog.recentCause() { return "app.\(made)" }
        if phase == .animating { return "animation" }
        guard contentChanged else { return offsetMoved ? "unknown" : "none" }
        let streaming = streamedAt.map { $0.duration(to: .now) < .milliseconds(300) } ?? false
        let source = streaming ? "stream" : "estimate/lateLayout"
        // While pinned, `defaultScrollAnchor(.bottom, for: .sizeChanges)` moves the offset with the growth.
        return offsetMoved && pinned ? "anchor.\(source)" : source
    }

    private func signed(_ value: CGFloat) -> String { value > 0 ? "+\(Int(value))" : "\(Int(value))" }
}

private extension ScrollPhase {
    var logName: String {
        switch self {
        case .idle: "idle"
        case .tracking: "tracking"
        case .interacting: "interacting"
        case .decelerating: "decelerating"
        case .animating: "animating"
        @unknown default: "other"
        }
    }
}

#if DEBUG
/// Debug builds: frames dropped over one scroll gesture (touch to rest) or
/// one turn, logged as `frames …` lines: how long it ran, the hitch time
/// (frames late past their deadline, as Instruments counts it) and its
/// ratio in ms per second, and the longest frame. A display link runs only
/// between `begin` and `end`, never while idle, and never in release.
final class FrameCounter: NSObject {
    private var link: CADisplayLink?
    private var started: CFTimeInterval = 0
    private var last: CFTimeInterval = 0
    private var deadline: CFTimeInterval = 0
    private var hitch: CFTimeInterval = 0
    private var longest: CFTimeInterval = 0
    private var frames = 0

    func begin() {
        link?.invalidate()
        (started, last, deadline, hitch, longest, frames) = (0, 0, 0, 0, 0, 0)
        link = CADisplayLink(target: self, selector: #selector(tick))
        link?.add(to: .main, forMode: .common)
    }

    func end() -> String? {
        guard let link else { return nil }
        link.invalidate()
        self.link = nil
        guard frames > 1, last > started else { return nil }
        let seconds = last - started
        return String(format: "durationMs=%.0f frames=%d hitchMs=%.0f ratioMsPerS=%.1f longestMs=%.0f",
                      seconds * 1000, frames, hitch * 1000, hitch * 1000 / seconds, longest * 1000)
    }

    @objc private func tick(_ link: CADisplayLink) {
        if started == 0 { started = link.timestamp }
        if last > 0 {
            longest = max(longest, link.timestamp - last)
            // Late past the frame the last tick was meant for.
            if deadline > 0, link.timestamp > deadline + 0.002 { hitch += link.timestamp - deadline }
        }
        frames += 1
        last = link.timestamp
        deadline = link.targetTimestamp
    }
}
#endif
