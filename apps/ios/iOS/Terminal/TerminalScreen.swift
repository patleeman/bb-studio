import SwiftTerm
import SwiftUI

/// Streams one BB terminal over its socket into a SwiftTerm view, and sends
/// keystrokes and size changes back.
@MainActor
final class TerminalConnection: NSObject, ObservableObject, TerminalViewDelegate {
    @Published private(set) var session: TerminalSession?
    @Published private(set) var connected = false
    @Published var error: String?

    let terminalId: String
    private let client: BBClient
    weak var view: SwiftTerm.TerminalView?
    private var task: URLSessionWebSocketTask?
    /// The next output chunk to show, so a reconnect replays only what was missed.
    private var nextSeq = 0
    private var running = false
    private var retryDelay: Double = 1
    private var pingTimer: Timer?
    private var pendingSize: (cols: Int, rows: Int)?

    init(terminalId: String, client: BBClient) {
        self.terminalId = terminalId
        self.client = client
    }

    func start() {
        guard !running else { return }
        running = true
        connect()
    }

    func stop() {
        running = false
        pingTimer?.invalidate()
        task?.cancel(with: .normalClosure, reason: nil)
        task = nil
        connected = false
    }

    private func connect() {
        guard running, task == nil else { return }
        let task = URLSession.shared.webSocketTask(with: client.terminalSocketURL(terminalId, sinceSeq: nextSeq))
        self.task = task
        task.resume()
        receive(on: task)
        pingTimer?.invalidate()
        pingTimer = Timer.scheduledTimer(withTimeInterval: 25, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.write(["type": "ping"]) }
        }
    }

    private func receive(on task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            Task { @MainActor in
                guard let self, self.task === task else { return }
                switch result {
                case .success(let message):
                    self.handle(message)
                    self.receive(on: task)
                case .failure:
                    self.dropped()
                }
            }
        }
    }

    private func dropped() {
        task = nil
        connected = false
        pingTimer?.invalidate()
        // An exited terminal has nothing more to say.
        guard running, session?.status != "exited" else { return }
        let delay = retryDelay
        retryDelay = min(retryDelay * 2, 30)
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(delay))
            self.connect()
        }
    }

    private func handle(_ message: URLSessionWebSocketTask.Message) {
        let data: Data? =
            switch message {
            case .string(let text): text.data(using: .utf8)
            case .data(let bytes): bytes
            @unknown default: nil
            }
        guard let data, let json = try? JSONDecoder().decode(JSONValue.self, from: data) else { return }
        switch json["type"]?.stringValue {
        case "attached":
            connected = true
            error = nil
            retryDelay = 1
            session = json["session"]?.decoded()
            if let size = pendingSize ?? view.map({ ($0.getTerminal().cols, $0.getTerminal().rows) }) {
                resize(cols: size.cols, rows: size.rows)
            }
        case "output":
            guard let chunk = json["chunk"], let seq = chunk["seq"]?.numberValue.map(Int.init),
                let base64 = chunk["dataBase64"]?.stringValue, let bytes = Data(base64Encoded: base64)
            else { return }
            guard seq >= nextSeq else { return }
            nextSeq = seq + 1
            view?.feed(byteArray: ArraySlice([UInt8](bytes)))
        case "session-updated":
            session = json["session"]?.decoded() ?? session
        case "exited":
            session = json["session"]?.decoded() ?? session
            let code = session?.exitCode.map { " with code \($0)" } ?? ""
            view?.feed(text: "\r\n\u{1B}[2m[Process exited\(code)]\u{1B}[0m\r\n")
        case "error":
            error = json["message"]?.stringValue
        default:
            break
        }
    }

    private func write(_ value: JSONValue) {
        guard let task, let data = try? JSONEncoder().encode(value), let text = String(data: data, encoding: .utf8)
        else { return }
        task.send(.string(text)) { _ in }
    }

    func send(_ bytes: [UInt8]) {
        guard session?.status != "exited" else { return }
        // The server takes at most 64 KB per message.
        var index = 0
        while index < bytes.count {
            let end = min(index + 48 * 1024, bytes.count)
            write(["type": "input", "dataBase64": .string(Data(bytes[index..<end]).base64EncodedString())])
            index = end
        }
    }

    func send(text: String) { send(Array(text.utf8)) }

    private func resize(cols: Int, rows: Int) {
        guard cols > 0, rows > 0 else { return }
        pendingSize = (cols, rows)
        guard connected else { return }
        write(["type": "resize", "cols": .number(Double(min(cols, 500))), "rows": .number(Double(min(rows, 200)))])
    }

    // MARK: TerminalViewDelegate

    nonisolated func send(source: SwiftTerm.TerminalView, data: ArraySlice<UInt8>) {
        let bytes = Array(data)
        MainActor.assumeIsolated { send(bytes) }
    }

    nonisolated func sizeChanged(source: SwiftTerm.TerminalView, newCols: Int, newRows: Int) {
        MainActor.assumeIsolated { resize(cols: newCols, rows: newRows) }
    }

    nonisolated func requestOpenLink(source: SwiftTerm.TerminalView, link: String, params: [String: String]) {
        guard let url = URL(string: link), url.scheme == "http" || url.scheme == "https" else { return }
        MainActor.assumeIsolated { UIApplication.shared.open(url) }
    }

    nonisolated func clipboardCopy(source: SwiftTerm.TerminalView, content: Data) {
        guard let text = String(data: content, encoding: .utf8) else { return }
        MainActor.assumeIsolated { UIPasteboard.general.string = text }
    }

    nonisolated func clipboardRead(source: SwiftTerm.TerminalView) -> Data? { nil }
    nonisolated func setTerminalTitle(source: SwiftTerm.TerminalView, title: String) {}
    nonisolated func hostCurrentDirectoryUpdate(source: SwiftTerm.TerminalView, directory: String?) {}
    nonisolated func scrolled(source: SwiftTerm.TerminalView, position: Double) {}
    nonisolated func bell(source: SwiftTerm.TerminalView) {}
    nonisolated func iTermContent(source: SwiftTerm.TerminalView, content: ArraySlice<UInt8>) {}
    nonisolated func rangeChanged(source: SwiftTerm.TerminalView, startY: Int, endY: Int) {}
}

