#if DEBUG
import SwiftUI

/// `-qaScrollLog`: one line per transcript scroll change and scroll request,
/// to stderr and `Documents/scroll-log.txt`, so a past-the-end viewport can be
/// traced to the step that made it. `past` is how far the bottom of the
/// unobscured viewport sits below the content's end (positive = blank space).
@MainActor
enum ScrollLog {
    static let on = ProcessInfo.processInfo.arguments.contains("-qaScrollLog")
    private static var visible: [String] = []
    private static var last = ""
    private static let file = URL.documentsDirectory.appending(path: "scroll-log.txt")
    private static let started = Date()

    static func visible(_ ids: [String]) {
        guard on else { return }
        visible = ids
    }

    static func geometry(_ geometry: ScrollGeometry) {
        guard on else { return }
        let past = geometry.unobscuredBottom - geometry.contentSize.height
        let ids = visible.count > 3 ? [visible.first!, "…", visible.last!] : visible
        let line = String(format: "offset=%.1f content=%.1f container=%.1f insetTop=%.1f insetBottom=%.1f past=%.1f",
            geometry.contentOffset.y, geometry.contentSize.height, geometry.containerSize.height,
            geometry.contentInsets.top, geometry.contentInsets.bottom, past) + " visible=\(ids.joined(separator: ","))"
        guard line != last else { return }
        last = line
        write("geo " + line)
    }

    static func request(_ what: String) {
        guard on else { return }
        write("req " + what)
    }

    private static func write(_ line: String) {
        let stamped = String(format: "%.3f ", Date().timeIntervalSince(started)) + line + "\n"
        FileHandle.standardError.write(Data(stamped.utf8))
        if let handle = try? FileHandle(forWritingTo: file) {
            handle.seekToEndOfFile()
            handle.write(Data(stamped.utf8))
            try? handle.close()
        } else {
            try? Data(stamped.utf8).write(to: file)
        }
    }
}
#endif
