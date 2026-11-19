#if DEBUG
import Foundation
import QuartzCore
import UIKit

/// `-qaEnergyProbe`: measures what keeps the app busy while nothing changes.
/// Every 10 s it logs (stderr, and `energy-probe.txt` in Documents) the main
/// run loop's wakeups per second, the frames each look web view drew per
/// second (desktop's WebGL scene and presence), and the requests per minute
/// by path. It draws nothing and adds no frame callback of its own.
@MainActor
enum EnergyProbe {
    static let enabled = ProcessInfo.processInfo.arguments.contains("-qaEnergyProbe")
    private static var wakeups = 0
    private static var frames: [String: Int] = [:]
    private static let requests = Requests()
    private static var observer: CFRunLoopObserver?
    private static var timer: Timer?
    private static var started = CACurrentMediaTime()

    final class Requests: @unchecked Sendable {
        private let lock = NSLock()
        private var counts: [String: Int] = [:]
        func add(_ path: String) { lock.withLock { counts[Self.name(path), default: 0] += 1 } }
        func take() -> [String: Int] { lock.withLock { defer { counts = [:] }; return counts } }
        static func name(_ path: String) -> String {
            let bare = path.split(separator: "?").first.map(String.init) ?? path
            if let rpc = bare.range(of: "/rpc/") { return String(bare[rpc.upperBound...]) }
            return bare.replacingOccurrences(of: #"thr_[A-Za-z0-9_]+"#, with: "<thread>", options: .regularExpression)
        }
    }

    static func start() {
        guard enabled, observer == nil else { return }
        BBClient.requestProbe = { path in requests.add(path) }
        let observer = CFRunLoopObserverCreateWithHandler(nil, CFRunLoopActivity.afterWaiting.rawValue, true, 0) { _, _ in
            MainActor.assumeIsolated { EnergyProbe.wakeups += 1 }
        }
        CFRunLoopAddObserver(CFRunLoopGetMain(), observer, .commonModes)
        self.observer = observer
        started = CACurrentMediaTime()
        let timer = Timer(timeInterval: 10, repeats: true) { _ in MainActor.assumeIsolated { EnergyProbe.report() } }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
        log("start")
    }

    /// A look web view's rAF callbacks and drawn frames since its last report.
    static func frames(_ page: String, _ count: Int, drawn: Int) {
        guard enabled else { return }
        frames[page + ".raf", default: 0] += count
        frames[page + ".draw", default: 0] += drawn
    }

    private static func report() {
        let now = CACurrentMediaTime()
        let span = max(0.001, now - started)
        started = now
        let wake = Double(wakeups) / span
        wakeups = 0
        let drawn = frames.sorted { $0.key < $1.key }.map { "\($0.key)=\(String(format: "%.1f", Double($0.value) / span))fps" }
        frames = [:]
        let taken = requests.take()
        let perMinute = taken.values.reduce(0, +)
        let byPath = taken.sorted { $0.value > $1.value }.map { "\($0.key)×\($0.value)" }.joined(separator: ",")
        let phase = switch UIApplication.shared.applicationState { case .active: "active"; case .inactive: "inactive"; default: "background" }
        log(String(format: "phase=%@ wakeups/s=%.1f web=[%@] requests/min=%.1f {%@}", phase, wake, drawn.joined(separator: " "), Double(perMinute) * 60 / span, byPath))
    }

    static func log(_ line: String) {
        let stamped = String(format: "%.0f ", Date().timeIntervalSince1970) + line + "\n"
        FileHandle.standardError.write(Data(("[energy] " + stamped).utf8))
        guard let file = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?.appendingPathComponent("energy-probe.txt") else { return }
        if let handle = try? FileHandle(forWritingTo: file) {
            handle.seekToEndOfFile()
            handle.write(Data(stamped.utf8))
            try? handle.close()
        } else {
            try? Data(stamped.utf8).write(to: file)
        }
    }

    /// Counts a look page's animation-frame callbacks (`raf`) and the frames its
    /// scene or presence actually drew (`draw`), and posts both every 5 s.
    static let frameCounterScript = """
    (() => {
      let n = 0, drawn = 0; const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => raf((t) => { n++; cb(t); });
      const count = (part) => { const s = part && part.stats && part.stats(); return (s && s.frames) || 0; };
      const total = () => { const l = window.BBLook; return l ? count(l.scene) + count(l.presence) : 0; };
      setInterval(() => { const t = total() || 0; const d = Math.max(0, t - drawn); drawn = t; if (n || d) { window.webkit.messageHandlers.bbLook.postMessage({ kind: 'probe-frames', frames: n, drawn: d }); n = 0; } }, 5000);
    })();
    """
}
#endif
