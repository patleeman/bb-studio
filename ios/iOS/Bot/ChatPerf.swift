import OSLog
import SwiftUI

/// Time to first content in the Bot chat, from the Bot tab coming on screen to
/// its first message drawn. Signposts in every build (Instruments' Points of
/// Interest); debug builds also print a `[perf]` line per mark, count frames
/// over 100ms while the server's rows land, and follow a send.
@MainActor
enum ChatPerf {
    private static let signposter = OSSignposter(subsystem: "nyc.plee.bbgo", category: .pointsOfInterest)
    private static var interval: OSSignpostIntervalState?
    private static var opened: ContinuousClock.Instant?
    private static var drewRows = false

    /// The Bot tab came on screen: the tap that opens the chat.
    static func open() {
        guard interval == nil else { return }
        opened = .now
        drewRows = false
        interval = signposter.beginInterval("BotChatOpen")
        log("open")
        #if DEBUG
        Hitches.shared.start()
        #endif
    }

    /// A message row was drawn. The first after `open` ends the interval.
    static func rowAppeared(cached: Bool) {
        #if DEBUG
        visibleRows += 1
        #endif
        guard let state = interval, !drewRows else { return }
        drewRows = true
        signposter.endInterval("BotChatOpen", state)
        interval = nil
        log("firstRows", cached ? "source=cache" : "source=server")
    }

    static func rowDisappeared() {
        #if DEBUG
        visibleRows -= 1
        #endif
    }

    /// The server's first page replaced or filled the chat.
    static func serverRowsLanded(rows: Int) {
        signposter.emitEvent("BotChatServerRows")
        log("serverRows", "rows=\(rows)")
        #if DEBUG
        Hitches.shared.stop(after: .seconds(1))
        #endif
    }

    /// Straight to stderr: `simctl launch --console` doesn't see buffered stdout.
    nonisolated static func say(_ line: String) {
        FileHandle.standardError.write(Data((line + "\n").utf8))
    }

    private static func log(_ mark: String, _ detail: String = "") {
        #if DEBUG
        let ms = opened.map { Int(($0.duration(to: .now) / .milliseconds(1)).rounded()) } ?? -1
        say("[perf] \(mark) t=\(ms)ms \(detail)")
        #endif
    }

    #if DEBUG
    /// Message rows on screen (a lazy stack drops the ones scrolled away).
    private(set) static var visibleRows = 0
    private static var sentAt: ContinuousClock.Instant?
    private static var sentText: String?

    /// Follows a send: when its row shows, and how many rows show meanwhile.
    static func sent(_ text: String) {
        sentAt = .now
        sentText = text
        say("[perf] send visible=\(visibleRows)")
        Task {
            for ms in [100, 300, 600, 1000, 2000, 3000, 4000] {
                try? await Task.sleep(until: sentAt! + .milliseconds(ms))
                say("[perf] afterSend +\(ms)ms visible=\(visibleRows)")
            }
        }
    }

    static func userRowAppeared(_ text: String?) {
        guard let sentAt, let sentText, text == sentText else { return }
        say("[perf] sentRowShown t=\(Int((sentAt.duration(to: .now) / .milliseconds(1)).rounded()))ms")
        self.sentText = nil
    }

    /// Frames over 100ms, counted from `start` until a moment after `stop`.
    final class Hitches: NSObject {
        static let shared = Hitches()
        private var link: CADisplayLink?
        private var last: CFTimeInterval = 0
        private var count = 0
        private var worst: CFTimeInterval = 0

        func start() {
            link?.invalidate()
            count = 0
            worst = 0
            last = 0
            link = CADisplayLink(target: self, selector: #selector(tick))
            link?.add(to: .main, forMode: .common)
        }

        func stop(after delay: Duration) {
            guard link != nil else { return }
            Task { @MainActor in
                try? await Task.sleep(for: delay)
                guard let link = self.link else { return }
                link.invalidate()
                self.link = nil
                ChatPerf.say("[perf] hitches count=\(self.count) worst=\(Int(self.worst * 1000))ms")
            }
        }

        @objc private func tick(_ link: CADisplayLink) {
            defer { last = link.timestamp }
            guard last > 0 else { return }
            let frame = link.timestamp - last
            worst = max(worst, frame)
            if frame > 0.1 { count += 1 }
        }
    }
    #endif
}

/// Reports a Bot message row to `ChatPerf` as it comes and goes.
struct ChatPerfRow: ViewModifier {
    let row: TimelineRow
    let cached: Bool

    func body(content: Content) -> some View {
        content
            .onAppear {
                ChatPerf.rowAppeared(cached: cached)
                #if DEBUG
                if row.isUser { ChatPerf.userRowAppeared(row.text) }
                #endif
            }
            .onDisappear { ChatPerf.rowDisappeared() }
    }
}
