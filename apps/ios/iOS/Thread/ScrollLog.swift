import SwiftUI

/// The transcript's scroll log: one line per scroll change and scroll
/// request, so a chat that ends up past its last row can be traced to the
/// step that put it there. `past` is how far the bottom of the unobscured
/// viewport sits below the content's end (positive = blank space).
///
/// Geometry, row ids and the app's own scroll requests only, never what a
/// message says: ids go through `id(_:)`, which drops anything that isn't
/// an id. Off unless turned on in Settings (or `-qaScrollLog` in Debug).
/// Kept on this phone in `Documents/scroll-log.txt`, at most `cap` bytes:
/// the oldest lines go first.
@MainActor
enum ScrollLog {
    static let enabledKey = "scrollLogEnabled"
    static var on: Bool { launchArgument || UserDefaults.standard.bool(forKey: enabledKey) }
    nonisolated static let file = URL.documentsDirectory.appending(path: "scroll-log.txt")
    nonisolated static let cap = 512 * 1024
    private static let launchArgument: Bool = {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("-qaScrollLog")
        #else
        false
        #endif
    }()
    private static var visible: [String] = []
    private static var last = ""
    private static let started = Date()

    static func visible(_ ids: [String]) {
        guard on else { return }
        visible = ids
    }

    static func geometry(_ geometry: ScrollGeometry) {
        guard on else { return }
        let line = geometryLine(offset: geometry.contentOffset.y, content: geometry.contentSize.height,
            container: geometry.containerSize.height, insetTop: geometry.contentInsets.top,
            insetBottom: geometry.contentInsets.bottom, past: geometry.unobscuredBottom - geometry.contentSize.height,
            visible: visible)
        guard line != last else { return }
        last = line
        write("geo " + line)
    }

    /// One of the transcript's own scroll requests or holds. Callers pass
    /// numbers, states and `id(_:)`s, never text from a row.
    static func request(_ what: String) {
        guard on else { return }
        write("req " + what)
    }

    static func clear() {
        try? FileManager.default.removeItem(at: file)
        last = ""
    }

    /// A row id as logged: ids are short runs of ASCII letters, digits and
    /// `_ . : -`, with at least one digit or `_ : -` (`a149`, `thr_x`,
    /// `timeline-bottom`), so a bare word is never one. Anything else is
    /// replaced by its length.
    nonisolated static func id(_ id: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "_.:-"))
        let marks = CharacterSet.decimalDigits.union(CharacterSet(charactersIn: "_:-"))
        guard !id.isEmpty, id.count <= 64, id.unicodeScalars.allSatisfy({ $0.isASCII && allowed.contains($0) }),
              id.unicodeScalars.contains(where: { marks.contains($0) }) else { return "?\(id.count)" }
        return id
    }

    nonisolated static func describe(_ anchor: TranscriptResizeAnchor.Anchor) -> String {
        switch anchor {
        case .bottom: "bottom"
        case .message(let row, let offset): String(format: "message %@ offset=%.1f", id(row), offset)
        }
    }

    nonisolated static func geometryLine(offset: CGFloat, content: CGFloat, container: CGFloat, insetTop: CGFloat,
                                         insetBottom: CGFloat, past: CGFloat, visible: [String]) -> String {
        let ids = (visible.count > 3 ? [visible.first!, "…", visible.last!] : visible).map { $0 == "…" ? $0 : id($0) }
        return String(format: "offset=%.1f content=%.1f container=%.1f insetTop=%.1f insetBottom=%.1f past=%.1f",
            offset, content, container, insetTop, insetBottom, past) + " rows=\(visible.count) visible=\(ids.joined(separator: ","))"
    }

    private static func write(_ line: String) {
        let stamped = String(format: "%.3f ", Date().timeIntervalSince(started)) + line + "\n"
        #if DEBUG
        FileHandle.standardError.write(Data(stamped.utf8))
        #endif
        append(stamped, to: file, cap: cap)
    }

    /// Appends `line`; past `cap` bytes, keeps the newest whole lines that
    /// fit in three quarters of it, so it trims once in a while, not on
    /// every line.
    nonisolated static func append(_ line: String, to url: URL, cap: Int) {
        let data = Data(line.utf8)
        if let handle = try? FileHandle(forWritingTo: url) {
            let size = (try? handle.seekToEnd()) ?? 0
            try? handle.write(contentsOf: data)
            try? handle.close()
            guard Int(size) + data.count > cap, let all = try? Data(contentsOf: url) else { return }
            var kept = all.suffix(cap * 3 / 4)
            if let newline = kept.firstIndex(of: UInt8(ascii: "\n")) { kept = kept[kept.index(after: newline)...] }
            try? Data(kept).write(to: url, options: .atomic)
        } else {
            try? data.suffix(cap).write(to: url, options: .atomic)
        }
    }
}

/// Settings ▸ Diagnostics: the scroll log, its share sheet, and Clear.
struct ScrollLogSection: View {
    @AppStorage(ScrollLog.enabledKey) private var enabled = false
    @State private var exists = FileManager.default.fileExists(atPath: ScrollLog.file.path)

    var body: some View {
        Section {
            Toggle("Scroll log", isOn: $enabled)
                .accessibilityIdentifier("settingsScrollLog")
            if exists {
                ShareLink(item: ScrollLog.file) { Label("Share log", systemImage: "square.and.arrow.up") }
                Button("Clear", role: .destructive) {
                    ScrollLog.clear()
                    exists = false
                }
            }
        } header: {
            Text("Diagnostics").foregroundStyle(Color.primary.opacity(0.75))
        } footer: {
            Text("Records how chats scroll: positions, sizes and row ids, never what messages say. Stays on this phone until you share it.")
                .foregroundStyle(Color.primary.opacity(0.75))
        }
        .onAppear { exists = FileManager.default.fileExists(atPath: ScrollLog.file.path) }
    }
}
