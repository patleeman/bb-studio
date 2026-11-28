import SwiftUI

/// What the Workbench menu adds as a tab: the desktop New Tab page's "New"
/// actions the phone shows, in its order (Studio's `NEW_TAB_ACTIONS`,
/// src/tab-kinds.ts: page, whiteboard, design, app), then Open link (bb's
/// Open browser), then New tab… to find anything else. New conversation and
/// Start terminal stay on the desktop: neither is a tab the phone makes.
enum WorkbenchAdd: String, CaseIterable, Identifiable {
    case page, whiteboard, design, app, link, find

    var id: String { rawValue }

    /// The desktop's titles, and its icons as SF Symbols (FileText, Edit, Palette, AppWindow, Globe).
    var title: String {
        switch self {
        case .page: "New page"
        case .whiteboard: "New whiteboard"
        case .design: "New design"
        case .app: "New app"
        case .link: "Open link…"
        case .find: "New tab…"
        }
    }

    var symbol: String {
        switch self {
        case .page: "doc.text"
        case .whiteboard: "square.and.pencil"
        case .design: "paintpalette"
        case .app: "macwindow"
        case .link: "globe"
        case .find: "plus"
        }
    }

    /// What Studio makes for it; nil for Open link and New tab…, which ask first.
    var made: Made? {
        switch self {
        case .page: .item(pluginId: "pages", kind: "page", tab: "page")
        case .whiteboard: .whiteboardPage
        case .design: .item(pluginId: "design", kind: "design", tab: "design")
        case .app: .item(pluginId: "minis", kind: "mini", tab: "app")
        case .link, .find: nil
        }
    }

    /// The new tab's title until Studio names it, as the desktop titles it; nil for what makes nothing.
    var untitled: String? { made == nil ? nil : "Untitled " + title.replacingOccurrences(of: "New ", with: "") }

    var accessibilityId: String { "workbenchAdd-\(rawValue)" }

    enum Made: Equatable {
        /// Studio's `create` for the plugin's kind; the tab opens it as `tab` (tab-kinds.ts's kind).
        case item(pluginId: String, kind: String, tab: String)
        /// `drawings.newWhiteboardPage`: a page holding an empty whiteboard, opened as the page.
        case whiteboardPage
    }

    /// What Open link opens: the typed address as an http(s) URL (https when
    /// it has no scheme), or nil for anything else, which Studio refuses.
    static func link(_ text: String) -> URL? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.contains(where: \.isWhitespace) else { return nil }
        let typed = trimmed.contains("://") ? trimmed : "https://" + trimmed
        guard let url = URL(string: typed), let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http",
              let host = url.host(), host.contains(".") || host == "localhost" else { return nil }
        return url
    }
}

/// The Workbench menu's add section: the New actions, Open link and New tab….
struct WorkbenchAddItems: View {
    let add: (WorkbenchAdd) -> Void

    var body: some View {
        ForEach(WorkbenchAdd.allCases) { item in
            Button { add(item) } label: { Label(item.title, systemImage: item.symbol) }
                .accessibilityIdentifier(item.accessibilityId)
        }
    }
}

/// Runs what the Workbench menu picked for a conversation: makes the item
/// and opens it as a tab, asks for a link, or finds one (New tab…). The tab
/// opens shown, and `reveal` brings the Workbench into view.
struct WorkbenchAdding: ViewModifier {
    let threadId: String
    /// The conversation's project, where new items go (as on the desktop, BB's open project).
    let projectId: String?
    @Binding var request: WorkbenchAdd?
    var reveal: () -> Void = {}
    @State private var finding = false
    @State private var askingLink = false
    @State private var link = ""
    @State private var failure: String?
    /// A tab on its way: another pick waits, so one tap makes one item.
    @State private var busy = false
    @EnvironmentObject private var app: AppModel

    func body(content: Content) -> some View {
        content
            .onChange(of: request) { _, picked in
                guard let picked else { return }
                request = nil
                if !busy { run(picked) }
            }
            .sheet(isPresented: $finding) { WorkbenchNewTab(threadId: threadId, opened: reveal) }
            .alert("Open link", isPresented: $askingLink) {
                TextField("example.com", text: $link)
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                Button("Cancel", role: .cancel) {}
                Button("Open") { openLink() }
            } message: {
                Text("It opens as a tab here and on the desktop.")
            }
            .alert("Couldn't add the tab", isPresented: .init { failure != nil } set: { if !$0 { failure = nil } }) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(failure ?? "")
            }
    }

    private func run(_ picked: WorkbenchAdd) {
        switch picked {
        case .find: finding = true
        case .link:
            link = ""
            askingLink = true
        default:
            guard let made = picked.made, let title = picked.untitled else { return }
            adding { try await WorkbenchStore.shared.make(made, title: title, projectId: projectId, in: threadId) }
        }
    }

    private func openLink() {
        guard let url = WorkbenchAdd.link(link) else {
            failure = "“\(link)” isn't a web address."
            return
        }
        adding {
            try await WorkbenchStore.shared.add(.init(kind: "browser", url: url.absoluteString), title: url.host() ?? url.absoluteString, in: threadId)
        }
    }

    /// Adds the tab, then brings the Workbench into view; or says why not.
    private func adding(_ work: @escaping @MainActor () async throws -> Void) {
        busy = true
        Task {
            defer { busy = false }
            do {
                try await work()
                reveal()
            } catch {
                failure = BBClient.describe(error, server: app.client.baseURL)
            }
        }
    }
}

extension View {
    /// Hosts the Workbench menu's picks for a conversation (`WorkbenchAdding`).
    func workbenchAdding(_ threadId: String, projectId: String?, request: Binding<WorkbenchAdd?>,
                         reveal: @escaping () -> Void = {}) -> some View {
        modifier(WorkbenchAdding(threadId: threadId, projectId: projectId, request: request, reveal: reveal))
    }
}
