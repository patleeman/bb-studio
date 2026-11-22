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

    /// Keyboard and scene events, for a composer held up with no keyboard
    /// (Patrick, Oct 26, beside Safari in the Duo's split view): each
    /// keyboard's end frame, whether it is this app's, how much of it is over
    /// this window, and the scene's activation. A geometry line's
    /// `insetBottom` then shows whether the transcript kept that inset.
    static func observeKeyboard() {
        guard !observing else { return }
        observing = true
        let center = NotificationCenter.default
        let keyboard: [(Notification.Name, String)] = [
            (UIResponder.keyboardWillShowNotification, "willShow"), (UIResponder.keyboardWillHideNotification, "willHide"),
            (UIResponder.keyboardDidHideNotification, "didHide"), (UIResponder.keyboardWillChangeFrameNotification, "willChange")]
        for (name, label) in keyboard {
            center.addObserver(forName: name, object: nil, queue: .main) { note in
                let end = (note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect) ?? .null
                let local = (note.userInfo?[UIResponder.keyboardIsLocalUserInfoKey] as? Bool) ?? true
                MainActor.assumeIsolated { keyboardEvent(label, end: end, local: local) }
            }
        }
        let scene: [(Notification.Name, String)] = [
            (UIScene.didActivateNotification, "active"), (UIScene.willDeactivateNotification, "inactive"),
            (UIScene.didEnterBackgroundNotification, "background"), (UIScene.willEnterForegroundNotification, "foreground")]
        for (name, label) in scene {
            center.addObserver(forName: name, object: nil, queue: .main) { _ in
                MainActor.assumeIsolated { keyboardEvent("scene " + label, end: nil, local: nil) }
            }
        }
    }

    private static var observing = false

    /// Also kept as crash breadcrumbs, with the scroll log off.
    private static func keyboardEvent(_ what: String, end: CGRect?, local: Bool?) {
        let window = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).first { $0.isKeyWindow }
        var line = "kbd " + what
        if let local { line += " local=\(local)" }
        if let end, !end.isNull {
            line += String(format: " end=%.0f,%.0f,%.0fx%.0f", end.minX, end.minY, end.width, end.height)
            if let window {
                // The end frame is in screen coordinates.
                let mine = window.convert(end, from: window.screen.coordinateSpace).intersection(window.bounds)
                line += String(format: " overWindow=%.0f", mine.isNull ? 0 : mine.height)
            }
        }
        if let window {
            line += String(format: " window=%.0f,%.0f,%.0fx%.0f", window.frame.minX, window.frame.minY,
                window.frame.width, window.frame.height)
            line += " state=\(window.windowScene.map { "\($0.activationState.rawValue)" } ?? "-")"
        }
        Breadcrumbs.shared.record(line)
        guard on else { return }
        write(line)
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
    /// The breadcrumbs of a session that didn't end cleanly.
    @State private var crash = Breadcrumbs.shared.hasLastCrash

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
            if crash {
                ShareLink(item: Breadcrumbs.shared.lastCrash) {
                    Label("Share last crash breadcrumbs", systemImage: "exclamationmark.triangle")
                }
                .accessibilityIdentifier("settingsShareCrashBreadcrumbs")
                Button("Clear crash breadcrumbs", role: .destructive) {
                    Breadcrumbs.shared.clearLastCrash()
                    crash = false
                }
            }
        } header: {
            Text("Diagnostics").foregroundStyle(Color.primary.opacity(0.75))
        } footer: {
            Text("Records how chats scroll: positions, sizes and row ids, never what messages say. Stays on this phone until you share it. After a crash, the keyboard and window events before it are kept here too.")
                .foregroundStyle(Color.primary.opacity(0.75))
        }
        .onAppear {
            exists = FileManager.default.fileExists(atPath: ScrollLog.file.path)
            crash = Breadcrumbs.shared.hasLastCrash
        }
    }
}