/// SwiftTerm's view, which draws the screen and brings its own key bar (Esc, Ctrl, Tab, arrows).
private struct TerminalCanvas: UIViewRepresentable {
    let connection: TerminalConnection
    let fontSize: Double

    func makeUIView(context: Context) -> SwiftTerm.TerminalView {
        let view = SwiftTerm.TerminalView(frame: .zero)
        view.terminalDelegate = connection
        view.nativeBackgroundColor = UIColor(white: 0.07, alpha: 1)
        view.nativeForegroundColor = UIColor(white: 0.9, alpha: 1)
        view.font = UIFont.monospacedSystemFont(ofSize: fontSize, weight: .regular)
        view.accessibilityIdentifier = "terminalCanvas"
        connection.view = view
        return view
    }

    func updateUIView(_ view: SwiftTerm.TerminalView, context: Context) {
        if view.font.pointSize != fontSize {
            view.font = UIFont.monospacedSystemFont(ofSize: fontSize, weight: .regular)
        }
    }
}

/// A terminal; restarting swaps in the new session in place.
struct TerminalScreen: View {
    @State var terminalId: String

    var body: some View {
        TerminalPane(terminalId: terminalId) { terminalId = $0 }.id(terminalId)
    }
}

private struct TerminalPane: View {
    let terminalId: String
    let restarted: (String) -> Void
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var connection: TerminalConnection
    @AppStorage("terminalFontSize") private var fontSize = 12.0
    @State private var renaming = false
    @State private var newTitle = ""
    @State private var confirmingClose = false

    init(terminalId: String, restarted: @escaping (String) -> Void) {
        self.terminalId = terminalId
        self.restarted = restarted
        _connection = StateObject(wrappedValue: TerminalConnection(terminalId: terminalId, client: AppModel.shared.client))
    }

