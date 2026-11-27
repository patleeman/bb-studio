import SwiftUI

/// What a page shows over itself.
enum PageSheet: Identifiable, Equatable {
    case editor
    /// The comments, opened at a thread.
    case comments(focus: String?)
    /// A new comment, on a block when given.
    case newComment(block: String?)
    case history, activity, related, chats, icon, web
    case export(URL)

    var id: String {
        switch self {
        case .comments(let focus): "comments-\(focus ?? "")"
        case .newComment(let block): "new-\(block ?? "")"
        case .export(let url): "export-\(url.lastPathComponent)"
        default: "\(self)"
        }
    }
}

/// What a page asks before it acts.
enum PageDialog: Identifiable {
    case rename, archive, delete
    var id: Self { self }
}

/// One page, rendered natively block by block. Pushed, its actions are in the
/// navigation bar; in a Workbench tab they go to the shell's More and the
/// page draws no bar or composer of its own.
struct PageView: View {
    @Environment(\.inWorkbench) private var inWorkbench
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var app: AppModel
    @ObservedObject private var store = PagesStore.shared
    @ObservedObject private var studio = StudioStore.shared
    @StateObject private var model: PageModel
    @State private var sheet: PageSheet?
    @State private var dialog: PageDialog?
    @State private var notice: String?
    @State private var chats: [PageChat] = []
    @State private var newTitle = ""
    @State private var focusBlock: String?
    @State private var openedEmptyEditor = false

    init(pageId: String) {
        _model = StateObject(wrappedValue: PageModel(pageId: pageId))
    }

    private var meta: PageMeta? { model.meta ?? store.page(model.pageId) }
    private var gone: Bool { model.missing || store.deleted.contains(model.pageId) }

    var body: some View {
        chrome
            .modifier(PagePresentations(model: model, sheet: $sheet, dialog: $dialog, newTitle: $newTitle, notice: $notice,
                                        chats: chats, title: meta?.title ?? "", act: act, showBlock: show))
            .environment(\.openURL, OpenURLAction { url in
                guard let target = Links.parse(url.absoluteString, origin: app.client.baseURL), case .entity = target else { return .systemAction }
                app.openLink(target)
                return .handled
            })
            .task(id: app.serverURL) {
                store.restore()
                store.attach(app)
                model.attach(app)
                if store.page(model.pageId) == nil { Task { await store.load(app.client) } }
                Task { await loadChats() }
                await model.load(app.client)
            }
            .onDisappear { model.detach() }
            .onChange(of: model.markdown) { _, _ in
                if model.isEmpty, !openedEmptyEditor {
                    openedEmptyEditor = true
                    sheet = .editor
                }
            }
    }

    /// The content with its one action list (Edit and Comments first): pushed, the bar's
    /// buttons and ⋯ in the native bar; in a Workbench tab, the conversation's ⋯.
    @ViewBuilder private var chrome: some View {
        let actions = PageActions(page: meta, model: model, chats: chats, gone: gone, star: starItem, studio: studio,
                                  open: { sheet = $0 }, ask: { dialog = $0 }, act: act).all
        if inWorkbench {
            content.screenActions(actions)
        } else {
            content.screenToolbar(meta?.displayTitle ?? "Page", actions: actions)
        }
    }

    @ViewBuilder private var content: some View {
        if gone && !PageDraftStore().exists(server: model.serverURL, page: model.pageId) {
            ContentUnavailableView("Page deleted", systemImage: "doc.questionmark", description: Text("This page no longer exists."))
        } else {
            PageScroll(model: model, meta: meta, focusBlock: $focusBlock, sheet: $sheet, restore: { act { try await $0.updatePage(model.pageId, archived: false) } })
                .safeAreaInset(edge: .bottom) {
                    // In a Workbench the conversation's composer is right below; no second one.
                    if !inWorkbench, !gone || PageDraftStore().exists(server: model.serverURL, page: model.pageId, kind: "work") {
                        PageWorkBar(page: meta, pageId: model.pageId, notice: $notice) { await loadChats() }
                    }
                }
                .overlay(alignment: .top) { PageNotice(notice: $notice) }
        }
    }

    private var starItem: StudioItem? {
        studio.supportsStars ? studio.item(for: .page(id: model.pageId)) : nil
    }

    private func show(_ blockId: String) {
        sheet = nil
        focusBlock = PageDocument.shortId(blockId)
    }

    private func loadChats() async {
        chats = ((try? await app.client.pageChats(model.pageId)) ?? []).sorted { $0.createdAt > $1.createdAt }
    }

    /// Runs a change, reloads the tree; a failure shows over the page.
    private func act(_ action: @escaping @MainActor (BBClient) async throws -> Void) {
        Task {
            do {
                try await action(app.client)
                await store.load(app.client)
                await model.load(app.client)
            } catch {
                notice = BBClient.describe(error, server: app.client.baseURL)
            }
        }
    }
}

/// A short note over the page that goes by itself after 4 s.
private struct PageNotice: View {
    @Binding var notice: String?

    var body: some View {
        if let notice {
            Text(notice).font(.footnote).padding(.horizontal, 12).padding(.vertical, 6)
                .background(.regularMaterial, in: .capsule).padding(.top, 4)
                .onTapGesture { self.notice = nil }
                .task(id: notice) {
                    try? await Task.sleep(for: .seconds(4))
                    self.notice = nil
                }
                .accessibilityIdentifier("pageNotice")
        }
    }
}
