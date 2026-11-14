import QuartzCore
import UIKit

@MainActor
enum RoomPerf {
    #if DEBUG
    private static var count = 0
    private static var recorder: Recorder?

    static func standUp() {
        count += 1
        mark("standup-\(count)")
    }

    static func mark(_ label: String) {
        recorder?.finish()
        recorder = Recorder(label: label)
    }

    nonisolated static var file: URL? {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?.appendingPathComponent("room-perf.txt")
    }

    @MainActor final class Recorder: NSObject {
        private let label: String
        private var link: CADisplayLink?
        private var start: CFTimeInterval = 0
        private var last: CFTimeInterval = 0
        private var gaps: [Int] = []
        private var worst: CFTimeInterval = 0

        init(label: String) {
            self.label = label
            super.init()
            link = CADisplayLink(target: self, selector: #selector(tick))
            link?.add(to: .main, forMode: .common)
        }

        @objc private func tick(_ link: CADisplayLink) {
            if start == 0 { start = link.timestamp }
            if last > 0 {
                let frame = link.timestamp - last
                worst = max(worst, frame)
                if frame > 0.034 { gaps.append(Int((frame * 1000).rounded())) }
            }
            last = link.timestamp
            if link.timestamp - start > 1.2 { finish() }
        }

        func finish() {
            guard let link else { return }
            link.invalidate()
            self.link = nil
            let line = "\(label) worst=\(Int((worst * 1000).rounded()))ms gaps>34ms=\(gaps)\n"
            FileHandle.standardError.write(Data(("[perf] " + line).utf8))
            guard let file = RoomPerf.file else { return }
            if let handle = try? FileHandle(forWritingTo: file) {
                handle.seekToEndOfFile()
                handle.write(Data(line.utf8))
                try? handle.close()
            } else {
                try? Data(line.utf8).write(to: file)
            }
        }
    }
    #else
    static func standUp() {}
    static func mark(_ label: String) {}
    #endif
}
