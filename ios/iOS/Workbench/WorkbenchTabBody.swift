import SwiftUI

extension EnvironmentValues {
    /// True inside a Workbench tab. The conversation's one bar is above it and
    /// its composer is below, so the view draws no navigation bar, title or
    /// composer of its own; its actions sit in its own header instead.
    @Entry var inWorkbench = false
}

/// One Workbench tab's content, by the desktop's tab kind (`tab-kinds.ts`).
/// Native where the phone has a view, even when Studio marks the kind `web`
/// (recordings); the in-app web view for the rest; a card for what only the
/// desktop opens. The Workbench container (tabs, bar, rail) is the shell's:
/// it puts this under its bar.
struct WorkbenchTabBody: View {
    let tab: WorkspaceTab
    let threadId: String
    /// The conversation in BB web: where kinds the phone has no view for open.
    var webURL: URL?
    /// Opens a conversation or worker tab in the chat.
    var openThread: (String) -> Void = { _ in }

    var body: some View {
        content
            .environment(\.inWorkbench, true)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("workspaceContent-\(tab.id)")
    }

    @ViewBuilder private var content: some View {
        switch WorkbenchTabKind(tab) {
        case .page(let id): PageView(pageId: id)
        case .design(let id): DesignView(id: id)
        case .file(let path, let environmentId): WorkbenchFileTab(path: path, environmentId: environmentId, threadId: threadId)
        case .diff(let path): WorkbenchDiffTab(path: path, threadId: threadId)
        case .browser(let url): WorkbenchBrowserTab(url: url)
        case .item(let route): WorkbenchItemTab(route: route)
        case .terminal: NavigationStack { TerminalsView(scope: .thread(threadId), title: tab.title) }
        case .thread(let id, let worker):
            WorkbenchTabCard(title: tab.title, detail: worker ? "A worker's transcript." : "A conversation.",
                             systemImage: "bubble.left.and.text.bubble.right", action: ("Open", { openThread(id) }))
        case .web: WorkbenchWebFallback(webURL: webURL)
        case .unsafeLink:
            WorkbenchTabCard(title: "Not opened", detail: "Only http and https links open on the phone.", systemImage: "exclamationmark.shield")
        case .desktopOnly:
            WorkbenchTabCard(title: "Open on the desktop", detail: "\(tab.title) opens in BB Studio on your Mac.", systemImage: "desktopcomputer")
        case .incomplete:
            WorkbenchTabCard(title: "Can't open this tab", detail: "Studio sent it without what the phone needs to show it.",
                             systemImage: "questionmark.square.dashed")
        }
    }
}

/// What a tab shows on the phone, decided from its ref alone (unit-tested).
enum WorkbenchTabKind: Equatable {
    case page(String)
    case design(String)
    /// A workspace file (`environmentId`), or a file on the conversation's host (nil: the conversation's workspace).
    case file(path: String, environmentId: String?)
    /// One file's uncommitted diff in the conversation's workspace, or all of them (nil).
    case diff(path: String?)
    case browser(URL)
    /// A Studio item with a native screen of its own (drawing, app, artifact, recording).
    case item(Route)
    case terminal
    case thread(String, worker: Bool)
    case web
    case unsafeLink
    case desktopOnly
    case incomplete

    init(_ tab: WorkspaceTab) {
        let ref = tab.ref
        if tab.support == .desktopOnly {
            self = .desktopOnly
            return
        }
        let id = ref.id.flatMap { $0.isEmpty ? nil : $0 }
        switch ref.kind {
        case "page": self = id.map(Self.page) ?? .incomplete
        case "design": self = id.map(Self.design) ?? .incomplete
        case "whiteboard": self = id.map { .item(.drawing(id: $0)) } ?? .incomplete
        case "app": self = id.map { .item(MiniApp.isId($0) ? .mini(id: $0) : .artifact(id: $0)) } ?? .incomplete
        case "artifact": self = id.map { .item(.artifact(id: $0)) } ?? .incomplete
        // Studio marks recordings `web`; the phone has its own recording screen.
        case "recording": self = id.map { .item(.recording(id: $0)) } ?? .incomplete
        case "file":
            if let path = ref.path, !path.isEmpty { self = .file(path: path, environmentId: ref.environmentId) } else { self = .incomplete }
        case "diff": self = .diff(path: ref.path.flatMap { $0.isEmpty ? nil : $0 })
        case "browser": self = tab.safeURL.map(Self.browser) ?? .unsafeLink
        case "terminal": self = .terminal
        case "conversation", "worker": self = id.map { .thread($0, worker: ref.kind == "worker") } ?? .incomplete
        default: self = .web
        }
    }
}

/// A Studio item's own screen. These keep their own bar for now (parity.md).
private struct WorkbenchItemTab: View {
    let route: Route

    var body: some View {
        NavigationStack {
            switch route {
            case .drawing(let id): DrawingView(id: id)
            case .mini(let id): MiniAppView(id: id)
            case .artifact(let id): ArtifactView(id: id)
            case .recording(let id): RecordingDetailView(id: id)
            default: EmptyView()
            }
        }
    }
}

/// Kinds the phone has no view for: the conversation in BB web, which shows its Workbench.
private struct WorkbenchWebFallback: View {
    let webURL: URL?
    @EnvironmentObject private var app: AppModel

    var body: some View { WebView(url: webURL ?? app.client.baseURL) }
}

struct WorkbenchTabCard: View {
    let title: String
    let detail: String
    let systemImage: String
    var action: (String, () -> Void)?

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: systemImage).font(.title2).foregroundStyle(.secondary)
            Text(title).font(.headline)
            Text(detail).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
            if let action {
                Button(action.0, action: action.1).buttonStyle(.bordered).frame(minHeight: 44)
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity)
        .padding(.top, 40)
    }
}