    var body: some View {
        TerminalCanvas(connection: connection, fontSize: fontSize)
            .ignoresSafeArea(.container, edges: .bottom)
            .background(Color(white: 0.07))
            .overlay(alignment: .top) { banner }
            .navigationTitle(connection.session?.title ?? "Terminal")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbarBackground(Color(white: 0.07), for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar(.hidden, for: .tabBar)
            .toolbar { ToolbarItem(placement: .primaryAction) { menu } }
            .onAppear { connection.start() }
            .onDisappear { connection.stop() }
            .onChange(of: scenePhase) { _, phase in
                // The server keeps the PTY; the socket just catches up on return.
                if phase == .active { connection.start() } else if phase == .background { connection.stop() }
            }
            .alert("Rename terminal", isPresented: $renaming) {
                TextField("Title", text: $newTitle)
                Button("Cancel", role: .cancel) {}
                Button("Rename") { Task { await rename() } }
            }
            .confirmationDialog("Close this terminal?", isPresented: $confirmingClose, titleVisibility: .visible) {
                Button("Close Terminal", role: .destructive) { Task { await close() } }
            } message: {
                Text("Whatever is running in it stops.")
            }
    }

    @ViewBuilder private var banner: some View {
        if let error = connection.error {
            notice(error, symbol: "exclamationmark.triangle")
        } else if let session = connection.session, session.status == "exited" {
            HStack {
                Label(session.statusLabel, systemImage: "stop.circle")
                Spacer()
                Button("Restart") { Task { await restart() } }.buttonStyle(.borderedProminent).controlSize(.small)
            }
            .font(.footnote)
            .padding(10)
            .background(.regularMaterial, in: .rect(cornerRadius: 12))
            .padding(8)
        } else if !connection.connected {
            notice("Connecting…", symbol: "antenna.radiowaves.left.and.right")
        }
    }

    private func notice(_ text: String, symbol: String) -> some View {
        Label(text, systemImage: symbol)
            .font(.footnote)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(.regularMaterial, in: .capsule)
            .padding(8)
    }

    private var menu: some View {
        Menu {
            Section {
                Button { UIPasteboard.general.string.map(connection.send(text:)) } label: {
                    Label("Paste", systemImage: "doc.on.clipboard")
                }
                Button { copyScreen() } label: { Label("Copy Output", systemImage: "doc.on.doc") }
                Button { connection.send([0x03]) } label: { Label("Send Ctrl-C", systemImage: "xmark.octagon") }
            }
            Section {
                Button { fontSize = min(fontSize + 1, 24) } label: { Label("Larger Text", systemImage: "textformat.size.larger") }
                Button { fontSize = max(fontSize - 1, 8) } label: { Label("Smaller Text", systemImage: "textformat.size.smaller") }
            }
            Section {
                Button {
                    newTitle = connection.session?.title ?? ""
                    renaming = true
                } label: { Label("Rename", systemImage: "pencil") }
                Button { Task { await restart() } } label: { Label("Restart", systemImage: "arrow.clockwise") }
                Button(role: .destructive) { confirmingClose = true } label: { Label("Close Terminal", systemImage: "xmark") }
            }
            if let session = connection.session {
                Text(session.initialCwd)
            }
        } label: {
            Image(systemName: "ellipsis")
        }
        .accessibilityLabel("Terminal actions")
    }

    private func copyScreen() {
        guard let terminal = connection.view?.getTerminal() else { return }
        let data = terminal.getBufferAsData()
        UIPasteboard.general.string = String(data: data, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func rename() async {
        let title = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { return }
        do { try await client.renameTerminal(terminalId, title: title) } catch {
            connection.error = BBClient.describe(error, server: client.baseURL)
        }
    }

    private func restart() async {
        do { let id = try await client.restartTerminal(terminalId).id; operation.complete(on: app) { restarted(id) } } catch {
            connection.error = BBClient.describe(error, server: client.baseURL)
        }
    }

    private func close() async {
        do {
            try await client.closeTerminal(terminalId)
            operation.complete(on: app) { dismiss() }
        } catch {
            connection.error = BBClient.describe(error, server: client.baseURL)
        }
    }
}
